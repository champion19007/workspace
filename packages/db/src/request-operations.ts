import { randomBytes } from 'node:crypto';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  isReadOnlyRole,
  type PublicRequestFormDTO,
  type PublicRequestInput,
  type RequestDTO,
  type RequestFormDTO,
  type RequestStatus,
} from '@workspace/core';
import { loginSql, tenantSql, type DbOrSql, type TenantContext } from './client.js';
import { createTaskInTransaction } from './task-operations.js';

const scoped = (db: DbOrSql, context: TenantContext): any => tenantSql(db, context);

const toFormDTO = (r: any): RequestFormDTO => ({ nodeId: r.node_id, enabled: r.enabled, token: r.public_token, intro: r.intro });

function toRequestDTO(r: any): RequestDTO {
  return {
    id: r.id,
    nodeId: r.node_id,
    projectName: r.project_name,
    title: r.title,
    details: r.details,
    requesterName: r.requester_name,
    requesterEmail: r.requester_email,
    status: r.status,
    taskId: r.task_id,
    taskKey: r.task_key ?? null,
    createdAt: new Date(r.created_at).toISOString(),
    decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
  };
}

/** A project's request form, or null when it never had one. */
export async function getRequestForm(
  db: DbOrSql,
  params: { orgId: string; userId: string; role: string; nodeId: string }
): Promise<RequestFormDTO | null> {
  const { orgId, userId, role, nodeId } = params;
  const [row] = await scoped(db, { orgId, userId, role })`
    SELECT node_id, enabled, public_token, intro FROM request_forms WHERE org_id = ${orgId} AND node_id = ${nodeId}
  `;
  return row ? toFormDTO(row) : null;
}

/** Turns a project's request form on or off (creating it, with a new link, the first time). */
export async function saveRequestForm(
  db: DbOrSql,
  params: { orgId: string; actorUserId: string; role: string; nodeId: string; enabled: boolean; intro: string }
): Promise<RequestFormDTO> {
  const { orgId, actorUserId, role, nodeId } = params;
  if (isReadOnlyRole(role)) throw new ForbiddenError('Executives and clients cannot change request forms');
  return scoped(db, { orgId, userId: actorUserId, role }).begin(async (sql: any) => {
    const [project] = await sql`
      SELECT id FROM nodes WHERE org_id = ${orgId} AND id = ${nodeId} AND kind = 'project' AND archived_at IS NULL
    `;
    if (!project) throw new NotFoundError('Project not found');
    const [row] = await sql`
      INSERT INTO request_forms (org_id, node_id, public_token, intro, enabled, created_by)
      VALUES (${orgId}, ${nodeId}, ${randomBytes(18).toString('base64url')}, ${params.intro}, ${params.enabled}, ${actorUserId})
      ON CONFLICT (node_id) DO UPDATE SET enabled = EXCLUDED.enabled, intro = EXCLUDED.intro, updated_at = NOW()
      RETURNING node_id, enabled, public_token, intro
    `;
    return toFormDTO(row);
  });
}

/** Requests sent to projects the caller can see, newest first. */
export async function listRequests(
  db: DbOrSql,
  params: { orgId: string; userId: string; role: string; status: RequestStatus }
): Promise<RequestDTO[]> {
  const { orgId, userId, role } = params;
  const rows = await scoped(db, { orgId, userId, role })`
    SELECT r.*, n.name AS project_name, t.key AS task_key
    FROM requests r
    JOIN nodes n ON n.id = r.node_id
    LEFT JOIN tasks t ON t.id = r.task_id
    WHERE r.org_id = ${orgId} AND r.status = ${params.status}
    ORDER BY r.created_at DESC
    LIMIT 200
  `;
  return rows.map(toRequestDTO);
}

/** Accepting a request makes it a task in its project; declining just closes it. */
export async function decideRequest(
  db: DbOrSql,
  params: { orgId: string; actorUserId: string; role: string; requestId: string; decision: 'accept' | 'decline' }
): Promise<RequestDTO> {
  const { orgId, actorUserId, role, requestId } = params;
  if (isReadOnlyRole(role)) throw new ForbiddenError('Executives and clients cannot decide requests');
  return scoped(db, { orgId, userId: actorUserId, role }).begin(async (sql: any) => {
    const [r] = await sql`SELECT * FROM requests WHERE org_id = ${orgId} AND id = ${requestId} FOR UPDATE`;
    if (!r) throw new NotFoundError('Request not found');
    if (r.status !== 'new') throw new ConflictError('Someone has already decided this request');

    let taskId: string | null = null;
    if (params.decision === 'accept') {
      const from = `Requested by ${r.requester_name} (${r.requester_email}) through the request form.`;
      const task = await createTaskInTransaction(sql, {
        orgId,
        actorUserId,
        role,
        input: {
          projectId: r.node_id,
          title: r.title,
          description: r.details ? `${r.details}\n\n${from}` : from,
          status: 'todo',
          priority: 'medium',
        },
      });
      taskId = task.id;
    }
    const [updated] = await sql`
      UPDATE requests
      SET status = ${params.decision === 'accept' ? 'accepted' : 'declined'}, task_id = ${taskId},
          decided_by = ${actorUserId}, decided_at = NOW()
      WHERE id = ${requestId}
      RETURNING *
    `;
    const [extra] = await sql`
      SELECT n.name AS project_name, t.key AS task_key
      FROM nodes n LEFT JOIN tasks t ON t.id = ${taskId}
      WHERE n.id = ${r.node_id}
    `;
    return toRequestDTO({ ...updated, ...extra });
  });
}

/** The public form's heading, or null when the link is wrong or the form is switched off. */
export async function getPublicRequestForm(db: DbOrSql, token: string): Promise<PublicRequestFormDTO | null> {
  const [row] = await loginSql(db)`SELECT * FROM sys_request_form_public(${token})`;
  return row ? { orgName: row.org_name, projectName: row.project_name, intro: row.intro } : null;
}

/** Records a request from the public form. Returns its id, or null when the form doesn't exist or is off. */
export async function submitPublicRequest(
  db: DbOrSql,
  token: string,
  input: Pick<PublicRequestInput, 'title' | 'details' | 'name' | 'email'>
): Promise<string | null> {
  const [row] = await loginSql(db)`
    SELECT sys_request_submit(${token}, ${input.title}, ${input.details}, ${input.name}, ${input.email}) AS id
  `;
  return row?.id ?? null;
}
