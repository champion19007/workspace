import { ForbiddenError, NotFoundError, generateUuidV7, isReadOnlyRole, type FileDTO } from '@workspace/core';
import { tenantSql, type DbOrSql, type TenantContext } from './client.js';

const scoped = (db: DbOrSql, context: TenantContext): any => tenantSql(db, context);

const canManage = (role: string) => role === 'owner' || role === 'admin';

function toFileDTO(r: any, userId: string, role: string): FileDTO {
  return {
    id: r.id,
    nodeId: r.node_id,
    taskId: r.task_id,
    taskLabel: r.task_id ? `${r.task_key} ${r.task_title}` : null,
    name: r.name,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    uploadedBy: r.uploaded_by ? { id: r.uploaded_by, name: r.uploader_name ?? 'Former member' } : null,
    createdAt: new Date(r.created_at).toISOString(),
    canDelete: !isReadOnlyRole(role) && (r.uploaded_by === userId || canManage(role)),
  };
}

/**
 * Records a file on a project (or one of its tasks) and stores its bytes with `store`, in one transaction: when
 * storing fails, no row is left behind.
 */
export async function createFile(
  db: DbOrSql,
  params: {
    orgId: string;
    actorUserId: string;
    role: string;
    nodeId: string;
    taskId?: string | null;
    name: string;
    contentType: string;
    sizeBytes: number;
  },
  store: (storageKey: string) => Promise<void>
): Promise<FileDTO> {
  const { orgId, actorUserId, role, nodeId } = params;
  if (isReadOnlyRole(role)) throw new ForbiddenError('Executives and clients cannot upload files');

  return scoped(db, { orgId, userId: actorUserId, role }).begin(async (sql: any) => {
    const [project] = await sql`
      SELECT id FROM nodes WHERE org_id = ${orgId} AND id = ${nodeId} AND kind = 'project' AND archived_at IS NULL
    `;
    if (!project) throw new NotFoundError('Project not found');
    let task: { key: string; title: string } | undefined;
    if (params.taskId) {
      [task] = await sql`
        SELECT key, title FROM tasks
        WHERE org_id = ${orgId} AND id = ${params.taskId} AND project_id = ${nodeId} AND archived_at IS NULL
      `;
      if (!task) throw new NotFoundError('Task not found');
    }

    const id = generateUuidV7();
    const storageKey = `orgs/${orgId}/files/${id}`;
    const [row] = await sql`
      INSERT INTO files (id, org_id, node_id, task_id, name, content_type, size_bytes, storage_key, uploaded_by)
      VALUES (
        ${id}, ${orgId}, ${nodeId}, ${params.taskId ?? null}, ${params.name}, ${params.contentType},
        ${params.sizeBytes}, ${storageKey}, ${actorUserId}
      )
      RETURNING created_at
    `;
    await store(storageKey);
    const [me] = await sql`
      SELECT COALESCE(NULLIF(name, ''), split_part(email, '@', 1)) AS name FROM users WHERE id = ${actorUserId}
    `;
    return toFileDTO(
      {
        id,
        node_id: nodeId,
        task_id: params.taskId ?? null,
        task_key: task?.key,
        task_title: task?.title,
        name: params.name,
        content_type: params.contentType,
        size_bytes: params.sizeBytes,
        uploaded_by: actorUserId,
        uploader_name: me?.name,
        created_at: row.created_at,
      },
      actorUserId,
      role
    );
  });
}

/** A project's files (task attachments included), or one task's attachments; newest first. */
export async function listFiles(
  db: DbOrSql,
  params: { orgId: string; userId: string; role: string; nodeId?: string; taskId?: string }
): Promise<FileDTO[]> {
  const { orgId, userId, role } = params;
  const sql = scoped(db, { orgId, userId, role });
  const rows = await sql`
    SELECT f.id, f.node_id, f.task_id, f.name, f.content_type, f.size_bytes, f.uploaded_by, f.created_at,
           t.key AS task_key, t.title AS task_title,
           COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1)) AS uploader_name
    FROM files f
    LEFT JOIN tasks t ON t.id = f.task_id
    LEFT JOIN users u ON u.id = f.uploaded_by
    WHERE f.org_id = ${orgId} AND f.deleted_at IS NULL
      ${params.nodeId ? sql`AND f.node_id = ${params.nodeId}` : sql``}
      ${params.taskId ? sql`AND f.task_id = ${params.taskId}` : sql``}
    ORDER BY f.created_at DESC
    LIMIT 500
  `;
  return rows.map((r: any) => toFileDTO(r, userId, role));
}

/** Where a file's bytes are, if the caller may see it. */
export async function getFileForDownload(
  db: DbOrSql,
  params: { orgId: string; userId: string; role: string; fileId: string }
): Promise<{ name: string; contentType: string; storageKey: string }> {
  const { orgId, userId, role, fileId } = params;
  const [f] = await scoped(db, { orgId, userId, role })`
    SELECT name, content_type, storage_key FROM files WHERE org_id = ${orgId} AND id = ${fileId} AND deleted_at IS NULL
  `;
  if (!f) throw new NotFoundError('File not found');
  return { name: f.name, contentType: f.content_type, storageKey: f.storage_key };
}

/** The uploader, an Owner or a Manager can delete a file. Returns the storage key so the caller can remove the bytes. */
export async function deleteFile(
  db: DbOrSql,
  params: { orgId: string; actorUserId: string; role: string; fileId: string }
): Promise<{ storageKey: string }> {
  const { orgId, actorUserId, role, fileId } = params;
  if (isReadOnlyRole(role)) throw new ForbiddenError('Executives and clients cannot delete files');
  return scoped(db, { orgId, userId: actorUserId, role }).begin(async (sql: any) => {
    const [f] = await sql`
      SELECT uploaded_by, storage_key FROM files WHERE org_id = ${orgId} AND id = ${fileId} AND deleted_at IS NULL
    `;
    if (!f) throw new NotFoundError('File not found');
    if (f.uploaded_by !== actorUserId && !canManage(role)) {
      throw new ForbiddenError('Only the person who uploaded a file, an Owner or a Manager can delete it');
    }
    await sql`UPDATE files SET deleted_at = NOW() WHERE id = ${fileId}`;
    return { storageKey: f.storage_key };
  });
}
