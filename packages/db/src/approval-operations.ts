import type { Sql } from 'postgres';
import {
  CreateTaskSchema,
  DomainError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  UpdateTaskSchema,
  ValidationError,
  decodeCursor,
  encodeCursor,
  normalizedEditDistance,
  type ActionItemDTO,
  type ActionItemDecisionInput,
  type ActionItemDecisionResultDTO,
  type ListActionItemsQuery,
  type OrgRole,
  type PageInfo,
  type TaskDTO,
  type UpdateTaskInput,
} from '@workspace/core';
import { withTenantContext } from './client.js';
import { authorizeMeetingAccess } from './meeting-intake-operations.js';
import { insertOutboxEvent } from './outbox-operations.js';
import {
  createTaskInTransaction,
  getTaskById,
  updateTaskInTransaction,
  verifyAssigneeAccess,
  verifyProjectAccess,
} from './task-operations.js';

// Stage 17: human approval of AI suggestions (Requirement N-2).
// This module is the only path by which an action item creates or changes a task.

export interface ActionItemViewer {
  userId: string | null;
  role: OrgRole | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const jsonArray = <T>(v: unknown): T[] => (Array.isArray(v) ? v : typeof v === 'string' ? JSON.parse(v) : []);
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const isElevated = (role: OrgRole | null) => role === 'owner' || role === 'admin';

function conflict(code: string, message: string, details?: unknown): DomainError {
  return new DomainError(message, code, 409, details);
}

/**
 * Read-model mirror of the CONSENT_WITHDRAWN decision guard (host consent opted in, not admin-disabled,
 * guest consent when guests were present). Expects `m` (meetings) and `hc` (zoom_host_consents) in scope.
 */
const consentWithdrawnSql = (sql: any) => sql`NOT COALESCE(
  hc.consent_status = 'opted_in' AND NOT hc.admin_disabled
    AND NOT (m.guests_present AND m.guest_consent_status <> 'consented'), false)`;

/**
 * Shared read model for action items (approval inbox, single item, meeting notes drawer).
 * Linked/target task details are only included when the caller can see that task's project,
 * checked on its own (never inferred from the caller's access to the meeting).
 */
function selectActionItems(sql: any, viewer: ActionItemViewer, where: unknown) {
  const elevated = isElevated(viewer.role);
  const linkedVisible = elevated
    ? sql`TRUE`
    : sql`(ln.visibility = 'public' OR EXISTS (
        SELECT 1 FROM node_members lnm
        WHERE lnm.org_id = lt.org_id AND lnm.node_id = lt.project_id AND lnm.user_id = ${viewer.userId}))`;
  const targetVisible = elevated
    ? sql`TRUE`
    : sql`(tn.visibility = 'public' OR EXISTS (
        SELECT 1 FROM node_members tnm
        WHERE tnm.org_id = tt.org_id AND tnm.node_id = tt.project_id AND tnm.user_id = ${viewer.userId}))`;

  return sql`
    SELECT
      ai.*,
      TO_CHAR(ai.suggested_due, 'YYYY-MM-DD') AS suggested_due_date,
      TO_CHAR(ai.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,
      m.title AS meeting_title,
      COALESCE(m.actual_start_at, m.scheduled_start_at) AS meeting_started_at,
      m.node_id AS meeting_node_id,
      n.name AS project_name,
      so.name AS suggested_owner_name,
      so.email AS suggested_owner_email,
      (er.processing_generation IS DISTINCT FROM m.processing_generation) AS superseded,
      ${consentWithdrawnSql(sql)} AS consent_withdrawn,
      CASE WHEN lt.id IS NOT NULL AND ${linkedVisible} THEN json_build_object(
        'id', lt.id, 'key', lt.key, 'title', lt.title, 'description', lt.description, 'status', lt.status,
        'projectId', lt.project_id, 'assigneeId', lt.assignee_id, 'assigneeName', lu.name,
        'dueDate', TO_CHAR(lt.due_date, 'YYYY-MM-DD'), 'version', lt.version, 'archivedAt', lt.archived_at
      ) END AS linked_task,
      CASE WHEN tt.id IS NOT NULL AND ${targetVisible} THEN json_build_object(
        'id', tt.id, 'key', tt.key, 'title', tt.title, 'description', tt.description, 'status', tt.status,
        'projectId', tt.project_id, 'assigneeId', tt.assignee_id, 'assigneeName', tu.name,
        'dueDate', TO_CHAR(tt.due_date, 'YYYY-MM-DD'), 'version', tt.version, 'archivedAt', tt.archived_at
      ) END AS target_task
    FROM action_items ai
    JOIN meetings m ON m.org_id = ai.org_id AND m.id = ai.meeting_id
    LEFT JOIN nodes n ON n.org_id = m.org_id AND n.id = m.node_id
    LEFT JOIN users so ON so.id = ai.suggested_owner_id
    LEFT JOIN extraction_runs er ON er.org_id = ai.org_id AND er.id = ai.extraction_run_id
    LEFT JOIN zoom_host_consents hc ON hc.org_id = m.org_id AND hc.zoom_user_id = m.zoom_host_id
    LEFT JOIN tasks lt ON lt.org_id = ai.org_id AND lt.id = ai.task_id
    LEFT JOIN nodes ln ON ln.org_id = lt.org_id AND ln.id = lt.project_id
    LEFT JOIN users lu ON lu.id = lt.assignee_id
    LEFT JOIN tasks tt ON tt.org_id = ai.org_id AND tt.id = ai.target_task_id
    LEFT JOIN nodes tn ON tn.org_id = tt.org_id AND tn.id = tt.project_id
    LEFT JOIN users tu ON tu.id = tt.assignee_id
    WHERE ${where}
  `;
}

function mapActionItemRow(r: any, viewer: ActionItemViewer): ActionItemDTO {
  const validationStatus = r.validation_status || 'valid';
  return {
    id: r.id,
    orgId: r.org_id,
    meetingId: r.meeting_id,
    text: r.text,
    ownerName: r.owner_name,
    duePhrase: r.due_phrase,
    suggestedOwnerId: r.suggested_owner_id,
    suggestedDue: r.suggested_due_date ?? null,
    evidence: jsonArray(r.evidence),
    confidence: Number(r.confidence),
    state: r.state,
    proposalType: r.proposal_type || 'create_task',
    targetTaskId: r.target_task_id,
    targetTaskVersion: r.target_task_version != null ? Number(r.target_task_version) : null,
    targetTaskHash: r.target_task_hash,
    similarityScore: r.similarity_score != null ? Number(r.similarity_score) : null,
    rankedAlternatives: jsonArray(r.ranked_alternatives),
    embeddingSpace: r.embedding_space,
    dedupStatus: r.dedup_status || 'pending',
    dedupedAt: iso(r.deduped_at),
    ownerResolutionMethod: r.owner_resolution_method,
    ownerResolutionConfidence: r.owner_resolution_confidence != null ? Number(r.owner_resolution_confidence) : null,
    ownerResolutionEvidence: r.owner_resolution_evidence,
    dueResolutionExplanation: r.due_resolution_explanation,
    dueResolutionStatus: r.due_resolution_status,
    validationStatus,
    taskId: r.task_id,
    decidedBy: r.decided_by,
    decidedAt: iso(r.decided_at),
    extractionRunId: r.extraction_run_id,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    version: Number(r.version),
    decisionReason: r.decision_reason,
    decisionNote: r.decision_note,
    task: r.linked_task ?? null,
    targetTask: r.target_task ?? null,
    meeting: {
      id: r.meeting_id,
      title: r.meeting_title,
      startedAt: iso(r.meeting_started_at),
      nodeId: r.meeting_node_id,
    },
    project: r.meeting_node_id && r.project_name ? { id: r.meeting_node_id, name: r.project_name } : null,
    suggestedOwner: r.suggested_owner_id
      ? { id: r.suggested_owner_id, name: r.suggested_owner_name, email: r.suggested_owner_email }
      : null,
    superseded: !!r.superseded,
    consentWithdrawn: !!r.consent_withdrawn,
    canDecide:
      viewer.role !== null &&
      viewer.role !== 'viewer' &&
      r.state === 'suggested' &&
      validationStatus === 'valid' &&
      !r.superseded &&
      !r.consent_withdrawn,
  };
}

async function loadActionItem(sql: any, viewer: ActionItemViewer, orgId: string, actionItemId: string) {
  const [row] = await selectActionItems(sql, viewer, sql`ai.org_id = ${orgId} AND ai.id = ${actionItemId}`);
  if (!row) throw new NotFoundError('Action item not found');
  return mapActionItemRow(row, viewer);
}

/** Action items of one meeting (meeting notes drawer). Caller must have authorized the meeting. */
export async function listMeetingActionItems(
  sql: any,
  orgId: string,
  meetingId: string,
  viewer: ActionItemViewer = { userId: null, role: null }
): Promise<ActionItemDTO[]> {
  const rows = await sql`
    ${selectActionItems(sql, viewer, sql`ai.org_id = ${orgId} AND ai.meeting_id = ${meetingId}`)}
    ORDER BY ai.created_at ASC, ai.id ASC
  `;
  return rows.map((r: any) => mapActionItemRow(r, viewer));
}

/**
 * Centralised authorisation for action items (ADR 17): delegates to authorizeMeetingAccess.
 * read: Owners/Admins all; Members/Viewers with access to the meeting's project (unrouted: verified host).
 * decide: same as read, but Viewers get 403. Unknown, cross-org or otherwise unreadable items -> 404,
 * so a 403 never confirms that an item the caller cannot read exists.
 */
export async function authorizeActionItemAccess(
  sql: Sql,
  params: { orgId: string; actionItemId: string; userId: string; role: OrgRole; action: 'read' | 'decide' }
): Promise<{ meetingId: string }> {
  if (!UUID_RE.test(params.actionItemId)) throw new NotFoundError('Action item not found');
  const [item] = await sql<Array<{ meeting_id: string }>>`
    SELECT meeting_id FROM action_items WHERE org_id = ${params.orgId} AND id = ${params.actionItemId}
  `;
  if (!item) throw new NotFoundError('Action item not found');

  const auth = await authorizeMeetingAccess(sql, {
    orgId: params.orgId,
    meetingId: item.meeting_id,
    userId: params.userId,
    userRole: params.role,
    action: 'read',
  });
  if (!auth.authorized) throw new NotFoundError('Action item not found');
  if (params.action === 'decide' && params.role === 'viewer') {
    throw new ForbiddenError('Viewers cannot decide AI suggestions');
  }
  return { meetingId: item.meeting_id };
}

export async function getActionItemForUser(
  sql: Sql,
  params: { orgId: string; actionItemId: string; userId: string; role: OrgRole; action?: 'read' | 'decide' }
): Promise<ActionItemDTO> {
  await authorizeActionItemAccess(sql, { ...params, action: params.action ?? 'read' });
  return loadActionItem(sql, { userId: params.userId, role: params.role }, params.orgId, params.actionItemId);
}

/**
 * Permission-filtered approval inbox with opaque (created_at, id) cursor pagination.
 * Invalid-evidence items are excluded unless validation='invalid' is requested explicitly.
 */
export async function listActionItemsForReview(
  sql: Sql,
  params: { orgId: string; userId: string; role: OrgRole; query: ListActionItemsQuery }
): Promise<{ items: ActionItemDTO[]; pageInfo: PageInfo }> {
  const { orgId, userId, role, query } = params;
  const s = sql as any;
  const viewer: ActionItemViewer = { userId, role };

  let cursor: { id: string; val: string } | null = null;
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (typeof decoded.val !== 'string' || isNaN(Date.parse(decoded.val)) || !UUID_RE.test(decoded.id)) {
      throw new ValidationError('Invalid pagination cursor');
    }
    cursor = { id: decoded.id, val: decoded.val };
  }
  const assigneeId = query.assignee === 'me' ? userId : query.assignee;

  const where = s`
    ai.org_id = ${orgId}
    AND ai.state = ${query.state}
    AND ai.validation_status = ${query.validation === 'invalid' ? 'invalid_evidence' : 'valid'}
    ${
      // Open suggestions that cannot be decided right now stay out of the review queue: superseded generation
      // (STALE_GENERATION, e.g. self-service opt-out fenced the meeting) or consent no longer in effect
      // (CONSENT_WITHDRAWN, e.g. an admin disabled the host). The decision guards stay authoritative.
      query.state === 'suggested'
        ? s`AND er.processing_generation = m.processing_generation AND NOT ${consentWithdrawnSql(s)}`
        : s``
    }
    ${query.meetingId ? s`AND ai.meeting_id = ${query.meetingId}` : s``}
    ${assigneeId ? s`AND ai.suggested_owner_id = ${assigneeId}` : s``}
    ${query.updatedSince ? s`AND ai.updated_at >= ${query.updatedSince}::timestamptz` : s``}
    ${cursor ? s`AND (ai.created_at, ai.id) > (${cursor.val}::timestamptz, ${cursor.id}::uuid)` : s``}
    ${
      isElevated(role)
        ? s``
        : s`AND (
            (m.node_id IS NULL AND m.host_id = ${userId})
            OR (n.id IS NOT NULL AND n.archived_at IS NULL AND (
              n.visibility = 'public'
              OR EXISTS (
                SELECT 1 FROM node_members nm
                WHERE nm.org_id = m.org_id AND nm.node_id = m.node_id AND nm.user_id = ${userId}
              )
            ))
          )`
    }
  `;

  const rows = await s`
    ${selectActionItems(s, viewer, where)}
    ORDER BY ai.created_at ASC, ai.id ASC
    LIMIT ${query.limit + 1}
  `;

  const hasNextPage = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r: any) => mapActionItemRow(r, viewer)),
    pageInfo: {
      hasNextPage,
      ...(last ? { endCursor: encodeCursor({ id: last.id, val: last.cursor_created_at, dir: 'asc' }) } : {}),
    },
  };
}

export interface DecideActionItemParams {
  orgId: string;
  actionItemId: string;
  userId: string;
  role: OrgRole;
  /** Version from the client's strong If-Match ("v{version}"); re-checked under the row lock. */
  expectedVersion: number;
  input: ActionItemDecisionInput;
}

/**
 * Applies a human decision in ONE transaction (tenant context set for RLS):
 * lock meeting (FOR SHARE) then the item (FOR UPDATE), validate state/version/eligibility,
 * create or update the task through the shared task-operations path, link the item,
 * append the decision log, and write the `action_item.decided` outbox event + activity entry.
 */
export async function decideActionItem(sql: Sql, params: DecideActionItemParams): Promise<ActionItemDecisionResultDTO> {
  const { orgId, actionItemId, userId, role, expectedVersion, input } = params;
  const viewer: ActionItemViewer = { userId, role };

  return withTenantContext(sql, { orgId, userId, role }, async (txn) => {
    const tx = txn as unknown as Sql;
    const { meetingId } = await authorizeActionItemAccess(tx, { orgId, actionItemId, userId, role, action: 'decide' });

    // Lock order matches skip/re-extraction (meeting row first) to avoid deadlocks.
    const [meeting] = await tx<any[]>`
      SELECT id, title, node_id, status, skipped, processing_generation, zoom_host_id,
             guests_present, guest_consent_status,
             TO_CHAR(COALESCE(actual_start_at, scheduled_start_at, created_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS meeting_date
      FROM meetings
      WHERE org_id = ${orgId} AND id = ${meetingId}
      FOR SHARE
    `;
    const [item] = await tx<any[]>`
      SELECT ai.*,
             TO_CHAR(ai.suggested_due, 'YYYY-MM-DD') AS suggested_due_date,
             er.processing_generation AS run_generation,
             er.model AS run_model,
             er.prompt_version AS run_prompt_version,
             GREATEST(0, (EXTRACT(EPOCH FROM (now() - COALESCE(ai.deduped_at, ai.created_at))) * 1000))::bigint AS elapsed_ms
      FROM action_items ai
      LEFT JOIN extraction_runs er ON er.id = ai.extraction_run_id AND er.org_id = ai.org_id
      WHERE ai.org_id = ${orgId} AND ai.id = ${actionItemId}
      FOR UPDATE OF ai
    `;
    if (!meeting || !item) throw new NotFoundError('Action item not found');

    const fresh = () => loadActionItem(tx, viewer, orgId, actionItemId);

    if (item.version !== expectedVersion) {
      throw new PreconditionFailedError(
        `Version conflict: action item is at version ${item.version} (requested ${expectedVersion})`,
        await fresh()
      );
    }
    if (item.state !== 'suggested') {
      throw conflict('ALREADY_DECIDED', `Action item was already ${item.state}`, { actionItem: await fresh() });
    }
    if (item.validation_status !== 'valid') {
      throw conflict('INVALID_EVIDENCE', 'Suggestions without valid transcript evidence cannot be decided');
    }
    if (meeting.skipped || meeting.status === 'skipped') {
      throw conflict('MEETING_SKIPPED', 'The meeting was skipped; its suggestions can no longer be decided');
    }
    if (!meeting.node_id) {
      throw conflict('MEETING_NOT_ROUTED', 'The meeting is no longer routed to a project');
    }
    const [consent] = await tx<Array<{ consent_status: string; admin_disabled: boolean }>>`
      SELECT consent_status, admin_disabled FROM zoom_host_consents
      WHERE org_id = ${orgId} AND zoom_user_id = ${meeting.zoom_host_id ?? ''}
    `;
    const guestConsentMissing = meeting.guests_present && meeting.guest_consent_status !== 'consented';
    if (!consent || consent.consent_status !== 'opted_in' || consent.admin_disabled || guestConsentMissing) {
      throw conflict('CONSENT_WITHDRAWN', 'Meeting processing consent is no longer in effect');
    }
    if (item.run_generation == null || item.run_generation !== meeting.processing_generation) {
      throw conflict('STALE_GENERATION', 'Suggestion belongs to a superseded extraction run');
    }

    const meetingLabel = `meeting "${meeting.title ?? 'Untitled meeting'}" (${meeting.meeting_date})`;
    const meetingLink = `/orgs/${orgId}/meetings?meeting=${meetingId}`;
    const evidence = jsonArray<{ seq: number; quote: string }>(item.evidence);
    const proposalMode = item.proposal_type === 'update_task' ? 'update' : 'create';

    let task: TaskDTO | null = null;
    let taskOperation: 'created' | 'updated' | null = null;
    let appliedValues: Record<string, unknown> | null = null;
    let appliedAssigneeId: string | null = null;
    let suggestedOwnerDropped = false;
    const changedFields: string[] = [];
    let titleEditDistance: number | null = null;

    // Suggested owner is applied only if still eligible under task-assignment rules; otherwise dropped.
    const eligibleSuggestedOwner = async (project: { id: string; visibility: 'public' | 'private' }) => {
      if (!item.suggested_owner_id) return null;
      try {
        await verifyAssigneeAccess(tx, {
          orgId,
          projectId: project.id,
          assigneeId: item.suggested_owner_id,
          projectVisibility: project.visibility,
        });
        return item.suggested_owner_id as string;
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err;
        suggestedOwnerDropped = true;
        return null;
      }
    };

    if (input.decision === 'reject') {
      await tx`
        UPDATE action_items
        SET state = 'rejected', decision_reason = ${input.reason}, decision_note = ${input.note ?? null},
            decided_by = ${userId}, decided_at = now(), version = version + 1, updated_at = now()
        WHERE org_id = ${orgId} AND id = ${actionItemId}
      `;
    } else {
      const edit = input.decision === 'edit' ? input : null;
      const mode = edit?.mode ?? (edit?.targetTaskId ? 'update' : proposalMode);
      if (mode !== proposalMode) changedFields.push('mode');
      // assigneeId/dueDate edits are recorded against the default this decision would apply without them.
      if (edit?.priority !== undefined && edit.priority !== 'medium') changedFields.push('priority');
      if (edit?.description !== undefined) changedFields.push('description');

      if (mode === 'create') {
        if (edit?.targetTaskId !== undefined || edit?.targetTaskVersion !== undefined) {
          throw new ValidationError('targetTaskId/targetTaskVersion apply only to mode "update"');
        }
        const projectId: string = edit?.projectId ?? meeting.node_id;
        if (projectId !== meeting.node_id) changedFields.push('projectId');
        const project = await verifyProjectAccess(tx, { orgId, projectId, userId, role });
        // Dedup ran only against the meeting's project: another project counts as unchecked, never as "no duplicate".
        const dedupDone = ['matched', 'no_match'].includes(item.dedup_status) && projectId === meeting.node_id;
        if (!dedupDone && !input.acknowledgeIncompleteDedup) {
          throw conflict(
            'DEDUP_INCOMPLETE',
            projectId === meeting.node_id
              ? 'Duplicate check did not complete for this suggestion; set acknowledgeIncompleteDedup to create the task anyway'
              : 'No duplicate check was run for the chosen project; set acknowledgeIncompleteDedup to create the task there'
          );
        }

        const suggestedAssignee = await eligibleSuggestedOwner(project);
        const assigneeId = edit?.assigneeId !== undefined ? edit.assigneeId : suggestedAssignee;
        if (assigneeId !== suggestedAssignee) changedFields.push('assigneeId');
        const title = edit?.title ?? item.text;
        if (edit?.title !== undefined && edit.title.trim() !== String(item.text).trim()) changedFields.push('title');
        titleEditDistance = normalizedEditDistance(item.text, title);
        // The meeting's title/date are meeting content: only name them in its own project. Elsewhere readers
        // may lack access to the (possibly private) meeting, so keep just the opaque link.
        const provenance = `Source: approved AI suggestion from ${projectId === meeting.node_id ? meetingLabel : 'a meeting'} — ${meetingLink}`;
        const description = [edit?.description?.trim(), provenance].filter(Boolean).join('\n\n');
        const dueDate = edit?.dueDate !== undefined ? edit.dueDate : item.suggested_due_date;
        if (dueDate !== item.suggested_due_date) changedFields.push('dueDate');

        const parsed = CreateTaskSchema.safeParse({
          projectId,
          title,
          description,
          priority: edit?.priority,
          assigneeId,
          dueDate,
        });
        if (!parsed.success) throw new ValidationError('Invalid task values for this decision', parsed.error.format());

        task = await createTaskInTransaction(tx, {
          orgId,
          actorUserId: userId,
          role,
          input: parsed.data,
          provenance: {
            source: 'zoom_meeting',
            sourceRef: JSON.stringify({
              meetingId,
              actionItemId,
              evidenceSeqs: [...new Set(evidence.map((e) => e.seq))].sort((a, b) => a - b),
            }),
          },
        });
        taskOperation = 'created';
        appliedAssigneeId = task.assigneeId;
        appliedValues = {
          mode,
          taskId: task.id,
          taskKey: task.key,
          projectId: task.projectId,
          title: task.title,
          assigneeId: task.assigneeId,
          dueDate: task.dueDate,
          priority: task.priority,
        };
      } else {
        if (edit?.title !== undefined || edit?.projectId !== undefined) {
          throw new ValidationError('title and projectId apply only to mode "create"');
        }
        const targetTaskId: string | null = edit?.targetTaskId ?? item.target_task_id;
        if (!targetTaskId) throw new ValidationError('mode "update" requires targetTaskId');
        const explicitTarget = targetTaskId !== item.target_task_id;
        if (explicitTarget) changedFields.push('targetTaskId');
        const expectedTaskVersion: number | null =
          edit?.targetTaskVersion ?? (explicitTarget ? null : item.target_task_version);
        if (expectedTaskVersion == null) {
          throw new ValidationError('targetTaskVersion is required when choosing a target task explicitly');
        }

        const [target] = await tx<any[]>`
          SELECT t.id, t.project_id, t.status, t.version, t.archived_at, t.description, t.assignee_id,
                 TO_CHAR(t.due_date, 'YYYY-MM-DD') AS due_date, n.visibility
          FROM tasks t JOIN nodes n ON n.org_id = t.org_id AND n.id = t.project_id
          WHERE t.org_id = ${orgId} AND t.id = ${targetTaskId}
          FOR UPDATE OF t
        `;
        if (
          !target ||
          target.archived_at ||
          target.status === 'done' ||
          target.project_id !== meeting.node_id ||
          target.version !== expectedTaskVersion
        ) {
          // Never overwrite silently: re-present the fresh target to the human.
          const currentTask = target
            ? await getTaskById(tx, { orgId, taskId: targetTaskId, userId, role, includeArchived: true }).catch(
                () => null
              )
            : null;
          throw conflict('TARGET_CHANGED', 'The target task changed since the suggestion was reviewed', {
            currentTask,
            actionItem: await fresh(),
          });
        }

        const update: UpdateTaskInput = {};
        // Defaults match the before -> after preview: eligible suggested owner/due, else the target's current values.
        const suggestedAssignee =
          (await eligibleSuggestedOwner({ id: target.project_id, visibility: target.visibility })) ?? target.assignee_id;
        const assigneeId = edit?.assigneeId !== undefined ? edit.assigneeId : suggestedAssignee;
        if (assigneeId !== suggestedAssignee) changedFields.push('assigneeId');
        if (assigneeId !== target.assignee_id) update.assigneeId = assigneeId;
        const suggestedDue = item.suggested_due_date ?? target.due_date;
        const dueDate = edit?.dueDate !== undefined ? edit.dueDate : suggestedDue;
        if (dueDate !== suggestedDue) changedFields.push('dueDate');
        if (dueDate !== target.due_date) update.dueDate = dueDate;
        if (edit?.priority !== undefined) update.priority = edit.priority;
        const note = (edit?.description !== undefined ? edit.description ?? '' : item.text).trim();
        if (note) {
          update.description = [target.description, `Update from ${meetingLabel}: ${note}\n${meetingLink}`]
            .filter(Boolean)
            .join('\n\n');
        }

        // Same limits as PATCH /tasks (e.g. the appended note must keep the description within 50,000 chars).
        const parsedUpdate = UpdateTaskSchema.safeParse(update);
        if (!parsedUpdate.success) {
          throw new ValidationError('Invalid task values for this decision', parsedUpdate.error.format());
        }

        if (Object.keys(update).length > 0) {
          task = await updateTaskInTransaction(tx, {
            orgId,
            taskId: targetTaskId,
            actorUserId: userId,
            role,
            ifMatchVersion: expectedTaskVersion,
            input: parsedUpdate.data,
          });
          taskOperation = 'updated';
        } else {
          task = await getTaskById(tx, { orgId, taskId: targetTaskId, userId, role });
        }
        appliedAssigneeId = task.assigneeId;
        appliedValues = {
          mode,
          taskId: task.id,
          taskKey: task.key,
          fromVersion: expectedTaskVersion,
          toVersion: task.version,
          assigneeId: update.assigneeId,
          dueDate: update.dueDate,
          priority: update.priority,
          note: note || null,
        };
      }

      await tx`
        UPDATE action_items
        SET state = ${input.decision === 'approve' ? 'approved' : 'edited'}, task_id = ${task.id},
            decided_by = ${userId}, decided_at = now(), version = version + 1, updated_at = now()
        WHERE org_id = ${orgId} AND id = ${actionItemId}
      `;
    }

    // Append-only eval log: proposal as shown to the human + what was applied.
    const proposalSnapshot = {
      text: item.text,
      ownerName: item.owner_name,
      duePhrase: item.due_phrase,
      suggestedOwnerId: item.suggested_owner_id,
      suggestedDue: item.suggested_due_date,
      proposalType: item.proposal_type,
      targetTaskId: item.target_task_id,
      targetTaskVersion: item.target_task_version,
      similarityScore: item.similarity_score != null ? Number(item.similarity_score) : null,
      dedupStatus: item.dedup_status,
      confidence: Number(item.confidence),
      evidence: evidence.map((e) => ({ seq: e.seq, quote: e.quote })),
      model: item.run_model,
      promptVersion: item.run_prompt_version,
      extractionRunId: item.extraction_run_id,
    };
    await tx`
      INSERT INTO action_item_decisions (
        org_id, action_item_id, meeting_id, decision, reason, note, proposal_snapshot, applied_values,
        edit_summary, title_edit_distance, time_to_decision_ms, task_id, task_operation, decided_by
      ) VALUES (
        ${orgId}, ${actionItemId}, ${meetingId}, ${input.decision},
        ${input.decision === 'reject' ? input.reason : null},
        ${input.decision === 'reject' ? (input.note ?? null) : null},
        ${JSON.stringify(proposalSnapshot)}::jsonb,
        ${appliedValues ? JSON.stringify(appliedValues) : null}::jsonb,
        ${JSON.stringify({ changedFields, suggestedOwnerDropped })}::jsonb,
        ${titleEditDistance}, ${Number(item.elapsed_ms)}, ${task?.id ?? null}, ${taskOperation}, ${userId}
      )
    `;

    await insertOutboxEvent(tx, {
      orgId,
      topic: 'action_item.decided',
      payload: { orgId, meetingId, actionItemId, decision: input.decision, taskId: task?.id ?? null },
    });

    // Safe metadata only: no proposal text, evidence quotes or free-text notes.
    await tx`
      INSERT INTO activity_log (org_id, actor_id, verb, target_type, target_id, payload)
      VALUES (
        ${orgId}, ${userId}, 'action_item.decided', 'action_item', ${actionItemId},
        ${JSON.stringify({
          decision: input.decision,
          reason: input.decision === 'reject' ? input.reason : null,
          meetingId,
          projectId: task?.projectId ?? meeting.node_id,
          taskId: task?.id ?? null,
          taskKey: task?.key ?? null,
          taskOperation,
          changedFields,
        })}::jsonb
      )
    `;

    return {
      actionItem: await fresh(),
      task,
      taskOperation,
      assignment: {
        suggestedOwnerId: item.suggested_owner_id,
        appliedAssigneeId,
        suggestedOwnerDropped,
      },
    };
  });
}
