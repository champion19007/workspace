import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  PreconditionFailedError,
  generateUuidV7,
} from '@workspace/core';
import { insertOutboxEvent } from './outbox-operations.js';
import { markNodesDirty } from './rollup-operations.js';
import { tenantSql, type DbOrSql } from './client.js';

export type { DbOrSql };

/**
 * Converts a UUID into a PostgreSQL ltree-compatible label.
 * UUID hyphens are replaced with underscores to maintain valid ltree label syntax (^[A-Za-z0-9_]+$).
 */
export function uuidToLtreeLabel(id: string): string {
  return id.replace(/-/g, '_');
}

/**
 * Converts an ltree label back to standard UUID format with hyphens.
 */
export function ltreeLabelToUuid(label: string): string {
  return label.replace(/_/g, '-');
}

export type NodeKind = 'team' | 'project';
export type NodeVisibility = 'public' | 'private';

export interface NodeRecord {
  id: string;
  orgId: string;
  parentId: string | null;
  kind: NodeKind;
  name: string;
  description: string | null;
  path: string;
  visibility: NodeVisibility;
  keyPrefix?: string | null;
  rollup: Record<string, unknown>;
  version: number;
  createdBy: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TreeNodeItem extends NodeRecord {
  depth: number;
  hasMoreChildren?: boolean;
  children?: TreeNodeItem[];
}

export interface CreateNodeInput {
  orgId: string;
  userId: string;
  role: string;
  name: string;
  kind: NodeKind;
  parentId?: string | null;
  visibility?: NodeVisibility;
  description?: string | null;
}

export interface UpdateNodeInput {
  orgId: string;
  nodeId: string;
  actorUserId: string;
  role: string;
  ifMatchVersion?: number;
  name?: string;
  description?: string | null;
  visibility?: NodeVisibility;
}

export interface MoveNodeInput {
  orgId: string;
  nodeId: string;
  newParentId: string | null;
  actorUserId: string;
  role: string;
  ifMatchVersion?: number;
}

export interface DeleteNodeInput {
  orgId: string;
  nodeId: string;
  actorUserId: string;
  role: string;
  ifMatchVersion?: number;
  archive?: boolean;
}

export interface NodeMemberRecord {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: Date;
}

/**
 * Checks whether an actor can view a private node based on role or explicit node_members entry.
 */
export async function canUserAccessNode(
  target: DbOrSql,
  params: { orgId: string; nodeId: string; userId: string; role: string }
): Promise<boolean> {
  const sql = tenantSql(target, { orgId: params.orgId, userId: params.userId, role: params.role });
  const { orgId, nodeId, userId, role } = params;

  // Owners and Admins have administrative visibility across all org nodes
  if (role === 'owner' || role === 'admin') {
    return true;
  }

  // Check node visibility and membership
  const [row] = await sql`
    SELECT 
      n.visibility,
      EXISTS (
        SELECT 1 FROM node_members nm 
        WHERE nm.org_id = ${orgId} 
          AND nm.node_id = ${nodeId} 
          AND nm.user_id = ${userId}
      ) as is_member
    FROM nodes n
    WHERE n.org_id = ${orgId} AND n.id = ${nodeId} AND n.archived_at IS NULL
  `;

  if (!row) return false;
  if (row.visibility === 'public') return true;
  return Boolean(row.is_member);
}

/**
 * Creates a team or project node in the organization hierarchy.
 */
export async function createNode(
  target: DbOrSql,
  input: CreateNodeInput
): Promise<NodeRecord> {
  const sql = tenantSql(target, { orgId: input.orgId, userId: input.userId, role: input.role });
  const { orgId, userId, role, name, kind, parentId, description } = input;
  const visibility = input.visibility ?? 'public';

  if (!name || name.trim().length === 0 || name.length > 255) {
    throw new ValidationError('Node name must be between 1 and 255 characters');
  }

  if (kind !== 'team' && kind !== 'project') {
    throw new ValidationError('Node kind must be either "team" or "project"');
  }

  // Only Owners and Admins can create teams or manage structure
  if (role === 'viewer') {
    throw new ForbiddenError('Viewers are not authorized to create nodes');
  }

  if (kind === 'team' && role !== 'owner' && role !== 'admin') {
    throw new ForbiddenError('Only organization Owners and Admins can create teams');
  }

  // Projects MUST be nested under an existing team
  if (kind === 'project' && !parentId) {
    throw new ValidationError('Projects must be created under a team; root projects are not permitted');
  }

  return sql.begin(async (txn) => {
    let parentPath: string | null = null;

    if (parentId) {
      const [parent] = await txn<NodeRecord[]>`
        SELECT id, org_id, parent_id, kind, name, path, visibility, rollup, version, 
               created_by as "createdBy", archived_at as "archivedAt", 
               created_at as "createdAt", updated_at as "updatedAt"
        FROM nodes
        WHERE id = ${parentId} AND org_id = ${orgId} AND archived_at IS NULL
        FOR SHARE
      `;

      if (!parent) {
        throw new NotFoundError(`Parent node "${parentId}" does not exist in this organization`);
      }

      if (parent.kind === 'project') {
        throw new ValidationError('A project cannot be a parent node. Nodes can only be created under teams.');
      }

      // Check if actor has access to parent
      const canAccessParent = await canUserAccessNode(txn as any, { orgId, nodeId: parentId, userId, role });
      if (!canAccessParent) {
        throw new NotFoundError(`Parent node "${parentId}" does not exist or is inaccessible`);
      }

      parentPath = parent.path;
    }

    // Generate node ID and ltree path
    const nodeId = generateUuidV7();
    const label = uuidToLtreeLabel(nodeId);
    const path = parentPath ? `${parentPath}.${label}` : label;

    // No RETURNING: under RLS a private node becomes visible to a non-admin creator only once the creator's
    // node membership exists, so it is read back after that row is written.
    await txn`
      INSERT INTO nodes (
        id, org_id, parent_id, kind, name, description, path, visibility, rollup, version, created_by
      )
      VALUES (
        ${nodeId}, ${orgId}, ${parentId ?? null}, ${kind}, ${name.trim()}, 
        ${description?.trim() ?? null}, ${path}::ltree, ${visibility}, '{}'::jsonb, 1, ${userId}
      )
    `;

    // For private projects, immediately grant membership to creator in the same transaction
    if (visibility === 'private') {
      await txn`
        INSERT INTO node_members (org_id, node_id, user_id)
        VALUES (${orgId}, ${nodeId}, ${userId})
        ON CONFLICT DO NOTHING
      `;
    }

    const [created] = await txn<NodeRecord[]>`
      SELECT
        id, org_id as "orgId", parent_id as "parentId", kind, name, description,
        key_prefix as "keyPrefix",
        path::text as path, visibility, rollup, version, created_by as "createdBy",
        archived_at as "archivedAt", created_at as "createdAt", updated_at as "updatedAt"
      FROM nodes
      WHERE id = ${nodeId} AND org_id = ${orgId}
    `;

    if (!created) {
      throw new Error('Failed to create node record');
    }

    // Write transactional outbox event
    await insertOutboxEvent(txn as any, {
      orgId,
      topic: 'node.created',
      payload: {
        nodeId: created.id,
        kind: created.kind,
        name: created.name,
        path: created.path,
        parentId: created.parentId,
        visibility: created.visibility,
        actorUserId: userId,
      },
    });

    return created;
  });
}

/**
 * Retrieves a single node by ID, verifying tenancy and private project permissions.
 */
export async function getNodeById(
  target: DbOrSql,
  params: { orgId: string; nodeId: string; userId: string; role: string; includeArchived?: boolean }
): Promise<NodeRecord> {
  const sql = tenantSql(target, { orgId: params.orgId, userId: params.userId, role: params.role });
  const { orgId, nodeId, userId, role, includeArchived = false } = params;

  const [node] = await sql<NodeRecord[]>`
    SELECT 
      id, org_id as "orgId", parent_id as "parentId", kind, name, description,
      path::text as path, visibility, rollup, version, created_by as "createdBy",
      archived_at as "archivedAt", created_at as "createdAt", updated_at as "updatedAt"
    FROM nodes
    WHERE id = ${nodeId} 
      AND org_id = ${orgId}
      ${includeArchived ? sql`` : sql`AND archived_at IS NULL`}
  `;

  if (!node) {
    throw new NotFoundError(`Node "${nodeId}" not found`);
  }

  // Verify access for private projects
  if (node.visibility === 'private' && role !== 'owner' && role !== 'admin') {
    const isMember = await canUserAccessNode(sql, { orgId, nodeId, userId, role });
    if (!isMember) {
      // Do not leak existence of private node to unauthorized users
      throw new NotFoundError(`Node "${nodeId}" not found`);
    }
  }

  return node;
}

/**
 * Retrieves the organization tree with bounded depth loading and zero private project leakage.
 */
export async function getTree(
  target: DbOrSql,
  params: {
    orgId: string;
    userId: string;
    role: string;
    rootNodeId?: string | null;
    depth?: number;
    includeArchived?: boolean;
  }
): Promise<TreeNodeItem[]> {
  const sql = tenantSql(target, { orgId: params.orgId, userId: params.userId, role: params.role });
  const { orgId, userId, role, rootNodeId, depth = 3, includeArchived = false } = params;

  let rootPath: string | null = null;
  let rootLevel = 0;

  if (rootNodeId) {
    const rootNode = await getNodeById(sql, { orgId, nodeId: rootNodeId, userId, role, includeArchived });
    rootPath = rootNode.path;
    rootLevel = rootPath.split('.').length;
  }

  // Fetch nodes in subtree up to depth
  const isPrivileged = role === 'owner' || role === 'admin';

  const rows = await sql`
    SELECT 
      n.id, 
      n.org_id as "orgId", 
      n.parent_id as "parentId", 
      n.kind, 
      n.name, 
      n.description,
      n.path::text as path, 
      n.visibility, 
      n.rollup, 
      n.version, 
      n.created_by as "createdBy",
      n.archived_at as "archivedAt", 
      n.created_at as "createdAt", 
      n.updated_at as "updatedAt",
      nlevel(n.path) as "nlevel"
    FROM nodes n
    WHERE n.org_id = ${orgId}
      ${includeArchived ? sql`` : sql`AND n.archived_at IS NULL`}
      ${rootPath ? sql`AND n.path <@ ${rootPath}::ltree` : sql``}
      ${depth > 0 && rootPath ? sql`AND nlevel(n.path) <= ${rootLevel + depth}` : sql``}
      ${depth > 0 && !rootPath ? sql`AND nlevel(n.path) <= ${depth}` : sql``}
      -- Private project filter: allowed if public, privileged, or user is explicit member
      AND (
        n.visibility = 'public' 
        OR ${isPrivileged}
        OR EXISTS (
          SELECT 1 FROM node_members nm 
          WHERE nm.org_id = ${orgId} AND nm.node_id = n.id AND nm.user_id = ${userId}
        )
      )
    ORDER BY nlevel(n.path) ASC, n.kind ASC, n.name ASC, n.id ASC
  `;

  return rows.map((r) => {
    const relativeDepth = rootPath ? r.nlevel - rootLevel : r.nlevel - 1;
    return {
      id: r.id,
      orgId: r.orgId,
      parentId: r.parentId,
      kind: r.kind as NodeKind,
      name: r.name,
      description: r.description,
      path: r.path,
      visibility: r.visibility as NodeVisibility,
      rollup: r.rollup ?? {},
      version: r.version,
      createdBy: r.createdBy,
      archivedAt: r.archivedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      depth: relativeDepth,
    };
  });
}

/**
 * Lists projects visible to the user with optional team scoping and search.
 */
export async function listProjects(
  target: DbOrSql,
  params: {
    orgId: string;
    userId: string;
    role: string;
    teamId?: string | null;
    search?: string | null;
    limit?: number;
    cursor?: string | null;
  }
): Promise<{ projects: (NodeRecord & { teamName: string | null; memberCount: number })[]; totalCount: number }> {
  const sql = tenantSql(target, { orgId: params.orgId, userId: params.userId, role: params.role });
  const { orgId, userId, role, teamId, search, limit = 50 } = params;
  const isPrivileged = role === 'owner' || role === 'admin';

  let teamPath: string | null = null;
  if (teamId) {
    const [team] = await sql`
      SELECT path::text as path FROM nodes WHERE id = ${teamId} AND org_id = ${orgId} AND archived_at IS NULL
    `;
    if (team) {
      teamPath = team.path;
    }
  }

  const query = sql`
    SELECT 
      n.id, 
      n.org_id as "orgId", 
      n.parent_id as "parentId", 
      n.kind, 
      n.name, 
      n.description,
      n.path::text as path, 
      n.visibility, 
      n.rollup, 
      n.version, 
      n.created_by as "createdBy",
      n.archived_at as "archivedAt", 
      n.created_at as "createdAt", 
      n.updated_at as "updatedAt",
      p.name as "teamName",
      (
        SELECT count(*)::int FROM node_members nm 
        WHERE nm.org_id = ${orgId} AND nm.node_id = n.id
      ) as "memberCount"
    FROM nodes n
    LEFT JOIN nodes p ON n.parent_id = p.id AND p.org_id = ${orgId}
    WHERE n.org_id = ${orgId}
      AND n.kind = 'project'
      AND n.archived_at IS NULL
      ${teamPath ? sql`AND n.path <@ ${teamPath}::ltree` : sql``}
      ${search ? sql`AND n.name ILIKE ${'%' + search.trim() + '%'}` : sql``}
      AND (
        n.visibility = 'public' 
        OR ${isPrivileged}
        OR EXISTS (
          SELECT 1 FROM node_members nm 
          WHERE nm.org_id = ${orgId} AND nm.node_id = n.id AND nm.user_id = ${userId}
        )
      )
    ORDER BY n.name ASC, n.id ASC
    LIMIT ${limit}
  `;

  const rows = await query;

  const [countResult] = await sql`
    SELECT count(*)::int as total
    FROM nodes n
    WHERE n.org_id = ${orgId}
      AND n.kind = 'project'
      AND n.archived_at IS NULL
      ${teamPath ? sql`AND n.path <@ ${teamPath}::ltree` : sql``}
      ${search ? sql`AND n.name ILIKE ${'%' + search.trim() + '%'}` : sql``}
      AND (
        n.visibility = 'public' 
        OR ${isPrivileged}
        OR EXISTS (
          SELECT 1 FROM node_members nm 
          WHERE nm.org_id = ${orgId} AND nm.node_id = n.id AND nm.user_id = ${userId}
        )
      )
  `;

  const projects = rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    parentId: r.parentId,
    kind: r.kind as NodeKind,
    name: r.name,
    description: r.description,
    path: r.path,
    visibility: r.visibility as NodeVisibility,
    rollup: r.rollup ?? {},
    version: r.version,
    createdBy: r.createdBy,
    archivedAt: r.archivedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    teamName: r.teamName,
    memberCount: r.memberCount,
  }));

  return { projects, totalCount: countResult?.total ?? projects.length };
}

/**
 * Updates a node (name, description, visibility) with OCC version verification.
 * Renaming a team updates ONLY the target node; descendant paths remain intact.
 */
export async function updateNode(
  target: DbOrSql,
  input: UpdateNodeInput
): Promise<NodeRecord> {
  const sql = tenantSql(target, { orgId: input.orgId, userId: input.actorUserId, role: input.role });
  const { orgId, nodeId, actorUserId, role, ifMatchVersion, name, description, visibility } = input;

  if (role === 'viewer') {
    throw new ForbiddenError('Viewers are not authorized to modify nodes');
  }

  // Renaming teams or changing visibility requires Owner or Admin
  const [existing] = await sql<NodeRecord[]>`
    SELECT 
      id, org_id as "orgId", parent_id as "parentId", kind, name, description,
      path::text as path, visibility, rollup, version, created_by as "createdBy",
      archived_at as "archivedAt", created_at as "createdAt", updated_at as "updatedAt"
    FROM nodes
    WHERE id = ${nodeId} AND org_id = ${orgId} AND archived_at IS NULL
  `;

  if (!existing) {
    throw new NotFoundError(`Node "${nodeId}" not found`);
  }

  if (ifMatchVersion !== undefined && existing.version !== ifMatchVersion) {
    throw new PreconditionFailedError(
      `Resource version mismatch: client provided ${ifMatchVersion}, current database version is ${existing.version}`,
      existing
    );
  }

  if (existing.kind === 'team' && role !== 'owner' && role !== 'admin') {
    throw new ForbiddenError('Only organization Owners and Admins can modify team structure');
  }

  if (visibility && visibility !== existing.visibility && role !== 'owner' && role !== 'admin') {
    throw new ForbiddenError('Only organization Owners and Admins can change node visibility');
  }

  const updatedName = name !== undefined ? name.trim() : existing.name;
  if (!updatedName || updatedName.length === 0 || updatedName.length > 255) {
    throw new ValidationError('Node name must be between 1 and 255 characters');
  }

  const updatedDescription = description !== undefined ? (description?.trim() ?? null) : existing.description;
  const updatedVisibility = visibility !== undefined ? visibility : existing.visibility;

  return sql.begin(async (txn) => {
    const [updated] = await txn<NodeRecord[]>`
      UPDATE nodes
      SET 
        name = ${updatedName},
        description = ${updatedDescription},
        visibility = ${updatedVisibility},
        version = version + 1,
        updated_at = NOW()
      WHERE id = ${nodeId} 
        AND org_id = ${orgId}
        ${ifMatchVersion !== undefined ? sql`AND version = ${ifMatchVersion}` : sql``}
      RETURNING 
        id, org_id as "orgId", parent_id as "parentId", kind, name, description,
        path::text as path, visibility, rollup, version, created_by as "createdBy",
        archived_at as "archivedAt", created_at as "createdAt", updated_at as "updatedAt"
    `;

    if (!updated) {
      throw new ConflictError('Concurrent edit conflict during node update');
    }

    // Outbox event
    await insertOutboxEvent(txn as any, {
      orgId,
      topic: 'node.updated',
      payload: {
        nodeId,
        oldName: existing.name,
        newName: updated.name,
        oldVisibility: existing.visibility,
        newVisibility: updated.visibility,
        version: updated.version,
        actorUserId,
      },
    });

    return updated;
  });
}

/**
 * Moves a node and its entire subtree beneath a new parent.
 * Implements W-3: Atomic transaction with deadlock-safe row locking and cycle prevention.
 */
export async function moveSubtree(
  target: DbOrSql,
  input: MoveNodeInput
): Promise<{ movedRoot: NodeRecord; affectedCount: number }> {
  const sql = tenantSql(target, { orgId: input.orgId, userId: input.actorUserId, role: input.role });
  const { orgId, nodeId, newParentId, actorUserId, role, ifMatchVersion } = input;

  if (role !== 'owner' && role !== 'admin') {
    throw new ForbiddenError('Only organization Owners and Admins are authorized to move hierarchy nodes');
  }

  if (nodeId === newParentId) {
    throw new ValidationError('A node cannot be its own parent');
  }

  return sql.begin(async (txn) => {
    // 1. Lock source and destination in deterministic sorted order to prevent deadlocks
    const idsToLock = [nodeId, newParentId].filter(Boolean) as string[];
    idsToLock.sort();

    const lockedNodes = await txn<NodeRecord[]>`
      SELECT 
        id, org_id as "orgId", parent_id as "parentId", kind, name, description,
        path::text as path, visibility, rollup, version, created_by as "createdBy",
        archived_at as "archivedAt", created_at as "createdAt", updated_at as "updatedAt"
      FROM nodes
      WHERE id IN ${txn(idsToLock)} AND org_id = ${orgId} AND archived_at IS NULL
      ORDER BY id ASC
      FOR UPDATE
    `;

    const source = lockedNodes.find((n) => n.id === nodeId);
    if (!source) {
      throw new NotFoundError(`Source node "${nodeId}" not found in this organization`);
    }

    if (ifMatchVersion !== undefined && source.version !== ifMatchVersion) {
      throw new PreconditionFailedError(
        `Precondition failed: source node version is ${source.version}, expected ${ifMatchVersion}`,
        source
      );
    }

    let newParent: NodeRecord | null = null;
    let newRootPath: string;

    if (newParentId) {
      newParent = lockedNodes.find((n) => n.id === newParentId) ?? null;
      if (!newParent) {
        throw new NotFoundError(`Destination parent node "${newParentId}" not found in this organization`);
      }

      if (newParent.kind === 'project') {
        throw new ValidationError('Cannot move nodes under a project; projects are leaves');
      }

      // 2. Strict cycle prevention: destination cannot be within source's subtree
      const sourcePath = source.path;
      const destPath = newParent.path;

      if (destPath === sourcePath || destPath.startsWith(`${sourcePath}.`)) {
        throw new ValidationError('Cannot move a node beneath its own descendant (hierarchy cycle prevented)');
      }

      const sourceLabel = uuidToLtreeLabel(nodeId);
      newRootPath = `${destPath}.${sourceLabel}`;
    } else {
      // Moving to root
      if (source.kind === 'project') {
        throw new ValidationError('Projects cannot be placed at root; projects must reside under a team');
      }
      newRootPath = uuidToLtreeLabel(nodeId);
    }

    // If parent didn't change, no-op
    if (source.parentId === newParentId) {
      return { movedRoot: source, affectedCount: 1 };
    }

    const oldPath = source.path;

    // 3. Atomic subtree rewrite using CASE ltree formula
    const updatedSubtree = await txn<NodeRecord[]>`
      UPDATE nodes
      SET 
        parent_id = CASE WHEN id = ${nodeId} THEN ${newParentId} ELSE parent_id END,
        path = CASE 
                 WHEN path = ${oldPath}::ltree THEN ${newRootPath}::ltree
                 ELSE ${newRootPath}::ltree || subpath(path, nlevel(${oldPath}::ltree))
               END,
        version = version + 1,
        updated_at = NOW()
      WHERE org_id = ${orgId}
        AND path <@ ${oldPath}::ltree
      RETURNING 
        id, org_id as "orgId", parent_id as "parentId", kind, name, description,
        path::text as path, visibility, rollup, version, created_by as "createdBy",
        archived_at as "archivedAt", created_at as "createdAt", updated_at as "updatedAt"
    `;

    const movedRoot = updatedSubtree.find((n) => n.id === nodeId);
    if (!movedRoot) {
      throw new Error('Failed to update moved node');
    }

    // 4. Update any chunks referencing the old node_path
    await txn`
      UPDATE chunks
      SET node_path = CASE 
                        WHEN node_path = ${oldPath}::ltree THEN ${newRootPath}::ltree
                        ELSE ${newRootPath}::ltree || subpath(node_path, nlevel(${oldPath}::ltree))
                      END
      WHERE org_id = ${orgId} AND node_path <@ ${oldPath}::ltree;
    `;

    // 5. Transactional outbox event
    await insertOutboxEvent(txn as any, {
      orgId,
      topic: 'node.moved',
      payload: {
        nodeId,
        oldParentId: source.parentId,
        newParentId,
        oldPath,
        newPath: newRootPath,
        affectedCount: updatedSubtree.length,
        actorUserId,
      },
    });

    // 6. Invalidate rollups for moved subtree, old ancestors, and new ancestors
    const nodeIdsToInvalidate = [nodeId];
    if (source.parentId) nodeIdsToInvalidate.push(source.parentId);
    if (newParentId) nodeIdsToInvalidate.push(newParentId);
    await markNodesDirty(txn as any, {
      orgId,
      nodeIds: nodeIdsToInvalidate,
    });

    return { movedRoot, affectedCount: updatedSubtree.length };
  });
}

/**
 * Safely deletes or archives a node.
 * Non-empty teams or projects with active content require explicit archiving.
 */
export async function deleteOrArchiveNode(
  target: DbOrSql,
  input: DeleteNodeInput
): Promise<{ deleted: boolean; archived: boolean; affectedCount: number }> {
  const sql = tenantSql(target, { orgId: input.orgId, userId: input.actorUserId, role: input.role });
  const { orgId, nodeId, actorUserId, role, ifMatchVersion, archive = false } = input;

  if (role !== 'owner' && role !== 'admin') {
    throw new ForbiddenError('Only organization Owners and Admins can delete or archive hierarchy nodes');
  }

  return sql.begin(async (txn) => {
    const [node] = await txn<NodeRecord[]>`
      SELECT 
        id, org_id as "orgId", parent_id as "parentId", kind, name, description,
        path::text as path, visibility, rollup, version, created_by as "createdBy",
        archived_at as "archivedAt", created_at as "createdAt", updated_at as "updatedAt"
      FROM nodes
      WHERE id = ${nodeId} AND org_id = ${orgId} AND archived_at IS NULL
      FOR UPDATE
    `;

    if (!node) {
      throw new NotFoundError(`Node "${nodeId}" not found in this organization`);
    }

    if (ifMatchVersion !== undefined && node.version !== ifMatchVersion) {
      throw new PreconditionFailedError(
        `Precondition failed: current node version is ${node.version}, expected ${ifMatchVersion}`,
        node
      );
    }

    // Check for child nodes
    const [childrenCountRow] = await txn`
      SELECT count(*)::int as count 
      FROM nodes 
      WHERE org_id = ${orgId} AND parent_id = ${nodeId} AND archived_at IS NULL
    `;
    const childCount = childrenCountRow?.count ?? 0;

    // Check for content in projects
    let hasContent = false;
    if (node.kind === 'project') {
      const [taskCount] = await txn`
        SELECT count(*)::int as count FROM tasks WHERE org_id = ${orgId} AND project_id = ${nodeId}
      `;
      const [docCount] = await txn`
        SELECT count(*)::int as count FROM docs WHERE org_id = ${orgId} AND node_id = ${nodeId}
      `;
      const [meetingCount] = await txn`
        SELECT count(*)::int as count FROM meetings WHERE org_id = ${orgId} AND node_id = ${nodeId}
      `;
      hasContent = ((taskCount?.count ?? 0) + (docCount?.count ?? 0) + (meetingCount?.count ?? 0)) > 0;
    }

    // If archiving requested or required due to non-empty subtree/content
    if (archive || childCount > 0 || hasContent) {
      if (!archive && childCount > 0) {
        throw new ConflictError(
          `Team "${node.name}" contains ${childCount} active child nodes. Move children or specify archive=true to archive the subtree.`
        );
      }
      if (!archive && hasContent) {
        throw new ConflictError(
          `Project "${node.name}" contains active tasks, documents, or meetings. Specify archive=true to archive rather than delete.`
        );
      }

      // Archive subtree
      const updated = await txn<NodeRecord[]>`
        UPDATE nodes
        SET archived_at = NOW(), version = version + 1
        WHERE org_id = ${orgId} AND path <@ ${node.path}::ltree AND archived_at IS NULL
        RETURNING id
      `;

      await insertOutboxEvent(txn as any, {
        orgId,
        topic: 'node.archived',
        payload: {
          nodeId,
          path: node.path,
          affectedCount: updated.length,
          actorUserId,
        },
      });

      return { deleted: false, archived: true, affectedCount: updated.length };
    }

    // Clean leaf node with zero children and zero content can be deleted
    await txn`
      DELETE FROM nodes WHERE id = ${nodeId} AND org_id = ${orgId}
    `;

    await insertOutboxEvent(txn as any, {
      orgId,
      topic: 'node.deleted',
      payload: {
        nodeId,
        name: node.name,
        path: node.path,
        actorUserId,
      },
    });

    return { deleted: true, archived: false, affectedCount: 1 };
  });
}

/**
 * Lists explicit members of a private node.
 */
export async function listNodeMembers(
  target: DbOrSql,
  params: { orgId: string; nodeId: string; actorUserId: string; role: string }
): Promise<NodeMemberRecord[]> {
  const sql = tenantSql(target, { orgId: params.orgId, userId: params.actorUserId, role: params.role });
  const { orgId, nodeId, actorUserId, role } = params;

  const canAccess = await canUserAccessNode(sql, { orgId, nodeId, userId: actorUserId, role });
  if (!canAccess) {
    throw new NotFoundError(`Node "${nodeId}" not found or inaccessible`);
  }

  const rows = await sql`
    SELECT 
      nm.user_id as "userId",
      u.email,
      u.name,
      m.role,
      nm.created_at as "createdAt"
    FROM node_members nm
    JOIN users u ON nm.user_id = u.id
    JOIN memberships m ON nm.org_id = m.org_id AND nm.user_id = m.user_id
    WHERE nm.org_id = ${orgId} AND nm.node_id = ${nodeId}
    ORDER BY u.email ASC
  `;

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    role: r.role,
    createdAt: r.createdAt,
  }));
}

/**
 * Adds an organization member to a private node's member list.
 */
export async function addNodeMember(
  target: DbOrSql,
  params: { orgId: string; nodeId: string; targetUserId: string; actorUserId: string; role: string }
): Promise<void> {
  const sql = tenantSql(target, { orgId: params.orgId, userId: params.actorUserId, role: params.role });
  const { orgId, nodeId, targetUserId, actorUserId, role } = params;

  if (role !== 'owner' && role !== 'admin') {
    // Only Owners, Admins, or existing private members can add members
    const isMember = await canUserAccessNode(sql, { orgId, nodeId, userId: actorUserId, role });
    if (!isMember) {
      throw new ForbiddenError('You do not have permission to manage members for this private project');
    }
  }

  // Ensure target user belongs to the organization
  const [membership] = await sql`
    SELECT role FROM memberships WHERE org_id = ${orgId} AND user_id = ${targetUserId}
  `;
  if (!membership) {
    throw new NotFoundError('Target user is not a member of this organization');
  }

  // Ensure node exists and is in org
  const [node] = await sql`
    SELECT id, visibility FROM nodes WHERE id = ${nodeId} AND org_id = ${orgId} AND archived_at IS NULL
  `;
  if (!node) {
    throw new NotFoundError(`Node "${nodeId}" not found`);
  }

  await sql`
    INSERT INTO node_members (org_id, node_id, user_id)
    VALUES (${orgId}, ${nodeId}, ${targetUserId})
    ON CONFLICT DO NOTHING
  `;
}

/**
 * Removes a member from a private node.
 */
export async function removeNodeMember(
  target: DbOrSql,
  params: { orgId: string; nodeId: string; targetUserId: string; actorUserId: string; role: string }
): Promise<void> {
  const sql = tenantSql(target, { orgId: params.orgId, userId: params.actorUserId, role: params.role });
  const { orgId, nodeId, targetUserId, actorUserId, role } = params;

  // Actor can remove themselves, or Owners/Admins can remove any member
  if (actorUserId !== targetUserId && role !== 'owner' && role !== 'admin') {
    throw new ForbiddenError('Only organization Owners and Admins can remove other members from private projects');
  }

  await sql`
    DELETE FROM node_members 
    WHERE org_id = ${orgId} AND node_id = ${nodeId} AND user_id = ${targetUserId}
  `;
}
