import {
  generateUuidV7,
  NotFoundError,
  ForbiddenError,
  PreconditionFailedError,
  sanitizeMarkdown,
  extractMarkdownExcerpt,
  MAX_RETAINED_VERSIONS,
  type DocDTO,
  type DocListItemDTO,
  type DocVersionDTO,
  type CreateDocInput,
  type UpdateDocInput,
  type ListDocsQuery,
} from '@workspace/core';
import type { DatabaseInstance, Sql } from './client.js';
import { insertOutboxEvent } from './outbox-operations.js';

type DbOrSql = DatabaseInstance | Sql;

function getRawSql(db: DbOrSql): any {
  if ('$client' in db) {
    return (db as any).$client;
  }
  return db;
}

// ---------------------------------------------------------------------------
// Node Access Verification (Zero-Leakage 404 for Private Nodes)
// ---------------------------------------------------------------------------

async function verifyNodeAccess(
  sql: any,
  params: {
    orgId: string;
    nodeId: string;
    userId: string;
    role: string;
  }
): Promise<{ id: string; name: string; kind: 'team' | 'project'; visibility: 'public' | 'private' }> {
  const isPrivileged = params.role === 'owner' || params.role === 'admin';

  const [node] = await sql`
    SELECT id, name, kind, visibility
    FROM nodes
    WHERE org_id = ${params.orgId}
      AND id = ${params.nodeId}
      AND archived_at IS NULL
  `;

  if (!node) {
    throw new NotFoundError(`Node with ID "${params.nodeId}" not found`);
  }

  if (node.visibility === 'private' && !isPrivileged) {
    const [membership] = await sql`
      SELECT 1 FROM node_members
      WHERE org_id = ${params.orgId}
        AND node_id = ${params.nodeId}
        AND user_id = ${params.userId}
    `;

    if (!membership) {
      // Zero leakage: private node access denied returns 404
      throw new NotFoundError(`Node with ID "${params.nodeId}" not found`);
    }
  }

  return {
    id: node.id,
    name: node.name,
    kind: node.kind as 'team' | 'project',
    visibility: node.visibility as 'public' | 'private',
  };
}

// ---------------------------------------------------------------------------
// 1. Create Document (Initializes Version 1 Snapshot)
// ---------------------------------------------------------------------------

export async function createDoc(
  db: DbOrSql,
  params: {
    orgId: string;
    actorUserId: string;
    role: string;
    input: CreateDocInput;
  }
): Promise<DocDTO> {
  if (params.role === 'viewer') {
    throw new ForbiddenError('Viewers are not permitted to create documents');
  }

  const rawSql = getRawSql(db);

  return await rawSql.begin(async (sql: any) => {
    // 1. Verify node exists and caller has access
    const node = await verifyNodeAccess(sql, {
      orgId: params.orgId,
      nodeId: params.input.nodeId,
      userId: params.actorUserId,
      role: params.role,
    });

    const docId = generateUuidV7();
    const version1Id = generateUuidV7();
    const title = params.input.title.trim();
    const bodyMd = sanitizeMarkdown(params.input.bodyMd || '');

    // 2. Insert document row with version = 1
    await sql`
      INSERT INTO docs (
        id, org_id, node_id, title, body_md, body_json,
        version, created_by, updated_by, created_at, updated_at
      ) VALUES (
        ${docId}, ${params.orgId}, ${node.id}, ${title}, ${bodyMd}, NULL,
        1, ${params.actorUserId}, ${params.actorUserId}, NOW(), NOW()
      )
    `;

    // 3. Create immutable initial snapshot (version 1)
    await sql`
      INSERT INTO doc_versions (
        id, org_id, doc_id, version, title, body_md, body_json,
        created_by, created_at
      ) VALUES (
        ${version1Id}, ${params.orgId}, ${docId}, 1, ${title}, ${bodyMd}, NULL,
        ${params.actorUserId}, NOW()
      )
    `;

    // 4. Record activity log entry
    await sql`
      INSERT INTO activity_log (
        id, org_id, actor_id, verb, target_type, target_id, payload, created_at
      ) VALUES (
        ${generateUuidV7()}, ${params.orgId}, ${params.actorUserId}, 'doc.created', 'doc', ${docId},
        ${JSON.stringify({ docId, version: 1, title, nodeId: node.id })}::jsonb,
        NOW()
      )
    `;

    // 5. Record transactional outbox event (privacy safe: excludes full body)
    await insertOutboxEvent(sql, {
      orgId: params.orgId,
      topic: 'doc.created',
      payload: {
        docId,
        orgId: params.orgId,
        nodeId: node.id,
        version: 1,
        title,
        actorUserId: params.actorUserId,
      },
    });

    return await getDocById(sql, {
      orgId: params.orgId,
      docId,
      userId: params.actorUserId,
      role: params.role,
    });
  });
}

// ---------------------------------------------------------------------------
// 2. Get Document by ID (Permission-Safe)
// ---------------------------------------------------------------------------

export async function getDocById(
  db: DbOrSql,
  params: {
    orgId: string;
    docId: string;
    userId: string;
    role: string;
    includeArchived?: boolean;
  }
): Promise<DocDTO> {
  const sql = getRawSql(db);
  const isPrivileged = params.role === 'owner' || params.role === 'admin';

  const [row] = await sql`
    SELECT
      d.id, d.org_id as "orgId", d.node_id as "nodeId",
      d.title, d.body_md as "bodyMd", d.version,
      d.created_by as "createdBy", d.updated_by as "updatedBy",
      d.archived_at as "archivedAt",
      d.created_at as "createdAt", d.updated_at as "updatedAt",
      n.name as "nodeName", n.kind as "nodeKind", n.visibility as "nodeVisibility",
      cu.name as "creatorName", cu.email as "creatorEmail",
      uu.name as "updaterName", uu.email as "updaterEmail"
    FROM docs d
    JOIN nodes n ON n.id = d.node_id AND n.org_id = d.org_id AND n.archived_at IS NULL
    LEFT JOIN users cu ON cu.id = d.created_by
    LEFT JOIN users uu ON uu.id = d.updated_by
    WHERE d.org_id = ${params.orgId}
      AND d.id = ${params.docId}
      ${params.includeArchived ? sql`` : sql`AND d.archived_at IS NULL`}
  `;

  if (!row) {
    throw new NotFoundError(`Document with ID "${params.docId}" not found`);
  }

  // Check private node permission (Zero leakage -> 404)
  if (row.nodeVisibility === 'private' && !isPrivileged) {
    const [membership] = await sql`
      SELECT 1 FROM node_members
      WHERE org_id = ${params.orgId}
        AND node_id = ${row.nodeId}
        AND user_id = ${params.userId}
    `;

    if (!membership) {
      throw new NotFoundError(`Document with ID "${params.docId}" not found`);
    }
  }

  return {
    id: row.id,
    orgId: row.orgId,
    nodeId: row.nodeId,
    title: row.title,
    bodyMd: row.bodyMd,
    version: row.version,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    creator: row.createdBy
      ? { id: row.createdBy, name: row.creatorName || 'Unknown', email: row.creatorEmail || '' }
      : null,
    updater: row.updatedBy
      ? { id: row.updatedBy, name: row.updaterName || 'Unknown', email: row.updaterEmail || '' }
      : null,
    node: {
      id: row.nodeId,
      name: row.nodeName,
      kind: row.nodeKind as 'team' | 'project',
      visibility: row.nodeVisibility as 'public' | 'private',
    },
    archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 3. List Documents (Node Scoped or Org Scoped with Private Isolation)
// ---------------------------------------------------------------------------

export async function listDocs(
  db: DbOrSql,
  params: {
    orgId: string;
    userId: string;
    role: string;
    query: ListDocsQuery;
  }
): Promise<{ docs: DocListItemDTO[]; nextCursor: string | null }> {
  const sql = getRawSql(db);
  const isPrivileged = params.role === 'owner' || params.role === 'admin';
  const limit = params.query.limit || 50;

  // If specific node requested, verify node access first (throws 404 if private & unauthorized)
  if (params.query.nodeId) {
    await verifyNodeAccess(sql, {
      orgId: params.orgId,
      nodeId: params.query.nodeId,
      userId: params.userId,
      role: params.role,
    });
  }

  let searchCondition = sql``;
  if (params.query.search && params.query.search.trim()) {
    const s = `%${params.query.search.trim()}%`;
    searchCondition = sql`AND (d.title ILIKE ${s} OR d.body_md ILIKE ${s})`;
  }

  let cursorCondition = sql``;
  if (params.query.cursor) {
    // Cursor is ISO timestamp of updated_at
    const cursorDate = new Date(params.query.cursor);
    if (!isNaN(cursorDate.getTime())) {
      cursorCondition = sql`AND d.updated_at < ${cursorDate}`;
    }
  }

  const rows = await sql`
    SELECT
      d.id, d.org_id as "orgId", d.node_id as "nodeId",
      d.title, d.body_md as "bodyMd", d.version,
      d.created_by as "createdBy", d.updated_by as "updatedBy",
      d.archived_at as "archivedAt",
      d.created_at as "createdAt", d.updated_at as "updatedAt",
      n.name as "nodeName", n.kind as "nodeKind", n.visibility as "nodeVisibility",
      cu.name as "creatorName",
      uu.name as "updaterName"
    FROM docs d
    JOIN nodes n ON n.id = d.node_id AND n.org_id = d.org_id AND n.archived_at IS NULL
    LEFT JOIN users cu ON cu.id = d.created_by
    LEFT JOIN users uu ON uu.id = d.updated_by
    WHERE d.org_id = ${params.orgId}
      AND d.archived_at IS NULL
      ${params.query.nodeId ? sql`AND d.node_id = ${params.query.nodeId}` : sql``}
      ${
        isPrivileged
          ? sql``
          : sql`AND (n.visibility = 'public' OR EXISTS (SELECT 1 FROM node_members nm WHERE nm.node_id = n.id AND nm.org_id = d.org_id AND nm.user_id = ${params.userId}))`
      }
      ${searchCondition}
      ${cursorCondition}
    ORDER BY d.updated_at DESC, d.id DESC
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  const docs: DocListItemDTO[] = items.map((r: any) => ({
    id: r.id,
    orgId: r.orgId,
    nodeId: r.nodeId,
    title: r.title,
    version: r.version,
    excerpt: extractMarkdownExcerpt(r.bodyMd, 160),
    creator: r.createdBy ? { id: r.createdBy, name: r.creatorName || 'Unknown' } : null,
    updater: r.updatedBy ? { id: r.updatedBy, name: r.updaterName || 'Unknown' } : null,
    node: {
      id: r.nodeId,
      name: r.nodeName,
      kind: r.nodeKind,
      visibility: r.nodeVisibility,
    },
    archivedAt: r.archivedAt ? new Date(r.archivedAt).toISOString() : null,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
  }));

  const nextCursor =
    hasMore && items.length > 0
      ? new Date(items[items.length - 1].updatedAt).toISOString()
      : null;

  return { docs, nextCursor };
}

// ---------------------------------------------------------------------------
// 4. Update Document (If-Match OCC, No-Op Check, 30-Version Retention)
// ---------------------------------------------------------------------------

export async function updateDoc(
  db: DbOrSql,
  params: {
    orgId: string;
    docId: string;
    actorUserId: string;
    role: string;
    ifMatchVersion: number;
    input: UpdateDocInput;
  }
): Promise<DocDTO> {
  if (params.role === 'viewer') {
    throw new ForbiddenError('Viewers are not permitted to edit documents');
  }

  const rawSql = getRawSql(db);

  return await rawSql.begin(async (sql: any) => {
    // 1. Fetch and lock document row
    const [current] = await sql`
      SELECT id, org_id as "orgId", node_id as "nodeId", title, body_md as "bodyMd",
             version, archived_at as "archivedAt"
      FROM docs
      WHERE org_id = ${params.orgId} AND id = ${params.docId}
      FOR UPDATE
    `;

    if (!current || current.archivedAt) {
      throw new NotFoundError(`Document with ID "${params.docId}" not found`);
    }

    // 2. Verify caller has access to the document's node (zero leakage -> 404)
    await verifyNodeAccess(sql, {
      orgId: params.orgId,
      nodeId: current.nodeId,
      userId: params.actorUserId,
      role: params.role,
    });

    // 3. Concurrency check: If-Match version must match current document version
    if (current.version !== params.ifMatchVersion) {
      const fresh = await getDocById(sql, {
        orgId: params.orgId,
        docId: params.docId,
        userId: params.actorUserId,
        role: params.role,
      });
      throw new PreconditionFailedError(
        `Version conflict: document has been modified to version ${current.version} (requested ${params.ifMatchVersion})`,
        fresh
      );
    }

    // 4. Prepare target content
    const targetTitle = params.input.title !== undefined ? params.input.title.trim() : current.title;
    const targetBodyMd = params.input.bodyMd !== undefined ? sanitizeMarkdown(params.input.bodyMd) : current.bodyMd;

    // 5. No-Op Save Contract: If neither title nor body changed, return immediately without incrementing version or writing events
    if (targetTitle === current.title && targetBodyMd === current.bodyMd) {
      return await getDocById(sql, {
        orgId: params.orgId,
        docId: params.docId,
        userId: params.actorUserId,
        role: params.role,
      });
    }

    // 6. Monotonically increment version
    const newVersion = current.version + 1;

    // 7. Atomic update of document record
    const [updated] = await sql`
      UPDATE docs
      SET title = ${targetTitle},
          body_md = ${targetBodyMd},
          version = ${newVersion},
          updated_by = ${params.actorUserId},
          updated_at = NOW()
      WHERE org_id = ${params.orgId}
        AND id = ${params.docId}
        AND version = ${params.ifMatchVersion}
      RETURNING *
    `;

    if (!updated) {
      const fresh = await getDocById(sql, {
        orgId: params.orgId,
        docId: params.docId,
        userId: params.actorUserId,
        role: params.role,
      });
      throw new PreconditionFailedError(
        'Concurrent modification detected during document update',
        fresh
      );
    }

    // 8. Create immutable version snapshot
    const versionSnapshotId = generateUuidV7();
    await sql`
      INSERT INTO doc_versions (
        id, org_id, doc_id, version, title, body_md, body_json,
        created_by, created_at
      ) VALUES (
        ${versionSnapshotId}, ${params.orgId}, ${params.docId}, ${newVersion},
        ${targetTitle}, ${targetBodyMd}, NULL, ${params.actorUserId}, NOW()
      )
    `;

    // 9. Retention Pruning Contract: Retain strictly latest 30 snapshots, delete oldest beyond 30 in the same transaction
    await sql`
      DELETE FROM doc_versions
      WHERE org_id = ${params.orgId}
        AND doc_id = ${params.docId}
        AND id IN (
          SELECT id FROM doc_versions
          WHERE org_id = ${params.orgId} AND doc_id = ${params.docId}
          ORDER BY version DESC
          OFFSET ${MAX_RETAINED_VERSIONS}
        )
    `;

    // 10. Record activity log entry
    await sql`
      INSERT INTO activity_log (
        id, org_id, actor_id, verb, target_type, target_id, payload, created_at
      ) VALUES (
        ${generateUuidV7()}, ${params.orgId}, ${params.actorUserId}, 'doc.updated', 'doc', ${params.docId},
        ${JSON.stringify({ docId: params.docId, version: newVersion, title: targetTitle, nodeId: current.nodeId })}::jsonb,
        NOW()
      )
    `;

    // 11. Transactional outbox event
    await insertOutboxEvent(sql, {
      orgId: params.orgId,
      topic: 'doc.updated',
      payload: {
        docId: params.docId,
        orgId: params.orgId,
        nodeId: current.nodeId,
        version: newVersion,
        title: targetTitle,
        actorUserId: params.actorUserId,
      },
    });

    return await getDocById(sql, {
      orgId: params.orgId,
      docId: params.docId,
      userId: params.actorUserId,
      role: params.role,
    });
  });
}

// ---------------------------------------------------------------------------
// 5. List Retained Doc Versions (Up to 30 Latest Snapshots)
// ---------------------------------------------------------------------------

export async function listDocVersions(
  db: DbOrSql,
  params: {
    orgId: string;
    docId: string;
    userId: string;
    role: string;
  }
): Promise<DocVersionDTO[]> {
  const sql = getRawSql(db);

  // Verify access to parent document first (404 on private node if unauthorized)
  await getDocById(sql, {
    orgId: params.orgId,
    docId: params.docId,
    userId: params.userId,
    role: params.role,
  });

  const rows = await sql`
    SELECT
      dv.id, dv.org_id as "orgId", dv.doc_id as "docId", dv.version,
      dv.title, dv.body_md as "bodyMd", dv.created_by as "createdBy",
      dv.created_at as "createdAt",
      u.name as "creatorName", u.email as "creatorEmail"
    FROM doc_versions dv
    LEFT JOIN users u ON u.id = dv.created_by
    WHERE dv.org_id = ${params.orgId}
      AND dv.doc_id = ${params.docId}
    ORDER BY dv.version DESC
    LIMIT ${MAX_RETAINED_VERSIONS}
  `;

  return rows.map((r: any) => ({
    id: r.id,
    orgId: r.orgId,
    docId: r.docId,
    version: r.version,
    title: r.title,
    bodyMd: r.bodyMd,
    createdBy: r.createdBy,
    creator: r.createdBy
      ? { id: r.createdBy, name: r.creatorName || 'Unknown', email: r.creatorEmail || '' }
      : null,
    createdAt: new Date(r.createdAt).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// 6. Get Specific Retained Doc Version Snapshot
// ---------------------------------------------------------------------------

export async function getDocVersion(
  db: DbOrSql,
  params: {
    orgId: string;
    docId: string;
    version: number;
    userId: string;
    role: string;
  }
): Promise<DocVersionDTO> {
  const sql = getRawSql(db);

  // Verify access to parent document first
  await getDocById(sql, {
    orgId: params.orgId,
    docId: params.docId,
    userId: params.userId,
    role: params.role,
  });

  const [row] = await sql`
    SELECT
      dv.id, dv.org_id as "orgId", dv.doc_id as "docId", dv.version,
      dv.title, dv.body_md as "bodyMd", dv.created_by as "createdBy",
      dv.created_at as "createdAt",
      u.name as "creatorName", u.email as "creatorEmail"
    FROM doc_versions dv
    LEFT JOIN users u ON u.id = dv.created_by
    WHERE dv.org_id = ${params.orgId}
      AND dv.doc_id = ${params.docId}
      AND dv.version = ${params.version}
  `;

  if (!row) {
    throw new NotFoundError(
      `Version ${params.version} of document "${params.docId}" not found or has been pruned by the 30-version retention policy`
    );
  }

  return {
    id: row.id,
    orgId: row.orgId,
    docId: row.docId,
    version: row.version,
    title: row.title,
    bodyMd: row.bodyMd,
    createdBy: row.createdBy,
    creator: row.createdBy
      ? { id: row.createdBy, name: row.creatorName || 'Unknown', email: row.creatorEmail || '' }
      : null,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 7. Restore Version (Creates NEW Monotonic Version from Historical Snapshot)
// ---------------------------------------------------------------------------

export async function restoreDocVersion(
  db: DbOrSql,
  params: {
    orgId: string;
    docId: string;
    targetVersion: number;
    actorUserId: string;
    role: string;
    ifMatchVersion: number;
  }
): Promise<DocDTO> {
  if (params.role === 'viewer') {
    throw new ForbiddenError('Viewers are not permitted to restore documents');
  }

  const rawSql = getRawSql(db);

  return await rawSql.begin(async (sql: any) => {
    // 1. Fetch and lock current document row
    const [current] = await sql`
      SELECT id, org_id as "orgId", node_id as "nodeId", title, body_md as "bodyMd",
             version, archived_at as "archivedAt"
      FROM docs
      WHERE org_id = ${params.orgId} AND id = ${params.docId}
      FOR UPDATE
    `;

    if (!current || current.archivedAt) {
      throw new NotFoundError(`Document with ID "${params.docId}" not found`);
    }

    // 2. Verify caller has access to the document's node
    await verifyNodeAccess(sql, {
      orgId: params.orgId,
      nodeId: current.nodeId,
      userId: params.actorUserId,
      role: params.role,
    });

    // 3. Concurrency check: If-Match version must match current document version
    if (current.version !== params.ifMatchVersion) {
      const fresh = await getDocById(sql, {
        orgId: params.orgId,
        docId: params.docId,
        userId: params.actorUserId,
        role: params.role,
      });
      throw new PreconditionFailedError(
        `Version conflict: document has been modified to version ${current.version} (requested ${params.ifMatchVersion})`,
        fresh
      );
    }

    // 4. Retrieve target historical snapshot
    const [historical] = await sql`
      SELECT version, title, body_md as "bodyMd"
      FROM doc_versions
      WHERE org_id = ${params.orgId}
        AND doc_id = ${params.docId}
        AND version = ${params.targetVersion}
    `;

    if (!historical) {
      throw new NotFoundError(
        `Version ${params.targetVersion} to restore was not found or has been pruned by the 30-version retention policy`
      );
    }

    // 5. Monotonically increment version: NEVER decrement or overwrite historical snapshots
    const newVersion = current.version + 1;

    // 6. Update document with historical snapshot content
    const [updated] = await sql`
      UPDATE docs
      SET title = ${historical.title},
          body_md = ${historical.bodyMd},
          version = ${newVersion},
          updated_by = ${params.actorUserId},
          updated_at = NOW()
      WHERE org_id = ${params.orgId}
        AND id = ${params.docId}
        AND version = ${params.ifMatchVersion}
      RETURNING *
    `;

    if (!updated) {
      const fresh = await getDocById(sql, {
        orgId: params.orgId,
        docId: params.docId,
        userId: params.actorUserId,
        role: params.role,
      });
      throw new PreconditionFailedError(
        'Concurrent modification detected during version restore',
        fresh
      );
    }

    // 7. Insert new version snapshot
    const newSnapshotId = generateUuidV7();
    await sql`
      INSERT INTO doc_versions (
        id, org_id, doc_id, version, title, body_md, body_json,
        created_by, created_at
      ) VALUES (
        ${newSnapshotId}, ${params.orgId}, ${params.docId}, ${newVersion},
        ${historical.title}, ${historical.bodyMd}, NULL, ${params.actorUserId}, NOW()
      )
    `;

    // 8. Retention pruning (keep strictly latest 30 snapshots)
    await sql`
      DELETE FROM doc_versions
      WHERE org_id = ${params.orgId}
        AND doc_id = ${params.docId}
        AND id IN (
          SELECT id FROM doc_versions
          WHERE org_id = ${params.orgId} AND doc_id = ${params.docId}
          ORDER BY version DESC
          OFFSET ${MAX_RETAINED_VERSIONS}
        )
    `;

    // 9. Record activity log entry
    await sql`
      INSERT INTO activity_log (
        id, org_id, actor_id, verb, target_type, target_id, payload, created_at
      ) VALUES (
        ${generateUuidV7()}, ${params.orgId}, ${params.actorUserId}, 'doc.restored', 'doc', ${params.docId},
        ${JSON.stringify({
          docId: params.docId,
          version: newVersion,
          restoredFromVersion: params.targetVersion,
          title: historical.title,
          nodeId: current.nodeId,
        })}::jsonb,
        NOW()
      )
    `;

    // 10. Transactional outbox event
    await insertOutboxEvent(sql, {
      orgId: params.orgId,
      topic: 'doc.restored',
      payload: {
        docId: params.docId,
        orgId: params.orgId,
        nodeId: current.nodeId,
        version: newVersion,
        restoredFromVersion: params.targetVersion,
        title: historical.title,
        actorUserId: params.actorUserId,
      },
    });

    return await getDocById(sql, {
      orgId: params.orgId,
      docId: params.docId,
      userId: params.actorUserId,
      role: params.role,
    });
  });
}

// ---------------------------------------------------------------------------
// 8. Archive Document (Soft-Delete with If-Match OCC)
// ---------------------------------------------------------------------------

export async function archiveDoc(
  db: DbOrSql,
  params: {
    orgId: string;
    docId: string;
    actorUserId: string;
    role: string;
    ifMatchVersion: number;
  }
): Promise<DocDTO> {
  if (params.role === 'viewer') {
    throw new ForbiddenError('Viewers are not permitted to archive documents');
  }

  const rawSql = getRawSql(db);

  return await rawSql.begin(async (sql: any) => {
    // 1. Fetch and lock document
    const [current] = await sql`
      SELECT id, org_id as "orgId", node_id as "nodeId", title, version, archived_at as "archivedAt"
      FROM docs
      WHERE org_id = ${params.orgId} AND id = ${params.docId}
      FOR UPDATE
    `;

    if (!current || current.archivedAt) {
      throw new NotFoundError(`Document with ID "${params.docId}" not found`);
    }

    // 2. Verify node access
    await verifyNodeAccess(sql, {
      orgId: params.orgId,
      nodeId: current.nodeId,
      userId: params.actorUserId,
      role: params.role,
    });

    // 3. Concurrency check
    if (current.version !== params.ifMatchVersion) {
      const fresh = await getDocById(sql, {
        orgId: params.orgId,
        docId: params.docId,
        userId: params.actorUserId,
        role: params.role,
      });
      throw new PreconditionFailedError(
        `Version conflict: document has been modified to version ${current.version} (requested ${params.ifMatchVersion})`,
        fresh
      );
    }

    const newVersion = current.version + 1;

    // 4. Update archived_at
    const [archived] = await sql`
      UPDATE docs
      SET archived_at = NOW(),
          version = ${newVersion},
          updated_by = ${params.actorUserId},
          updated_at = NOW()
      WHERE org_id = ${params.orgId}
        AND id = ${params.docId}
        AND version = ${params.ifMatchVersion}
      RETURNING *
    `;

    if (!archived) {
      const fresh = await getDocById(sql, {
        orgId: params.orgId,
        docId: params.docId,
        userId: params.actorUserId,
        role: params.role,
        includeArchived: true,
      });
      throw new PreconditionFailedError(
        'Concurrent modification detected during document archival',
        fresh
      );
    }

    // 5. Activity log entry
    await sql`
      INSERT INTO activity_log (
        id, org_id, actor_id, verb, target_type, target_id, payload, created_at
      ) VALUES (
        ${generateUuidV7()}, ${params.orgId}, ${params.actorUserId}, 'doc.archived', 'doc', ${params.docId},
        ${JSON.stringify({ docId: params.docId, title: current.title, nodeId: current.nodeId })}::jsonb,
        NOW()
      )
    `;

    // 6. Outbox event
    await insertOutboxEvent(sql, {
      orgId: params.orgId,
      topic: 'doc.archived',
      payload: {
        docId: params.docId,
        orgId: params.orgId,
        nodeId: current.nodeId,
        version: newVersion,
        actorUserId: params.actorUserId,
      },
    });

    return await getDocById(sql, {
      orgId: params.orgId,
      docId: params.docId,
      userId: params.actorUserId,
      role: params.role,
      includeArchived: true,
    });
  });
}
