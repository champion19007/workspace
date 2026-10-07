import {
  type NodeRollupDTO,
  type ProjectDashboardDTO,
  type LeadershipSummaryDTO,
  type LeadershipSummaryQuery,
  type ActivityItemDTO,
  type TaskStatus,
  type TaskPriority,
  computeHealthStatus,
  computeCompletionPercentage,
  addCalendarDays,
  getKolkataTodayDateString,
  NotFoundError,
} from '@workspace/core';
import type { DbOrSql } from './node-operations.js';
import { insertOutboxEvent } from './outbox-operations.js';

function getRawSql(db: DbOrSql): any {
  if (typeof (db as any).unsafe === 'function') {
    return db;
  }
  return (db as any).$client;
}

// ---------------------------------------------------------------------------
// 1. Direct Project Rollup Calculation (SQL Parity)
// ---------------------------------------------------------------------------

export async function calculateProjectRollup(
  db: DbOrSql,
  params: {
    orgId: string;
    projectId: string;
    dateContext?: string;
    generation?: number;
  }
): Promise<NodeRollupDTO> {
  const sql = getRawSql(db);
  const dateContext = params.dateContext || getKolkataTodayDateString();
  const datePlus7 = addCalendarDays(dateContext, 7);
  const generation = params.generation ?? 1;

  // Single-query rollup aggregation
  const [counts] = await sql`
    SELECT
      -- Top-level tasks
      COUNT(*) FILTER (WHERE parent_task_id IS NULL AND archived_at IS NULL)::int as "totalTasks",
      COUNT(*) FILTER (WHERE parent_task_id IS NULL AND archived_at IS NULL AND status IN ('todo', 'in_progress', 'blocked'))::int as "openTasks",
      COUNT(*) FILTER (WHERE parent_task_id IS NULL AND archived_at IS NULL AND status = 'in_progress')::int as "inProgressTasks",
      COUNT(*) FILTER (WHERE parent_task_id IS NULL AND archived_at IS NULL AND status = 'done')::int as "completedTasks",
      COUNT(*) FILTER (WHERE parent_task_id IS NULL AND archived_at IS NULL AND status = 'blocked')::int as "blockedTasks",
      COUNT(*) FILTER (WHERE parent_task_id IS NULL AND archived_at IS NULL AND assignee_id IS NULL AND status IN ('todo', 'in_progress', 'blocked'))::int as "unassignedTasks",
      COUNT(*) FILTER (WHERE parent_task_id IS NULL AND archived_at IS NULL AND status != 'done' AND due_date IS NOT NULL AND due_date < ${dateContext}::date)::int as "overdueTopLevel",
      COUNT(*) FILTER (WHERE parent_task_id IS NULL AND archived_at IS NULL AND status != 'done' AND due_date IS NOT NULL AND due_date >= ${dateContext}::date AND due_date <= ${datePlus7}::date)::int as "dueSoonTopLevel",

      -- Subtasks
      COUNT(*) FILTER (WHERE parent_task_id IS NOT NULL AND archived_at IS NULL)::int as "totalSubtasks",
      COUNT(*) FILTER (WHERE parent_task_id IS NOT NULL AND archived_at IS NULL AND status IN ('todo', 'in_progress', 'blocked'))::int as "openSubtasks",
      COUNT(*) FILTER (WHERE parent_task_id IS NOT NULL AND archived_at IS NULL AND status = 'done')::int as "completedSubtasks",
      COUNT(*) FILTER (WHERE parent_task_id IS NOT NULL AND archived_at IS NULL AND status != 'done' AND due_date IS NOT NULL AND due_date < ${dateContext}::date)::int as "overdueSubtasks",
      COUNT(*) FILTER (WHERE parent_task_id IS NOT NULL AND archived_at IS NULL AND status != 'done' AND due_date IS NOT NULL AND due_date >= ${dateContext}::date AND due_date <= ${datePlus7}::date)::int as "dueSoonSubtasks"
    FROM tasks
    WHERE org_id = ${params.orgId}
      AND project_id = ${params.projectId}
  `;

  const totalTasks = counts?.totalTasks ?? 0;
  const openTasks = counts?.openTasks ?? 0;
  const inProgressTasks = counts?.inProgressTasks ?? 0;
  const completedTasks = counts?.completedTasks ?? 0;
  const blockedTasks = counts?.blockedTasks ?? 0;
  const unassignedCount = counts?.unassignedTasks ?? 0;

  const totalSubtasks = counts?.totalSubtasks ?? 0;
  const openSubtasks = counts?.openSubtasks ?? 0;
  const completedSubtasks = counts?.completedSubtasks ?? 0;

  // Overdue and Due-Soon include subtasks so unfinished subtasks trigger health risk!
  const overdueCount = (counts?.overdueTopLevel ?? 0) + (counts?.overdueSubtasks ?? 0);
  const dueSoonCount = (counts?.dueSoonTopLevel ?? 0) + (counts?.dueSoonSubtasks ?? 0);

  const completionPercentage = computeCompletionPercentage(completedTasks, totalTasks);
  const health = computeHealthStatus({
    totalTasks,
    totalSubtasks,
    overdueCount,
    dueSoonCount,
  });

  return {
    health,
    completionPercentage,
    tasks: {
      total: totalTasks,
      open: openTasks,
      inProgress: inProgressTasks,
      completed: completedTasks,
      blocked: blockedTasks,
    },
    subtasks: {
      total: totalSubtasks,
      open: openSubtasks,
      completed: completedSubtasks,
    },
    overdueCount,
    dueSoonCount,
    unassignedCount,
    provenance: {
      computedAt: new Date().toISOString(),
      rulesVersion: '1.0.0',
      dateContext,
      generation,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Marking Nodes Dirty with Debounce & Ancestry Invalidation
// ---------------------------------------------------------------------------

export async function markNodesDirty(
  db: DbOrSql,
  params: {
    orgId: string;
    nodeIds: string[];
    debounceSeconds?: number;
  }
): Promise<string[]> {
  const sql = getRawSql(db);
  const debounceSeconds = params.debounceSeconds ?? 10;
  if (!params.nodeIds.length) return [];

  // Find all ancestor node IDs by inspecting path of all requested nodes
  const nodes = await sql`
    SELECT id, path::text as path
    FROM nodes
    WHERE org_id = ${params.orgId}
      AND id IN ${sql(params.nodeIds)}
  `;

  const affectedIdSet = new Set<string>();
  for (const n of nodes) {
    affectedIdSet.add(n.id);
    if (n.path) {
      // Path format is label.label... where labels are base32/hex representations of uuids
      // Query ancestors via ltree containment
      const ancestors = await sql`
        SELECT id FROM nodes
        WHERE org_id = ${params.orgId}
          AND ${n.path}::ltree <@ path
      `;
      for (const anc of ancestors) {
        affectedIdSet.add(anc.id);
      }
    }
  }

  const affectedIds = Array.from(affectedIdSet);
  if (!affectedIds.length) return [];

  // Record dirty generation with debounce watermark
  for (const nodeId of affectedIds) {
    await sql`
      INSERT INTO node_rollup_dirty (
        node_id, org_id, dirty_generation, requested_at, debounce_until
      )
      VALUES (
        ${nodeId}, ${params.orgId}, 1, now(), now() + (${debounceSeconds} || ' seconds')::interval
      )
      ON CONFLICT (node_id) DO UPDATE SET
        dirty_generation = node_rollup_dirty.dirty_generation + 1,
        requested_at = now(),
        debounce_until = now() + (${debounceSeconds} || ' seconds')::interval,
        locked_at = NULL,
        locked_by = NULL
    `;

    // Also write an outbox event so workers or event listeners can trigger processing
    await insertOutboxEvent(db, {
      orgId: params.orgId,
      topic: 'rollup',
      payload: {
        orgId: params.orgId,
        nodeId,
      },
    });
  }

  return affectedIds;
}

// ---------------------------------------------------------------------------
// 3. Worker Bottom-Up Recomputation & Generational Watermark Check
// ---------------------------------------------------------------------------

export async function recomputeAndStoreNodeRollup(
  db: DbOrSql,
  params: {
    orgId: string;
    nodeId: string;
    targetGeneration?: number;
  }
): Promise<NodeRollupDTO | null> {
  const sql = getRawSql(db);

  // Check node kind
  const [node] = await sql`
    SELECT id, kind, path::text as path
    FROM nodes
    WHERE id = ${params.nodeId} AND org_id = ${params.orgId} AND archived_at IS NULL
  `;

  if (!node) {
    // Delete dirty entry if node was deleted or archived
    await sql`DELETE FROM node_rollup_dirty WHERE node_id = ${params.nodeId}`;
    return null;
  }

  // Get current dirty generation
  const [dirty] = await sql`
    SELECT dirty_generation as "dirtyGeneration"
    FROM node_rollup_dirty
    WHERE node_id = ${params.nodeId}
  `;
  const generation = params.targetGeneration ?? (dirty?.dirtyGeneration ?? 1);

  let rollup: NodeRollupDTO;

  if (node.kind === 'project') {
    rollup = await calculateProjectRollup(db, {
      orgId: params.orgId,
      projectId: params.nodeId,
      generation,
    });
  } else {
    // Team: sum all accessible leaf projects under this team's path
    const leafProjects = await sql`
      SELECT id, rollup
      FROM nodes
      WHERE org_id = ${params.orgId}
        AND kind = 'project'
        AND archived_at IS NULL
        AND path <@ ${node.path}::ltree
    `;

    // Sum project rollups
    let totalTasks = 0;
    let openTasks = 0;
    let inProgressTasks = 0;
    let completedTasks = 0;
    let blockedTasks = 0;
    let unassignedCount = 0;

    let totalSubtasks = 0;
    let openSubtasks = 0;
    let completedSubtasks = 0;

    let overdueCount = 0;
    let dueSoonCount = 0;

    for (const p of leafProjects) {
      const pRollup = p.rollup as NodeRollupDTO;
      if (pRollup && pRollup.tasks) {
        totalTasks += pRollup.tasks.total;
        openTasks += pRollup.tasks.open;
        inProgressTasks += pRollup.tasks.inProgress;
        completedTasks += pRollup.tasks.completed;
        blockedTasks += pRollup.tasks.blocked;
        unassignedCount += pRollup.unassignedCount;

        totalSubtasks += pRollup.subtasks?.total ?? 0;
        openSubtasks += pRollup.subtasks?.open ?? 0;
        completedSubtasks += pRollup.subtasks?.completed ?? 0;

        overdueCount += pRollup.overdueCount ?? 0;
        dueSoonCount += pRollup.dueSoonCount ?? 0;
      }
    }

    const completionPercentage = computeCompletionPercentage(completedTasks, totalTasks);
    const health = computeHealthStatus({
      totalTasks,
      totalSubtasks,
      overdueCount,
      dueSoonCount,
    });

    rollup = {
      health,
      completionPercentage,
      tasks: {
        total: totalTasks,
        open: openTasks,
        inProgress: inProgressTasks,
        completed: completedTasks,
        blocked: blockedTasks,
      },
      subtasks: {
        total: totalSubtasks,
        open: openSubtasks,
        completed: completedSubtasks,
      },
      overdueCount,
      dueSoonCount,
      unassignedCount,
      provenance: {
        computedAt: new Date().toISOString(),
        rulesVersion: '1.0.0',
        dateContext: getKolkataTodayDateString(),
        generation,
      },
    };
  }

  // Atomically write rollup to nodes table
  await sql`
    UPDATE nodes
    SET rollup = ${JSON.stringify(rollup)}::jsonb,
        updated_at = now()
    WHERE id = ${params.nodeId} AND org_id = ${params.orgId}
  `;

  // Check if a newer mutation arrived during recomputation (generational watermark check)
  // Delete dirty row only if dirty_generation <= generation we processed
  await sql`
    DELETE FROM node_rollup_dirty
    WHERE node_id = ${params.nodeId}
      AND dirty_generation <= ${generation}
  `;

  return rollup;
}

/**
 * Worker batch claim and processing of debounced rollup jobs.
 */
export async function processDueRollupJobs(
  db: DbOrSql,
  params: {
    workerId: string;
    limit?: number;
  }
): Promise<number> {
  const sql = getRawSql(db);
  const limit = params.limit ?? 20;

  // Claim due dirty nodes with FOR UPDATE SKIP LOCKED
  const claimed = await sql`
    WITH to_claim AS (
      SELECT node_id, org_id
      FROM node_rollup_dirty
      WHERE debounce_until <= now()
        AND (locked_at IS NULL OR locked_at < now() - interval '60 seconds')
      ORDER BY requested_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE node_rollup_dirty d
    SET locked_at = now(),
        locked_by = ${params.workerId}
    FROM to_claim c
    WHERE d.node_id = c.node_id
    RETURNING d.node_id as "nodeId", d.org_id as "orgId"
  `;

  let count = 0;
  for (const item of claimed) {
    try {
      await recomputeAndStoreNodeRollup(db, {
        orgId: item.orgId,
        nodeId: item.nodeId,
      });
      count++;
    } catch {
      // Unlock on failure so it can be retried
      await sql`
        UPDATE node_rollup_dirty
        SET locked_at = NULL, locked_by = NULL
        WHERE node_id = ${item.nodeId}
      `;
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// 4. Permission-Safe Rollup Reads (Projects & Teams)
// ---------------------------------------------------------------------------

export async function getPermissionSafeRollup(
  db: DbOrSql,
  params: {
    orgId: string;
    nodeId: string;
    userId: string;
    role: string;
    dateContext?: string;
  }
): Promise<NodeRollupDTO> {
  const sql = getRawSql(db);
  const dateContext = params.dateContext || getKolkataTodayDateString();
  const isPrivileged = params.role === 'owner' || params.role === 'admin';

  const [node] = await sql`
    SELECT id, kind, name, visibility, path::text as path, rollup
    FROM nodes
    WHERE id = ${params.nodeId} AND org_id = ${params.orgId} AND archived_at IS NULL
  `;

  if (!node) {
    throw new NotFoundError(`Node with ID "${params.nodeId}" not found`);
  }

  if (node.kind === 'project') {
    // Check permission: private projects require explicit node membership or owner/admin
    if (node.visibility === 'private' && !isPrivileged) {
      const [member] = await sql`
        SELECT 1 FROM node_members
        WHERE org_id = ${params.orgId} AND node_id = ${params.nodeId} AND user_id = ${params.userId}
      `;
      if (!member) {
        throw new NotFoundError(`Node with ID "${params.nodeId}" not found`);
      }
    }

    const cached = node.rollup as NodeRollupDTO;
    const [dirty] = await sql`
      SELECT dirty_generation FROM node_rollup_dirty
      WHERE org_id = ${params.orgId} AND node_id = ${params.nodeId}
    `;

    // Check if cached rollup is missing, dateContext is stale, or node is dirty
    if (
      !cached ||
      !cached.provenance ||
      cached.provenance.dateContext !== dateContext ||
      dirty
    ) {
      const targetGen = dirty?.dirty_generation ?? cached?.provenance?.generation ?? 1;
      const fresh = await calculateProjectRollup(db, {
        orgId: params.orgId,
        projectId: params.nodeId,
        dateContext,
        generation: targetGen,
      });
      // Update cache in database
      await sql`
        UPDATE nodes
        SET rollup = ${JSON.stringify(fresh)}::jsonb
        WHERE id = ${params.nodeId} AND org_id = ${params.orgId}
      `;
      if (dirty) {
        await sql`
          DELETE FROM node_rollup_dirty
          WHERE org_id = ${params.orgId}
            AND node_id = ${params.nodeId}
            AND dirty_generation <= ${targetGen}
        `;
      }
      return fresh;
    }

    return cached;
  }

  // Node is a team: sum ONLY accessible leaf projects under this team's path
  const accessibleProjects = await sql`
    SELECT p.id, p.rollup
    FROM nodes p
    WHERE p.org_id = ${params.orgId}
      AND p.kind = 'project'
      AND p.archived_at IS NULL
      AND p.path <@ ${node.path}::ltree
      AND (
        p.visibility = 'public'
        OR ${isPrivileged}
        OR EXISTS (
          SELECT 1 FROM node_members nm
          WHERE nm.org_id = ${params.orgId} AND nm.node_id = p.id AND nm.user_id = ${params.userId}
        )
      )
  `;

  let totalTasks = 0;
  let openTasks = 0;
  let inProgressTasks = 0;
  let completedTasks = 0;
  let blockedTasks = 0;
  let unassignedCount = 0;

  let totalSubtasks = 0;
  let openSubtasks = 0;
  let completedSubtasks = 0;

  let overdueCount = 0;
  let dueSoonCount = 0;

  for (const p of accessibleProjects) {
    let pRollup = p.rollup as NodeRollupDTO;
    const [pDirty] = await sql`
      SELECT dirty_generation FROM node_rollup_dirty
      WHERE org_id = ${params.orgId} AND node_id = ${p.id}
    `;

    if (
      !pRollup ||
      !pRollup.provenance ||
      pRollup.provenance.dateContext !== dateContext ||
      pDirty
    ) {
      const pGen = pDirty?.dirty_generation ?? pRollup?.provenance?.generation ?? 1;
      pRollup = await calculateProjectRollup(db, {
        orgId: params.orgId,
        projectId: p.id,
        dateContext,
        generation: pGen,
      });
      await sql`
        UPDATE nodes
        SET rollup = ${JSON.stringify(pRollup)}::jsonb
        WHERE id = ${p.id} AND org_id = ${params.orgId}
      `;
      if (pDirty) {
        await sql`
          DELETE FROM node_rollup_dirty
          WHERE org_id = ${params.orgId}
            AND node_id = ${p.id}
            AND dirty_generation <= ${pGen}
        `;
      }
    }

    if (pRollup && pRollup.tasks) {
      totalTasks += pRollup.tasks.total;
      openTasks += pRollup.tasks.open;
      inProgressTasks += pRollup.tasks.inProgress;
      completedTasks += pRollup.tasks.completed;
      blockedTasks += pRollup.tasks.blocked;
      unassignedCount += pRollup.unassignedCount;

      totalSubtasks += pRollup.subtasks?.total ?? 0;
      openSubtasks += pRollup.subtasks?.open ?? 0;
      completedSubtasks += pRollup.subtasks?.completed ?? 0;

      overdueCount += pRollup.overdueCount ?? 0;
      dueSoonCount += pRollup.dueSoonCount ?? 0;
    }
  }

  const completionPercentage = computeCompletionPercentage(completedTasks, totalTasks);
  const health = computeHealthStatus({
    totalTasks,
    totalSubtasks,
    overdueCount,
    dueSoonCount,
  });

  return {
    health,
    completionPercentage,
    tasks: {
      total: totalTasks,
      open: openTasks,
      inProgress: inProgressTasks,
      completed: completedTasks,
      blocked: blockedTasks,
    },
    subtasks: {
      total: totalSubtasks,
      open: openSubtasks,
      completed: completedSubtasks,
    },
    overdueCount,
    dueSoonCount,
    unassignedCount,
    provenance: {
      computedAt: new Date().toISOString(),
      rulesVersion: '1.0.0',
      dateContext,
      generation: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Project Dashboard (Screenshot 927)
// ---------------------------------------------------------------------------

export async function getProjectDashboard(
  db: DbOrSql,
  params: {
    orgId: string;
    projectId: string;
    userId: string;
    role: string;
    dateContext?: string;
  }
): Promise<ProjectDashboardDTO> {
  const sql = getRawSql(db);
  const isPrivileged = params.role === 'owner' || params.role === 'admin';

  const [project] = await sql`
    SELECT
      p.id,
      p.name,
      p.description,
      p.key_prefix as "keyPrefix",
      p.visibility,
      p.parent_id as "parentId",
      p.created_at as "createdAt",
      p.updated_at as "updatedAt",
      t.name as "teamName"
    FROM nodes p
    LEFT JOIN nodes t ON t.id = p.parent_id AND t.org_id = ${params.orgId}
    WHERE p.id = ${params.projectId}
      AND p.org_id = ${params.orgId}
      AND p.kind = 'project'
      AND p.archived_at IS NULL
  `;

  if (!project) {
    throw new NotFoundError(`Project "${params.projectId}" not found`);
  }

  // Check private access
  if (project.visibility === 'private' && !isPrivileged) {
    const [member] = await sql`
      SELECT 1 FROM node_members
      WHERE org_id = ${params.orgId} AND node_id = ${params.projectId} AND user_id = ${params.userId}
    `;
    if (!member) {
      throw new NotFoundError(`Project "${params.projectId}" not found`);
    }
  }

  // Get fresh permission-safe rollup
  const rollup = await getPermissionSafeRollup(db, {
    orgId: params.orgId,
    nodeId: params.projectId,
    userId: params.userId,
    role: params.role,
    dateContext: params.dateContext,
  });

  // Recent activity feed from activity_log
  const activityRows = await sql`
    SELECT
      al.id,
      al.verb,
      al.target_type as "targetType",
      al.target_id as "targetId",
      al.payload,
      al.created_at as "createdAt",
      u.id as "actorId",
      u.name as "actorName",
      u.email as "actorEmail"
    FROM activity_log al
    LEFT JOIN users u ON u.id = al.actor_id
    WHERE al.org_id = ${params.orgId}
      AND (
        al.target_id = ${params.projectId}
        OR (al.payload->>'projectId')::uuid = ${params.projectId}
        OR EXISTS (
          SELECT 1 FROM tasks tk
          WHERE tk.id = al.target_id AND tk.project_id = ${params.projectId}
        )
      )
    ORDER BY al.created_at DESC
    LIMIT 15
  `;

  const recentActivity: ActivityItemDTO[] = activityRows.map((r: any) => ({
    id: r.id,
    verb: r.verb,
    targetType: r.targetType,
    targetId: r.targetId,
    targetKey: r.payload?.taskKey ?? r.payload?.key ?? null,
    targetTitle: r.payload?.taskTitle ?? r.payload?.title ?? null,
    actor: {
      id: r.actorId ?? null,
      name: r.actorName ?? null,
      email: r.actorEmail ?? null,
    },
    details: r.payload,
    createdAt: r.createdAt.toISOString ? r.createdAt.toISOString() : String(r.createdAt),
  }));

  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      keyPrefix: project.keyPrefix,
      visibility: project.visibility,
      teamId: project.parentId,
      teamName: project.teamName,
      createdAt: project.createdAt.toISOString ? project.createdAt.toISOString() : String(project.createdAt),
      updatedAt: project.updatedAt.toISOString ? project.updatedAt.toISOString() : String(project.updatedAt),
    },
    rollup,
    recentActivity,
  };
}

// ---------------------------------------------------------------------------
// 6. Leadership Dashboard Summary (Direct SQL Parity)
// ---------------------------------------------------------------------------

export async function getLeadershipSummary(
  db: DbOrSql,
  params: {
    orgId: string;
    userId: string;
    role: string;
    filters?: LeadershipSummaryQuery;
    dateContext?: string;
  }
): Promise<LeadershipSummaryDTO> {
  const sql = getRawSql(db);
  const dateContext = params.dateContext || getKolkataTodayDateString();
  const isPrivileged = params.role === 'owner' || params.role === 'admin';
  const filters = params.filters || {};

  // Fetch optional team path if teamId filter is provided
  let teamPath: string | null = null;
  if (filters.teamId) {
    const [team] = await sql`
      SELECT path::text as path FROM nodes
      WHERE id = ${filters.teamId} AND org_id = ${params.orgId} AND kind = 'team' AND archived_at IS NULL
    `;
    if (team) {
      teamPath = team.path;
    }
  }

  // 1. Fetch all accessible non-archived projects
  const projectRows = await sql`
    SELECT
      p.id,
      p.name,
      p.key_prefix as "keyPrefix",
      p.visibility,
      p.parent_id as "teamId",
      p.path::text as path,
      p.rollup,
      t.name as "teamName"
    FROM nodes p
    LEFT JOIN nodes t ON t.id = p.parent_id AND t.org_id = ${params.orgId}
    WHERE p.org_id = ${params.orgId}
      AND p.kind = 'project'
      AND p.archived_at IS NULL
      ${teamPath ? sql`AND p.path <@ ${teamPath}::ltree` : sql``}
      ${filters.search ? sql`AND (p.name ILIKE ${'%' + filters.search.trim() + '%'} OR p.key_prefix ILIKE ${'%' + filters.search.trim() + '%'})` : sql``}
      AND (
        p.visibility = 'public'
        OR ${isPrivileged}
        OR EXISTS (
          SELECT 1 FROM node_members nm
          WHERE nm.org_id = ${params.orgId} AND nm.node_id = p.id AND nm.user_id = ${params.userId}
        )
      )
    ORDER BY p.name ASC
  `;

  // 2. Evaluate rollups and filter by health if requested
  const projectsWithRollup: any[] = [];
  for (const prj of projectRows) {
    let pRollup = prj.rollup as NodeRollupDTO;
    const [pDirty] = await sql`
      SELECT dirty_generation FROM node_rollup_dirty
      WHERE org_id = ${params.orgId} AND node_id = ${prj.id}
    `;

    if (
      !pRollup ||
      !pRollup.provenance ||
      pRollup.provenance.dateContext !== dateContext ||
      pDirty
    ) {
      const pGen = pDirty?.dirty_generation ?? pRollup?.provenance?.generation ?? 1;
      pRollup = await calculateProjectRollup(db, {
        orgId: params.orgId,
        projectId: prj.id,
        dateContext,
        generation: pGen,
      });
      await sql`
        UPDATE nodes
        SET rollup = ${JSON.stringify(pRollup)}::jsonb
        WHERE id = ${prj.id} AND org_id = ${params.orgId}
      `;
      if (pDirty) {
        await sql`
          DELETE FROM node_rollup_dirty
          WHERE org_id = ${params.orgId}
            AND node_id = ${prj.id}
            AND dirty_generation <= ${pGen}
        `;
      }
    }

    if (filters.health && pRollup.health !== filters.health) {
      continue;
    }

    projectsWithRollup.push({
      id: prj.id,
      name: prj.name,
      keyPrefix: prj.keyPrefix,
      visibility: prj.visibility,
      teamId: prj.teamId,
      teamName: prj.teamName,
      rollup: pRollup,
    });
  }

  // 3. Compute Leadership Summary Counters with direct SQL parity across the filtered projects
  let totalTasks = 0;
  let totalOverdue = 0;
  let totalUnassigned = 0;
  let atRiskProjects = 0;
  let totalCompletion = 0;

  for (const p of projectsWithRollup) {
    totalTasks += p.rollup.tasks.total;
    totalOverdue += p.rollup.overdueCount;
    totalUnassigned += p.rollup.unassignedCount;
    totalCompletion += p.rollup.completionPercentage;
    if (p.rollup.health === 'at_risk') {
      atRiskProjects++;
    }
  }

  const totalProjects = projectsWithRollup.length;
  const averageCompletionPercentage =
    totalProjects === 0 ? 0 : Math.round(totalCompletion / totalProjects);

  // 4. Fetch At-Risk Work drilldown across the accessible projects
  let atRiskTasks: any[] = [];
  if (projectsWithRollup.length > 0) {
    const projectIds = projectsWithRollup.map((p) => p.id);
    const taskRows = await sql`
      SELECT
        t.id,
        t.key,
        t.title,
        t.project_id as "projectId",
        t.status,
        t.priority,
        t.due_date::text as "dueDate",
        p.name as "projectName",
        u.id as "assigneeId",
        u.name as "assigneeName",
        u.email as "assigneeEmail",
        (t.due_date IS NOT NULL AND t.due_date < ${dateContext}::date AND t.status != 'done') as "isOverdue",
        (t.status = 'blocked') as "isBlocked"
      FROM tasks t
      JOIN nodes p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.org_id = ${params.orgId}
        AND t.project_id IN ${sql(projectIds)}
        AND t.archived_at IS NULL
        AND (
          (t.due_date IS NOT NULL AND t.due_date < ${dateContext}::date AND t.status != 'done')
          OR t.status = 'blocked'
        )
      ORDER BY 
        CASE WHEN t.due_date IS NOT NULL AND t.due_date < ${dateContext}::date AND t.status != 'done' THEN 0 ELSE 1 END ASC,
        t.due_date ASC NULLS LAST,
        t.created_at DESC
      LIMIT 50
    `;

    atRiskTasks = taskRows.map((r: any) => ({
      id: r.id,
      key: r.key,
      title: r.title,
      projectId: r.projectId,
      projectName: r.projectName,
      status: r.status as TaskStatus,
      priority: r.priority as TaskPriority,
      dueDate: r.dueDate ?? null,
      assignee: r.assigneeId
        ? { id: r.assigneeId, name: r.assigneeName, email: r.assigneeEmail }
        : null,
      isOverdue: Boolean(r.isOverdue),
      isBlocked: Boolean(r.isBlocked),
    }));
  }

  return {
    summary: {
      totalProjects,
      totalTasks,
      totalOverdue,
      totalUnassigned,
      atRiskProjects,
      averageCompletionPercentage,
    },
    projects: projectsWithRollup,
    atRiskTasks,
  };
}
