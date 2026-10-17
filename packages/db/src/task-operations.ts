import {
  generateUuidV7,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  PreconditionFailedError,
  sanitizeKeyPrefix,
  generateInitialRank,
  generateRankBetween,
  compareRanks,
  isDenseRank,
  generateRebalancedRanks,
  getKolkataTodayDateString,
  type TaskDTO,
  type TaskStatus,
  type TaskPriority,
  type TaskSource,
  type TaskLabelDTO,
  type TaskAssigneeDTO,
  type CreateTaskInput,
  type UpdateTaskInput,
  type CreateLabelInput,
  type MoveTaskInput,
  type MyTasksQuery,
  type MyTaskItemDTO,
  type MyTasksCountsDTO,
  type MyTasksResponseDTO,
} from '@workspace/core';
import { insertOutboxEvent } from './outbox-operations.js';
import { tenantSql, type DbOrSql, type TenantContext } from './client.js';
import { markNodesDirty } from './rollup-operations.js';

const scoped = (db: DbOrSql, context: TenantContext): any => tenantSql(db, context);

// ---------------------------------------------------------------------------
// Internal Permission & Validation Helpers
// ---------------------------------------------------------------------------

interface ProjectAccessContext {
  id: string;
  orgId: string;
  kind: string;
  name: string;
  visibility: 'public' | 'private';
  keyPrefix: string | null;
}

export async function verifyProjectAccess(
  db: DbOrSql,
  params: {
    orgId: string;
    projectId: string;
    userId: string;
    role: string;
  }
): Promise<ProjectAccessContext> {
  const rawSql = scoped(db, { orgId: params.orgId, userId: params.userId, role: params.role });
  const [project] = await rawSql<ProjectAccessContext[]>`
    SELECT id, org_id as "orgId", kind, name, visibility, key_prefix as "keyPrefix"
    FROM nodes
    WHERE org_id = ${params.orgId} AND id = ${params.projectId} AND archived_at IS NULL
  `;

  if (!project) {
    throw new NotFoundError('Project not found');
  }

  if (project.kind !== 'project') {
    throw new ValidationError('Specified node is a team, not a project (tasks must belong to a project)');
  }

  if (project.visibility === 'private') {
    if (params.role !== 'owner' && params.role !== 'admin') {
      const [membership] = await rawSql`
        SELECT 1 FROM node_members
        WHERE org_id = ${params.orgId} AND node_id = ${params.projectId} AND user_id = ${params.userId}
      `;
      if (!membership) {
        // Zero information leakage: fail closed with 404
        throw new NotFoundError('Project not found');
      }
    }
  }

  return project;
}

export async function verifyAssigneeAccess(
  sql: any,
  params: {
    orgId: string;
    projectId: string;
    assigneeId?: string | null;
    projectVisibility: 'public' | 'private';
  }
): Promise<void> {
  if (!params.assigneeId) return;

  const [member] = await sql<{ role: string }[]>`
    SELECT role FROM memberships
    WHERE org_id = ${params.orgId} AND user_id = ${params.assigneeId}
  `;

  if (!member) {
    throw new ValidationError('Assignee is not an active member of the organization');
  }

  if (params.projectVisibility === 'private') {
    if (member.role !== 'owner' && member.role !== 'admin') {
      const [nodeMember] = await sql`
        SELECT 1 FROM node_members
        WHERE org_id = ${params.orgId} AND node_id = ${params.projectId} AND user_id = ${params.assigneeId}
      `;
      if (!nodeMember) {
        throw new ValidationError('Assignee does not have access to this private project');
      }
    }
  }
}

async function verifyLabelOwnership(
  sql: any,
  params: {
    orgId: string;
    labelIds?: string[];
  }
): Promise<void> {
  if (!params.labelIds || params.labelIds.length === 0) return;

  const found = await sql<{ id: string }[]>`
    SELECT id FROM labels
    WHERE org_id = ${params.orgId} AND id IN ${sql(params.labelIds)}
  `;

  if (found.length !== params.labelIds.length) {
    throw new ValidationError('One or more labels do not exist or belong to another organization');
  }
}

async function allocateTaskKey(
  sql: any,
  params: {
    orgId: string;
    projectId: string;
    projectName: string;
    keyPrefix: string | null;
  }
): Promise<string> {
  let prefix = params.keyPrefix;

  if (!prefix) {
    const base = sanitizeKeyPrefix(params.projectName);
    let candidate = base;
    let suffix = 1;

    while (true) {
      const [exists] = await sql`
        SELECT 1 FROM nodes
        WHERE org_id = ${params.orgId} AND key_prefix = ${candidate} AND id != ${params.projectId}
      `;
      if (!exists) break;
      suffix++;
      candidate = `${base.slice(0, 3)}${suffix}`;
    }

    prefix = candidate;
    await sql`
      UPDATE nodes SET key_prefix = ${prefix}
      WHERE org_id = ${params.orgId} AND id = ${params.projectId}
    `;
  }

  // Atomic database sequence counter increment
  const [counter] = await sql<{ lastNumber: number }[]>`
    INSERT INTO project_key_counters (org_id, project_id, prefix, last_number, updated_at)
    VALUES (${params.orgId}, ${params.projectId}, ${prefix}, 1, NOW())
    ON CONFLICT (org_id, prefix) DO UPDATE
    SET last_number = project_key_counters.last_number + 1,
        updated_at = NOW()
    RETURNING last_number as "lastNumber"
  `;

  return `${prefix}-${counter!.lastNumber}`;
}

async function validateAndLockParentTask(
  sql: any,
  params: {
    orgId: string;
    projectId: string;
    parentTaskId: string;
    currentTaskId?: string;
  }
): Promise<void> {
  if (params.currentTaskId && params.parentTaskId === params.currentTaskId) {
    throw new ValidationError('A task cannot parent itself');
  }

  // Lock proposed parent row to prevent race conditions during hierarchy changes
  const [parent] = await sql<{
    id: string;
    projectId: string;
    parentTaskId: string | null;
    archivedAt: string | null;
  }[]>`
    SELECT id, project_id as "projectId", parent_task_id as "parentTaskId", archived_at as "archivedAt"
    FROM tasks
    WHERE org_id = ${params.orgId} AND id = ${params.parentTaskId}
    FOR UPDATE
  `;

  if (!parent || parent.archivedAt) {
    throw new ValidationError('Parent task not found or is archived');
  }

  if (parent.projectId !== params.projectId) {
    throw new ValidationError('Subtask must belong to the same project as its parent');
  }

  if (parent.parentTaskId !== null) {
    throw new ValidationError(
      `One level of subtasks enforced: proposed parent ${params.parentTaskId} is already a subtask`
    );
  }

  if (params.currentTaskId) {
    const [hasChildren] = await sql`
      SELECT 1 FROM tasks
      WHERE org_id = ${params.orgId} AND parent_task_id = ${params.currentTaskId} AND archived_at IS NULL
      LIMIT 1
    `;
    if (hasChildren) {
      throw new ValidationError('Cannot convert a parent task with subtasks into a subtask');
    }
  }
}

// ---------------------------------------------------------------------------
// Domain Operations: Tasks
// ---------------------------------------------------------------------------

export async function createTask(
  db: DbOrSql,
  params: {
    orgId: string;
    actorUserId: string;
    role: string;
    input: CreateTaskInput;
  }
): Promise<TaskDTO> {
  if (params.role === 'viewer') {
    throw new ForbiddenError('Viewers are not permitted to create tasks');
  }

  const rawSql = scoped(db, { orgId: params.orgId, userId: params.actorUserId, role: params.role });

  return await rawSql.begin((sql: any) => createTaskInTransaction(sql, params));
}

/**
 * Task creation body shared by manual creation and approved AI suggestions (Stage 17).
 * Must run inside the caller's transaction. `provenance` is server-set only; clients cannot forge it.
 */
export async function createTaskInTransaction(
  sql: any,
  params: {
    orgId: string;
    actorUserId: string;
    role: string;
    input: CreateTaskInput;
    provenance?: { source: Exclude<TaskSource, 'manual'>; sourceRef: string };
  }
): Promise<TaskDTO> {
  if (params.role === 'viewer') {
    throw new ForbiddenError('Viewers are not permitted to create tasks');
  }
  // 1. Verify project exists, belongs to org, and user has access
  const project = await verifyProjectAccess(sql, {
    orgId: params.orgId,
    projectId: params.input.projectId,
    userId: params.actorUserId,
    role: params.role,
  });

  // 2. Verify assignee belongs to org and has project access
  if (params.input.assigneeId) {
    await verifyAssigneeAccess(sql, {
      orgId: params.orgId,
      projectId: project.id,
      assigneeId: params.input.assigneeId,
      projectVisibility: project.visibility,
    });
  }

  // 3. Verify labels belong to the organisation
  if (params.input.labelIds && params.input.labelIds.length > 0) {
    await verifyLabelOwnership(sql, {
      orgId: params.orgId,
      labelIds: params.input.labelIds,
    });
  }

  // 4. Validate & lock parent task if creating a subtask
  if (params.input.parentTaskId) {
    await validateAndLockParentTask(sql, {
      orgId: params.orgId,
      projectId: project.id,
      parentTaskId: params.input.parentTaskId,
    });
  }

  // 5. Allocate atomic sequential task key (e.g. ENG-142)
  const taskKey = await allocateTaskKey(sql, {
    orgId: params.orgId,
    projectId: project.id,
    projectName: project.name,
    keyPrefix: project.keyPrefix,
  });

  // 6. Create task row with rank positioned after the last task in this column
  const taskId = generateUuidV7();
  const [lastTask] = await sql<{ rank: string }[]>`
    SELECT rank FROM tasks
    WHERE org_id = ${params.orgId}
      AND project_id = ${project.id}
      AND status = ${params.input.status || 'todo'}
      AND ${params.input.parentTaskId ? sql`parent_task_id = ${params.input.parentTaskId}` : sql`parent_task_id IS NULL`}
      AND archived_at IS NULL
    ORDER BY rank COLLATE "C" DESC, id DESC
    LIMIT 1
  `;
  const rank = lastTask ? generateRankBetween(lastTask.rank, null) : generateInitialRank();

  await sql`
    INSERT INTO tasks (
      id, org_id, project_id, parent_task_id, key, title, description,
      status, priority, assignee_id, due_date, rank, version,
      source, source_ref, created_by, created_at, updated_at
    ) VALUES (
      ${taskId}, ${params.orgId}, ${project.id}, ${params.input.parentTaskId || null},
      ${taskKey}, ${params.input.title}, ${params.input.description || null},
      ${params.input.status || 'todo'}, ${params.input.priority || 'medium'},
      ${params.input.assigneeId || null}, ${params.input.dueDate || null},
      ${rank}, 1, ${params.provenance?.source ?? 'manual'}, ${params.provenance?.sourceRef ?? null},
      ${params.actorUserId}, NOW(), NOW()
    )
  `;

  // 7. Associate labels
  if (params.input.labelIds && params.input.labelIds.length > 0) {
    for (const labelId of params.input.labelIds) {
      await sql`
        INSERT INTO task_labels (org_id, task_id, label_id, created_at)
        VALUES (${params.orgId}, ${taskId}, ${labelId}, NOW())
        ON CONFLICT DO NOTHING
      `;
    }
  }

  // 8. Transactional outbox event
  await insertOutboxEvent(sql, {
    orgId: params.orgId,
    topic: 'task.created',
    payload: {
      taskId,
      key: taskKey,
      projectId: project.id,
      orgId: params.orgId,
      title: params.input.title,
      version: 1,
      status: params.input.status || 'todo',
      priority: params.input.priority || 'medium',
      assigneeId: params.input.assigneeId || null,
      createdBy: params.actorUserId,
    },
  });

  // If assignee set, record task.assigned event as well
  if (params.input.assigneeId) {
    await insertOutboxEvent(sql, {
      orgId: params.orgId,
      topic: 'task.assigned',
      payload: {
        taskId,
        key: taskKey,
        projectId: project.id,
        orgId: params.orgId,
        previousAssigneeId: null,
        newAssigneeId: params.input.assigneeId,
        actorUserId: params.actorUserId,
      },
    });
  }

  // Invalidate project and ancestor team rollups
  await markNodesDirty(sql, {
    orgId: params.orgId,
    nodeIds: [project.id],
  });

  return await getTaskById(sql, {
    orgId: params.orgId,
    taskId,
    userId: params.actorUserId,
    role: params.role,
  });
}

export async function getTaskById(
  db: DbOrSql,
  params: {
    orgId: string;
    taskId: string;
    userId: string;
    role: string;
    includeArchived?: boolean;
  }
): Promise<TaskDTO> {
  const rawSql = scoped(db, { orgId: params.orgId, userId: params.userId, role: params.role });

  const [row] = await rawSql`
    SELECT 
      t.id, t.org_id as "orgId", t.project_id as "projectId", t.parent_task_id as "parentTaskId",
      t.key, t.title, t.description, t.status, t.priority, t.assignee_id as "assigneeId",
      TO_CHAR(t.due_date, 'YYYY-MM-DD') as "dueDate",
      t.rank, t.version, t.source, t.source_ref as "sourceRef",
      t.created_by as "createdBy", t.archived_at as "archivedAt",
      t.created_at as "createdAt", t.updated_at as "updatedAt",
      n.visibility as "projectVisibility",
      u.id as "assigneeUserId", u.name as "assigneeName", u.email as "assigneeEmail", NULL as "assigneeAvatarUrl"
    FROM tasks t
    JOIN nodes n ON n.org_id = t.org_id AND n.id = t.project_id
    LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.org_id = ${params.orgId} AND t.id = ${params.taskId}
      ${params.includeArchived ? rawSql`` : rawSql`AND t.archived_at IS NULL`}
  `;

  if (!row) {
    throw new NotFoundError('Task not found');
  }

  // Verify private project read access (zero leakage -> 404)
  if (row.projectVisibility === 'private' && params.role !== 'owner' && params.role !== 'admin') {
    const [membership] = await rawSql`
      SELECT 1 FROM node_members
      WHERE org_id = ${params.orgId} AND node_id = ${row.projectId} AND user_id = ${params.userId}
    `;
    if (!membership) {
      throw new NotFoundError('Task not found');
    }
  }

  // Fetch labels
  const labelRows = await rawSql<TaskLabelDTO[]>`
    SELECT l.id, l.name, l.color
    FROM task_labels tl
    JOIN labels l ON l.org_id = tl.org_id AND l.id = tl.label_id
    WHERE tl.org_id = ${params.orgId} AND tl.task_id = ${params.taskId}
    ORDER BY l.name ASC
  `;

  // Fetch subtask count
  const [subtaskCountRow] = await rawSql<{ count: number }[]>`
    SELECT COUNT(*)::int as count
    FROM tasks
    WHERE org_id = ${params.orgId} AND parent_task_id = ${params.taskId} AND archived_at IS NULL
  `;

  const assignee: TaskAssigneeDTO | null = row.assigneeUserId
    ? {
        id: row.assigneeUserId,
        name: row.assigneeName || 'Unknown User',
        email: row.assigneeEmail || '',
        avatarUrl: row.assigneeAvatarUrl || null,
      }
    : null;

  return {
    id: row.id,
    orgId: row.orgId,
    projectId: row.projectId,
    parentTaskId: row.parentTaskId,
    key: row.key,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    assigneeId: row.assigneeId,
    assignee,
    dueDate: row.dueDate || null,
    rank: row.rank,
    version: row.version,
    source: row.source,
    sourceRef: row.sourceRef,
    createdBy: row.createdBy,
    archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    labels: labelRows,
    subtaskCount: subtaskCountRow?.count || 0,
  };
}

export async function listTasks(
  db: DbOrSql,
  params: {
    orgId: string;
    userId: string;
    role: string;
    projectId?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    assigneeId?: string;
    parentTaskId?: string | null;
    includeArchived?: boolean;
    limit?: number;
  }
): Promise<TaskDTO[]> {
  const rawSql = scoped(db, { orgId: params.orgId, userId: params.userId, role: params.role });
  const limit = params.limit || 100;

  // Build private project access filter for non-owners/admins
  const isElevated = params.role === 'owner' || params.role === 'admin';

  const rows = await rawSql`
    SELECT 
      t.id, t.org_id as "orgId", t.project_id as "projectId", t.parent_task_id as "parentTaskId",
      t.key, t.title, t.description, t.status, t.priority, t.assignee_id as "assigneeId",
      TO_CHAR(t.due_date, 'YYYY-MM-DD') as "dueDate",
      t.rank, t.version, t.source, t.source_ref as "sourceRef",
      t.created_by as "createdBy", t.archived_at as "archivedAt",
      t.created_at as "createdAt", t.updated_at as "updatedAt",
      n.visibility as "projectVisibility",
      u.id as "assigneeUserId", u.name as "assigneeName", u.email as "assigneeEmail", NULL as "assigneeAvatarUrl"
    FROM tasks t
    JOIN nodes n ON n.org_id = t.org_id AND n.id = t.project_id
    LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.org_id = ${params.orgId}
      ${params.includeArchived ? rawSql`` : rawSql`AND t.archived_at IS NULL`}
      ${params.projectId ? rawSql`AND t.project_id = ${params.projectId}` : rawSql``}
      ${params.status ? rawSql`AND t.status = ${params.status}` : rawSql``}
      ${params.priority ? rawSql`AND t.priority = ${params.priority}` : rawSql``}
      ${params.assigneeId ? rawSql`AND t.assignee_id = ${params.assigneeId}` : rawSql``}
      ${params.parentTaskId !== undefined ? (params.parentTaskId === null ? rawSql`AND t.parent_task_id IS NULL` : rawSql`AND t.parent_task_id = ${params.parentTaskId}`) : rawSql``}
      ${
        isElevated
          ? rawSql``
          : rawSql`AND (n.visibility = 'public' OR EXISTS (SELECT 1 FROM node_members nm WHERE nm.org_id = t.org_id AND nm.node_id = t.project_id AND nm.user_id = ${params.userId}))`
      }
    ORDER BY t.rank COLLATE "C" ASC, t.id ASC
    LIMIT ${limit}
  `;

  if (rows.length === 0) return [];

  const taskIds = rows.map((r: any) => r.id);

  // Fetch labels for all tasks in batch
  const labels = await rawSql<{ taskId: string; id: string; name: string; color: string }[]>`
    SELECT tl.task_id as "taskId", l.id, l.name, l.color
    FROM task_labels tl
    JOIN labels l ON l.org_id = tl.org_id AND l.id = tl.label_id
    WHERE tl.org_id = ${params.orgId} AND tl.task_id IN ${rawSql(taskIds)}
    ORDER BY l.name ASC
  `;

  const labelMap = new Map<string, TaskLabelDTO[]>();
  for (const l of labels) {
    const list = labelMap.get(l.taskId) || [];
    list.push({ id: l.id, name: l.name, color: l.color });
    labelMap.set(l.taskId, list);
  }

  // Fetch subtask counts
  const subtaskCounts = await rawSql<{ parentTaskId: string; count: number }[]>`
    SELECT parent_task_id as "parentTaskId", COUNT(*)::int as count
    FROM tasks
    WHERE org_id = ${params.orgId} AND parent_task_id IN ${rawSql(taskIds)} AND archived_at IS NULL
    GROUP BY parent_task_id
  `;
  const countMap = new Map<string, number>();
  for (const sc of subtaskCounts) {
    countMap.set(sc.parentTaskId, sc.count);
  }

  return rows.map((row: any) => {
    const assignee: TaskAssigneeDTO | null = row.assigneeUserId
      ? {
          id: row.assigneeUserId,
          name: row.assigneeName || 'Unknown User',
          email: row.assigneeEmail || '',
          avatarUrl: row.assigneeAvatarUrl || null,
        }
      : null;

    return {
      id: row.id,
      orgId: row.orgId,
      projectId: row.projectId,
      parentTaskId: row.parentTaskId,
      key: row.key,
      title: row.title,
      description: row.description,
      status: row.status as TaskStatus,
      priority: row.priority as TaskPriority,
      assigneeId: row.assigneeId,
      assignee,
      dueDate: row.dueDate || null,
      rank: row.rank,
      version: row.version,
      source: row.source,
      sourceRef: row.sourceRef,
      createdBy: row.createdBy,
      archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      labels: labelMap.get(row.id) || [],
      subtaskCount: countMap.get(row.id) || 0,
    };
  });
}

// ---------------------------------------------------------------------------
// My Tasks Operations (GET /api/v1/orgs/{orgSlug}/me/tasks)
// ---------------------------------------------------------------------------

export async function getMyTasks(
  db: DbOrSql,
  params: {
    orgId: string;
    userId: string;
    role: string;
    query: MyTasksQuery;
  }
): Promise<MyTasksResponseDTO> {
  const rawSql = scoped(db, { orgId: params.orgId, userId: params.userId, role: params.role });
  const isElevated = params.role === 'owner' || params.role === 'admin';
  const today = getKolkataTodayDateString();
  const limit = Math.min(params.query.limit || 50, 100);

  // 1. Calculate genuine category counts for this user (respecting private project permissions)
  const [countsRow] = await rawSql`
    SELECT
      COUNT(*)::int as total_all,
      COUNT(*) FILTER (WHERE t.status != 'done')::int as total_pending,
      COUNT(*) FILTER (WHERE t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < ${today}::date)::int as total_overdue,
      COUNT(*) FILTER (WHERE t.due_date = ${today}::date)::int as total_due_today,
      COUNT(*) FILTER (WHERE t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date > ${today}::date)::int as total_upcoming
    FROM tasks t
    JOIN nodes p ON p.id = t.project_id AND p.org_id = t.org_id AND p.archived_at IS NULL
    WHERE t.org_id = ${params.orgId}
      AND t.assignee_id = ${params.userId}
      AND t.archived_at IS NULL
      ${
        isElevated
          ? rawSql``
          : rawSql`AND (p.visibility = 'public' OR EXISTS (SELECT 1 FROM node_members nm WHERE nm.org_id = t.org_id AND nm.node_id = t.project_id AND nm.user_id = ${params.userId}))`
      }
      ${params.query.projectId ? rawSql`AND t.project_id = ${params.query.projectId}` : rawSql``}
  `;

  const counts: MyTasksCountsDTO = {
    all: countsRow?.total_all || 0,
    pending: countsRow?.total_pending || 0,
    overdue: countsRow?.total_overdue || 0,
    dueToday: countsRow?.total_due_today || 0,
    upcoming: countsRow?.total_upcoming || 0,
  };

  // 2. Build category condition
  let categoryCondition = rawSql``;
  if (params.query.category === 'pending') {
    categoryCondition = rawSql`AND t.status != 'done'`;
  } else if (params.query.category === 'overdue') {
    categoryCondition = rawSql`AND t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < ${today}::date`;
  } else if (params.query.category === 'due_today') {
    categoryCondition = rawSql`AND t.due_date = ${today}::date`;
  } else if (params.query.category === 'upcoming') {
    categoryCondition = rawSql`AND t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date > ${today}::date`;
  }

  // 3. Search condition
  const searchCondition = params.query.search && params.query.search.trim()
    ? rawSql`AND (t.title ILIKE ${'%' + params.query.search.trim() + '%'} OR t.key ILIKE ${'%' + params.query.search.trim() + '%'})`
    : rawSql``;

  // 4. Query matching tasks
  const rows = await rawSql`
    SELECT
      t.id, t.org_id as "orgId", t.project_id as "projectId", t.parent_task_id as "parentTaskId",
      t.key, t.title, t.description, t.status, t.priority,
      t.assignee_id as "assigneeId", t.due_date as "dueDate", t.rank, t.version,
      t.source, t.source_ref as "sourceRef", t.created_by as "createdBy",
      t.archived_at as "archivedAt", t.created_at as "createdAt", t.updated_at as "updatedAt",
      p.name as "projectName", p.key_prefix as "projectKeyPrefix",
      pt.key as "parentKey", pt.title as "parentTitle",
      u.id as "assigneeUserId", u.name as "assigneeName", u.email as "assigneeEmail", NULL as "assigneeAvatarUrl"
    FROM tasks t
    JOIN nodes p ON p.id = t.project_id AND p.org_id = t.org_id AND p.archived_at IS NULL
    LEFT JOIN tasks pt ON pt.id = t.parent_task_id AND pt.org_id = t.org_id
    LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.org_id = ${params.orgId}
      AND t.assignee_id = ${params.userId}
      AND t.archived_at IS NULL
      ${
        isElevated
          ? rawSql``
          : rawSql`AND (p.visibility = 'public' OR EXISTS (SELECT 1 FROM node_members nm WHERE nm.org_id = t.org_id AND nm.node_id = t.project_id AND nm.user_id = ${params.userId}))`
      }
      ${params.query.projectId ? rawSql`AND t.project_id = ${params.query.projectId}` : rawSql``}
      ${params.query.status ? rawSql`AND t.status = ${params.query.status}` : rawSql``}
      ${params.query.priority ? rawSql`AND t.priority = ${params.query.priority}` : rawSql``}
      ${categoryCondition}
      ${searchCondition}
    ORDER BY
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
      t.due_date ASC,
      t.priority DESC,
      t.created_at DESC
    LIMIT ${limit}
  `;

  if (rows.length === 0) {
    return { tasks: [], counts, nextCursor: null };
  }

  const taskIds = rows.map((r: any) => r.id);

  // Fetch labels in batch
  const labels = await rawSql<{ taskId: string; id: string; name: string; color: string }[]>`
    SELECT tl.task_id as "taskId", l.id, l.name, l.color
    FROM task_labels tl
    JOIN labels l ON l.org_id = tl.org_id AND l.id = tl.label_id
    WHERE tl.org_id = ${params.orgId} AND tl.task_id IN ${rawSql(taskIds)}
    ORDER BY l.name ASC
  `;
  const labelMap = new Map<string, TaskLabelDTO[]>();
  for (const l of labels) {
    const list = labelMap.get(l.taskId) || [];
    list.push({ id: l.id, name: l.name, color: l.color });
    labelMap.set(l.taskId, list);
  }

  // Fetch subtask counts
  const subtaskCounts = await rawSql<{ parentTaskId: string; count: number }[]>`
    SELECT parent_task_id as "parentTaskId", COUNT(*)::int as count
    FROM tasks
    WHERE org_id = ${params.orgId} AND parent_task_id IN ${rawSql(taskIds)} AND archived_at IS NULL
    GROUP BY parent_task_id
  `;
  const countMap = new Map<string, number>();
  for (const sc of subtaskCounts) {
    countMap.set(sc.parentTaskId, sc.count);
  }

  const taskDTOs: MyTaskItemDTO[] = rows.map((row: any) => {
    const assignee: TaskAssigneeDTO | null = row.assigneeUserId
      ? {
          id: row.assigneeUserId,
          name: row.assigneeName || 'Unknown User',
          email: row.assigneeEmail || '',
          avatarUrl: null,
        }
      : null;

    return {
      id: row.id,
      orgId: row.orgId,
      projectId: row.projectId,
      parentTaskId: row.parentTaskId,
      key: row.key,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assigneeId: row.assigneeId,
      assignee,
      dueDate: row.dueDate ? (row.dueDate instanceof Date ? row.dueDate.toISOString().split('T')[0]! : String(row.dueDate)) : null,
      rank: row.rank,
      version: row.version,
      source: row.source,
      sourceRef: row.sourceRef,
      createdBy: row.createdBy,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
      labels: labelMap.get(row.id) || [],
      subtaskCount: countMap.get(row.id) || 0,
      projectName: row.projectName,
      projectKeyPrefix: row.projectKeyPrefix || 'TASK',
      parentKey: row.parentKey || null,
      parentTitle: row.parentTitle || null,
    };
  });

  return {
    tasks: taskDTOs,
    counts,
    nextCursor: null,
  };
}

export async function updateTask(
  db: DbOrSql,
  params: {
    orgId: string;
    taskId: string;
    actorUserId: string;
    role: string;
    ifMatchVersion: number;
    input: UpdateTaskInput;
  }
): Promise<TaskDTO> {
  if (params.role === 'viewer') {
    throw new ForbiddenError('Viewers are not permitted to modify tasks');
  }

  const rawSql = scoped(db, { orgId: params.orgId, userId: params.actorUserId, role: params.role });

  return await rawSql.begin((sql: any) => updateTaskInTransaction(sql, params));
}

/**
 * Versioned task update body shared by PATCH /tasks and approved update_task suggestions (Stage 17).
 * Must run inside the caller's transaction.
 */
export async function updateTaskInTransaction(
  sql: any,
  params: {
    orgId: string;
    taskId: string;
    actorUserId: string;
    role: string;
    ifMatchVersion: number;
    input: UpdateTaskInput;
  }
): Promise<TaskDTO> {
  if (params.role === 'viewer') {
    throw new ForbiddenError('Viewers are not permitted to modify tasks');
  }
  // 1. Fetch current task with project info & verify read access first
  const currentTask = await getTaskById(sql, {
    orgId: params.orgId,
    taskId: params.taskId,
    userId: params.actorUserId,
    role: params.role,
  });

  // 2. Strict optimistic concurrency check against current task version
  if (currentTask.version !== params.ifMatchVersion) {
    throw new PreconditionFailedError(
      `Version conflict: task has been updated to version ${currentTask.version} (requested version ${params.ifMatchVersion})`,
      currentTask
    );
  }

  const project = await verifyProjectAccess(sql, {
    orgId: params.orgId,
    projectId: currentTask.projectId,
    userId: params.actorUserId,
    role: params.role,
  });

  // 3. Verify assignee access if being updated
  if (params.input.assigneeId !== undefined && params.input.assigneeId !== null) {
    await verifyAssigneeAccess(sql, {
      orgId: params.orgId,
      projectId: currentTask.projectId,
      assigneeId: params.input.assigneeId,
      projectVisibility: project.visibility,
    });
  }

  // 4. Validate & lock parent task if reparenting
  if (params.input.parentTaskId !== undefined && params.input.parentTaskId !== currentTask.parentTaskId) {
    if (params.input.parentTaskId !== null) {
      await validateAndLockParentTask(sql, {
        orgId: params.orgId,
        projectId: currentTask.projectId,
        parentTaskId: params.input.parentTaskId,
        currentTaskId: params.taskId,
      });
    }
  }

  // 5. Verify labels ownership if provided
  if (params.input.labelIds !== undefined) {
    await verifyLabelOwnership(sql, {
      orgId: params.orgId,
      labelIds: params.input.labelIds,
    });
  }

  // 6. Build changed fields list for outbox tracking
  const changedFields: string[] = [];
  if (params.input.title !== undefined && params.input.title !== currentTask.title) changedFields.push('title');
  if (params.input.description !== undefined && params.input.description !== currentTask.description) changedFields.push('description');
  if (params.input.status !== undefined && params.input.status !== currentTask.status) changedFields.push('status');
  if (params.input.priority !== undefined && params.input.priority !== currentTask.priority) changedFields.push('priority');
  if (params.input.assigneeId !== undefined && params.input.assigneeId !== currentTask.assigneeId) changedFields.push('assigneeId');
  if (params.input.dueDate !== undefined && params.input.dueDate !== currentTask.dueDate) changedFields.push('dueDate');
  if (params.input.parentTaskId !== undefined && params.input.parentTaskId !== currentTask.parentTaskId) changedFields.push('parentTaskId');
  if (params.input.rank !== undefined && params.input.rank !== currentTask.rank) changedFields.push('rank');
  if (params.input.labelIds !== undefined) changedFields.push('labels');

  // 7. Atomic update statement requiring WHERE version = expectedVersion
  const title = params.input.title !== undefined ? params.input.title : currentTask.title;
  const description = params.input.description !== undefined ? params.input.description : currentTask.description;
  const status = params.input.status !== undefined ? params.input.status : currentTask.status;
  const priority = params.input.priority !== undefined ? params.input.priority : currentTask.priority;
  const assigneeId = params.input.assigneeId !== undefined ? params.input.assigneeId : currentTask.assigneeId;
  const dueDate = params.input.dueDate !== undefined ? params.input.dueDate : currentTask.dueDate;
  const parentTaskId = params.input.parentTaskId !== undefined ? params.input.parentTaskId : currentTask.parentTaskId;
  const rank = params.input.rank !== undefined ? params.input.rank : currentTask.rank;

  const [updated] = await sql`
    UPDATE tasks
    SET title = ${title},
        description = ${description},
        status = ${status},
        priority = ${priority},
        assignee_id = ${assigneeId},
        due_date = ${dueDate},
        parent_task_id = ${parentTaskId},
        rank = ${rank},
        version = version + 1,
        updated_at = NOW()
    WHERE org_id = ${params.orgId} AND id = ${params.taskId} AND version = ${params.ifMatchVersion}
    RETURNING *
  `;

  if (!updated) {
    // Version collision between fetch and atomic update
    const fresh = await getTaskById(sql, {
      orgId: params.orgId,
      taskId: params.taskId,
      userId: params.actorUserId,
      role: params.role,
    });
    throw new PreconditionFailedError(
      `Concurrent modification detected: task was updated by another request`,
      fresh
    );
  }

  // 8. Update task_labels if labels specified
  if (params.input.labelIds !== undefined) {
    await sql`
      DELETE FROM task_labels
      WHERE org_id = ${params.orgId} AND task_id = ${params.taskId}
    `;
    for (const labelId of params.input.labelIds) {
      await sql`
        INSERT INTO task_labels (org_id, task_id, label_id, created_at)
        VALUES (${params.orgId}, ${params.taskId}, ${labelId}, NOW())
        ON CONFLICT DO NOTHING
      `;
    }
  }

  // 9. Outbox events
  await insertOutboxEvent(sql, {
    orgId: params.orgId,
    topic: 'task.updated',
    payload: {
      taskId: params.taskId,
      key: currentTask.key,
      projectId: currentTask.projectId,
      orgId: params.orgId,
      version: updated.version,
      changedFields,
      actorUserId: params.actorUserId,
    },
  });

  if (params.input.assigneeId !== undefined && params.input.assigneeId !== currentTask.assigneeId) {
    await insertOutboxEvent(sql, {
      orgId: params.orgId,
      topic: 'task.assigned',
      payload: {
        taskId: params.taskId,
        key: currentTask.key,
        projectId: currentTask.projectId,
        orgId: params.orgId,
        previousAssigneeId: currentTask.assigneeId,
        newAssigneeId: params.input.assigneeId,
        actorUserId: params.actorUserId,
      },
    });
  }

  // Invalidate project and ancestor team rollups
  await markNodesDirty(sql, {
    orgId: params.orgId,
    nodeIds: [currentTask.projectId],
  });

  return await getTaskById(sql, {
    orgId: params.orgId,
    taskId: params.taskId,
    userId: params.actorUserId,
    role: params.role,
  });
}

export async function archiveTask(
  db: DbOrSql,
  params: {
    orgId: string;
    taskId: string;
    actorUserId: string;
    role: string;
    ifMatchVersion?: number;
  }
): Promise<TaskDTO> {
  if (params.role === 'viewer') {
    throw new ForbiddenError('Viewers are not permitted to archive tasks');
  }

  const rawSql = scoped(db, { orgId: params.orgId, userId: params.actorUserId, role: params.role });

  return await rawSql.begin(async (sql: any) => {
    const currentTask = await getTaskById(sql, {
      orgId: params.orgId,
      taskId: params.taskId,
      userId: params.actorUserId,
      role: params.role,
    });

    if (params.ifMatchVersion !== undefined && currentTask.version !== params.ifMatchVersion) {
      throw new PreconditionFailedError(
        `Version conflict: task has been updated to version ${currentTask.version} (requested ${params.ifMatchVersion})`,
        currentTask
      );
    }

    const [archived] = await sql`
      UPDATE tasks
      SET archived_at = NOW(),
          version = version + 1,
          updated_at = NOW()
      WHERE org_id = ${params.orgId} AND id = ${params.taskId}
      RETURNING *
    `;

    if (!archived) {
      throw new NotFoundError('Task not found');
    }

    await insertOutboxEvent(sql, {
      orgId: params.orgId,
      topic: 'task.archived',
      payload: {
        taskId: params.taskId,
        key: currentTask.key,
        projectId: currentTask.projectId,
        orgId: params.orgId,
        version: archived.version,
        actorUserId: params.actorUserId,
      },
    });

    // Invalidate project and ancestor team rollups
    await markNodesDirty(sql, {
      orgId: params.orgId,
      nodeIds: [currentTask.projectId],
    });

    return await getTaskById(sql, {
      orgId: params.orgId,
      taskId: params.taskId,
      userId: params.actorUserId,
      role: params.role,
      includeArchived: true,
    });
  });
}

// ---------------------------------------------------------------------------
// Move Task (Requirement W-5: Atomic 1-Row Move & Fractional Reordering)
// ---------------------------------------------------------------------------

export async function moveTask(
  db: DbOrSql,
  params: {
    orgId: string;
    taskId: string;
    actorUserId: string;
    role: string;
    ifMatchVersion: number;
    input: MoveTaskInput;
  }
): Promise<TaskDTO> {
  if (params.role === 'viewer') {
    throw new ForbiddenError('Viewers are not permitted to move tasks');
  }

  const rawSql = scoped(db, { orgId: params.orgId, userId: params.actorUserId, role: params.role });

  return await rawSql.begin(async (sql: any) => {
    // 1. Fetch and lock moved task row for update
    const [task] = await sql`
      SELECT id, org_id as "orgId", project_id as "projectId", parent_task_id as "parentTaskId",
             key, title, status, rank, version, archived_at as "archivedAt"
      FROM tasks
      WHERE org_id = ${params.orgId} AND id = ${params.taskId}
      FOR UPDATE
    `;

    if (!task || task.archivedAt) {
      throw new NotFoundError('Task not found');
    }

    // 2. Verify caller has read/write access to this project (zero leakage 404 on private projects)
    await verifyProjectAccess(sql, {
      orgId: params.orgId,
      projectId: task.projectId,
      userId: params.actorUserId,
      role: params.role,
    });

    // 3. Concurrency check: If-Match version must match current task version
    if (task.version !== params.ifMatchVersion) {
      const fresh = await getTaskById(sql, {
        orgId: params.orgId,
        taskId: params.taskId,
        userId: params.actorUserId,
        role: params.role,
      });
      throw new PreconditionFailedError(
        `Version conflict: task has been updated to version ${task.version} (requested ${params.ifMatchVersion})`,
        fresh
      );
    }

    const targetStatus: TaskStatus = (params.input.status as TaskStatus) || task.status;
    const parentTaskId: string | null = task.parentTaskId || null;

    // 4. Neighbor validation & locking
    let prevRank: string | null = null;
    let nextRank: string | null = null;

    if (params.input.prevTaskId) {
      if (params.input.prevTaskId === params.taskId) {
        throw new ValidationError('Cannot place task relative to itself');
      }
      const [prevTask] = await sql`
        SELECT id, org_id as "orgId", project_id as "projectId", parent_task_id as "parentTaskId",
               status, rank, archived_at as "archivedAt"
        FROM tasks
        WHERE org_id = ${params.orgId} AND id = ${params.input.prevTaskId}
        FOR UPDATE
      `;
      if (!prevTask || prevTask.archivedAt) {
        throw new ValidationError('Preceding task not found or is archived');
      }
      if (prevTask.projectId !== task.projectId) {
        throw new ValidationError('Preceding task must belong to the same project');
      }
      if (prevTask.status !== targetStatus) {
        throw new ValidationError('Preceding task is not in destination column');
      }
      if ((prevTask.parentTaskId || null) !== parentTaskId) {
        throw new ValidationError('Preceding task must belong to the same ordering scope (root vs subtask)');
      }
      prevRank = prevTask.rank;
    }

    if (params.input.nextTaskId) {
      if (params.input.nextTaskId === params.taskId) {
        throw new ValidationError('Cannot place task relative to itself');
      }
      const [nextTask] = await sql`
        SELECT id, org_id as "orgId", project_id as "projectId", parent_task_id as "parentTaskId",
               status, rank, archived_at as "archivedAt"
        FROM tasks
        WHERE org_id = ${params.orgId} AND id = ${params.input.nextTaskId}
        FOR UPDATE
      `;
      if (!nextTask || nextTask.archivedAt) {
        throw new ValidationError('Succeeding task not found or is archived');
      }
      if (nextTask.projectId !== task.projectId) {
        throw new ValidationError('Succeeding task must belong to the same project');
      }
      if (nextTask.status !== targetStatus) {
        throw new ValidationError('Succeeding task is not in destination column');
      }
      if ((nextTask.parentTaskId || null) !== parentTaskId) {
        throw new ValidationError('Succeeding task must belong to the same ordering scope (root vs subtask)');
      }
      nextRank = nextTask.rank;
    }

    // 5. Lexical rank calculation with authoritative collision resolution
    let newRank: string;

    if (prevRank && nextRank) {
      // Check if client view is corrupted or inverted
      if (compareRanks(prevRank, nextRank) >= 0) {
        throw new ValidationError(
          `Invalid placement: preceding rank (${prevRank}) must be strictly less than succeeding rank (${nextRank})`
        );
      }

      // Check if concurrent writes inserted tasks into the gap
      const intermediateTasks = await sql<{ id: string; rank: string }[]>`
        SELECT id, rank FROM tasks
        WHERE org_id = ${params.orgId}
          AND project_id = ${task.projectId}
          AND status = ${targetStatus}
          AND ${parentTaskId ? sql`parent_task_id = ${parentTaskId}` : sql`parent_task_id IS NULL`}
          AND id != ${params.taskId}
          AND rank > ${prevRank} AND rank < ${nextRank}
          AND archived_at IS NULL
        ORDER BY rank COLLATE "C" ASC
      `;

      if (intermediateTasks.length > 0) {
        // Safe recalculation: place after the last intermediate task and before nextRank
        const lastIntermediate = intermediateTasks[intermediateTasks.length - 1]!;
        newRank = generateRankBetween(lastIntermediate.rank, nextRank);
      } else {
        newRank = generateRankBetween(prevRank, nextRank);
      }
    } else if (prevRank && !nextRank) {
      // Moving after prevTask (bottom of column or partially loaded column)
      // Check if any other task exists after prevTask
      const followingTasks = await sql<{ id: string; rank: string }[]>`
        SELECT id, rank FROM tasks
        WHERE org_id = ${params.orgId}
          AND project_id = ${task.projectId}
          AND status = ${targetStatus}
          AND ${parentTaskId ? sql`parent_task_id = ${parentTaskId}` : sql`parent_task_id IS NULL`}
          AND id != ${params.taskId}
          AND rank > ${prevRank}
          AND archived_at IS NULL
        ORDER BY rank COLLATE "C" ASC
        LIMIT 1
      `;
      if (followingTasks.length > 0) {
        newRank = generateRankBetween(prevRank, followingTasks[0]!.rank);
      } else {
        newRank = generateRankBetween(prevRank, null);
      }
    } else if (!prevRank && nextRank) {
      // Moving before nextTask (top of column)
      // Check if any task exists before nextTask
      const precedingTasks = await sql<{ id: string; rank: string }[]>`
        SELECT id, rank FROM tasks
        WHERE org_id = ${params.orgId}
          AND project_id = ${task.projectId}
          AND status = ${targetStatus}
          AND ${parentTaskId ? sql`parent_task_id = ${parentTaskId}` : sql`parent_task_id IS NULL`}
          AND id != ${params.taskId}
          AND rank < ${nextRank}
          AND archived_at IS NULL
        ORDER BY rank COLLATE "C" DESC
        LIMIT 1
      `;
      if (precedingTasks.length > 0) {
        newRank = generateRankBetween(precedingTasks[0]!.rank, nextRank);
      } else {
        newRank = generateRankBetween(null, nextRank);
      }
    } else {
      // Empty destination column (neither prev nor next specified)
      // Query if destination column currently has any tasks on server
      const existingInColumn = await sql<{ id: string; rank: string }[]>`
        SELECT id, rank FROM tasks
        WHERE org_id = ${params.orgId}
          AND project_id = ${task.projectId}
          AND status = ${targetStatus}
          AND ${parentTaskId ? sql`parent_task_id = ${parentTaskId}` : sql`parent_task_id IS NULL`}
          AND id != ${params.taskId}
          AND archived_at IS NULL
        ORDER BY rank COLLATE "C" DESC
        LIMIT 1
      `;
      if (existingInColumn.length > 0) {
        newRank = generateRankBetween(existingInColumn[0]!.rank, null);
      } else {
        newRank = generateInitialRank();
      }
    }

    // 6. Atomic update of EXACTLY ONE row in the tasks table
    const [updated] = await sql`
      UPDATE tasks
      SET status = ${targetStatus},
          rank = ${newRank},
          version = version + 1,
          updated_at = NOW()
      WHERE org_id = ${params.orgId} AND id = ${params.taskId} AND version = ${params.ifMatchVersion}
      RETURNING *
    `;

    if (!updated) {
      const fresh = await getTaskById(sql, {
        orgId: params.orgId,
        taskId: params.taskId,
        userId: params.actorUserId,
        role: params.role,
      });
      throw new PreconditionFailedError(
        'Concurrent modification detected: task was updated during move coordination',
        fresh
      );
    }

    // 7. Transactional Outbox Event
    await insertOutboxEvent(sql, {
      orgId: params.orgId,
      topic: 'task.moved',
      payload: {
        taskId: params.taskId,
        key: task.key,
        projectId: task.projectId,
        orgId: params.orgId,
        oldStatus: task.status,
        newStatus: targetStatus,
        oldRank: task.rank,
        newRank,
        version: updated.version,
        actorUserId: params.actorUserId,
        prevTaskId: params.input.prevTaskId || null,
        nextTaskId: params.input.nextTaskId || null,
      },
    });

    if (isDenseRank(newRank)) {
      await insertOutboxEvent(sql, {
        orgId: params.orgId,
        topic: 'tasks.dense_rank_detected',
        payload: {
          taskId: params.taskId,
          projectId: task.projectId,
          status: targetStatus,
          parentTaskId,
          rank: newRank,
          rankLength: newRank.length,
        },
      });
    }

    // Invalidate project and ancestor team rollups
    await markNodesDirty(sql, {
      orgId: params.orgId,
      nodeIds: [task.projectId],
    });

    return await getTaskById(sql, {
      orgId: params.orgId,
      taskId: params.taskId,
      userId: params.actorUserId,
      role: params.role,
    });
  });
}

// ---------------------------------------------------------------------------
// Rebalance Column Ranks (Exceptional maintenance when rank length > 32)
// ---------------------------------------------------------------------------

export async function rebalanceColumnRanks(
  db: DbOrSql,
  params: {
    orgId: string;
    projectId: string;
    status: TaskStatus;
    parentTaskId?: string | null;
    userId?: string;
    role?: string;
  }
): Promise<{ rebalancedCount: number; newRanks: string[] }> {
  const rawSql = scoped(db, { orgId: params.orgId, userId: params.userId, role: params.role });

  return await rawSql.begin(async (sql: any) => {
    const parentScope = params.parentTaskId || null;
    const tasksToRebalance = await sql<{ id: string; rank: string }[]>`
      SELECT id, rank
      FROM tasks
      WHERE org_id = ${params.orgId}
        AND project_id = ${params.projectId}
        AND status = ${params.status}
        AND ${parentScope ? sql`parent_task_id = ${parentScope}` : sql`parent_task_id IS NULL`}
        AND archived_at IS NULL
      ORDER BY rank COLLATE "C" ASC, id ASC
      FOR UPDATE
    `;

    if (tasksToRebalance.length === 0) {
      return { rebalancedCount: 0, newRanks: [] };
    }

    const newKeys = generateRebalancedRanks(tasksToRebalance.length);

    for (let i = 0; i < tasksToRebalance.length; i++) {
      const t = tasksToRebalance[i]!;
      const newRank = newKeys[i]!;
      await sql`
        UPDATE tasks
        SET rank = ${newRank},
            version = version + 1,
            updated_at = NOW()
        WHERE org_id = ${params.orgId} AND id = ${t.id}
      `;
    }

    await insertOutboxEvent(sql, {
      orgId: params.orgId,
      topic: 'tasks.rebalanced',
      payload: {
        projectId: params.projectId,
        status: params.status,
        parentTaskId: parentScope,
        count: tasksToRebalance.length,
      },
    });

    return { rebalancedCount: tasksToRebalance.length, newRanks: newKeys };
  });
}

// ---------------------------------------------------------------------------
// Subtask Helper
// ---------------------------------------------------------------------------

export async function createSubtask(
  db: DbOrSql,
  params: {
    orgId: string;
    parentTaskId: string;
    actorUserId: string;
    role: string;
    input: Omit<CreateTaskInput, 'projectId' | 'parentTaskId'>;
  }
): Promise<TaskDTO> {
  const rawSql = scoped(db, { orgId: params.orgId, userId: params.actorUserId, role: params.role });
  const parent = await getTaskById(rawSql, {
    orgId: params.orgId,
    taskId: params.parentTaskId,
    userId: params.actorUserId,
    role: params.role,
  });

  return await createTask(db, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    role: params.role,
    input: {
      ...params.input,
      projectId: parent.projectId,
      parentTaskId: params.parentTaskId,
    },
  });
}

// ---------------------------------------------------------------------------
// Labels Operations
// ---------------------------------------------------------------------------

export async function listLabels(
  db: DbOrSql,
  params: { orgId: string }
): Promise<TaskLabelDTO[]> {
  const rawSql = scoped(db, { orgId: params.orgId });
  return await rawSql<TaskLabelDTO[]>`
    SELECT id, name, color
    FROM labels
    WHERE org_id = ${params.orgId}
    ORDER BY name ASC
  `;
}

export async function createLabel(
  db: DbOrSql,
  params: {
    orgId: string;
    role: string;
    input: CreateLabelInput;
  }
): Promise<TaskLabelDTO> {
  if (params.role === 'viewer') {
    throw new ForbiddenError('Viewers are not permitted to create labels');
  }

  const rawSql = scoped(db, { orgId: params.orgId, role: params.role });
  const id = generateUuidV7();

  const [label] = await rawSql<TaskLabelDTO[]>`
    INSERT INTO labels (id, org_id, name, color, created_at)
    VALUES (${id}, ${params.orgId}, ${params.input.name}, ${params.input.color || '#64748B'}, NOW())
    ON CONFLICT (org_id, name) DO UPDATE
    SET color = EXCLUDED.color
    RETURNING id, name, color
  `;

  return label!;
}

export async function deleteLabel(
  db: DbOrSql,
  params: {
    orgId: string;
    role: string;
    labelId: string;
  }
): Promise<void> {
  if (params.role === 'viewer') {
    throw new ForbiddenError('Viewers are not permitted to delete labels');
  }

  const rawSql = scoped(db, { orgId: params.orgId, role: params.role });
  await rawSql`
    DELETE FROM labels
    WHERE org_id = ${params.orgId} AND id = ${params.labelId}
  `;
}
