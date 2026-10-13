import type {
  ActionItemDTO,
  ActionItemDecisionInput,
  ActionItemDecisionResultDTO,
  ActionItemRejectReason,
  TaskPriority,
} from '@workspace/core';

// Stage 17 client helpers shared by the meeting drawer and the approvals inbox.

export const REJECT_REASON_LABELS: Record<ActionItemRejectReason, string> = {
  wrong: 'Wrong — the meeting did not agree to this',
  duplicate: 'Duplicate of an existing task',
  not_a_task: 'Not a task',
  other: 'Other',
};

/** Task shown in the update before -> after preview. */
export interface TargetPreview {
  id: string;
  key: string;
  title: string;
  description: string | null;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  version: number;
}

/** Form values ARE the values that will be applied (create: the new task; update: the target after the change). */
export interface EditForm {
  mode: 'create' | 'update';
  title: string;
  description: string;
  note: string;
  assigneeId: string;
  dueDate: string;
  priority: TaskPriority;
  projectId: string;
  targetTaskId: string;
  targetTaskVersion: number | null;
  acknowledgeIncompleteDedup: boolean;
}

/** Duplicate check must have finished before a task is created without explicit acknowledgement. */
export const dedupComplete = (item: ActionItemDTO) => item.dedupStatus === 'matched' || item.dedupStatus === 'no_match';

/** Dedup only ran against the meeting's project, so creating the task elsewhere needs acknowledgement too. */
export const editNeedsDedupAck = (item: ActionItemDTO, form: EditForm) =>
  form.mode === 'create' && (!dedupComplete(item) || form.projectId !== (item.meeting?.nodeId ?? ''));

export function initialEditForm(
  item: ActionItemDTO,
  mode: 'create' | 'update',
  target: TargetPreview | null,
  isEligible: (userId: string) => boolean
): EditForm {
  const owner = item.suggestedOwnerId && isEligible(item.suggestedOwnerId) ? item.suggestedOwnerId : null;
  return {
    mode,
    title: item.text,
    description: '',
    note: item.text,
    assigneeId: (mode === 'update' ? (owner ?? target?.assigneeId) : owner) ?? '',
    dueDate: (mode === 'update' ? (item.suggestedDue ?? target?.dueDate) : item.suggestedDue) ?? '',
    priority: 'medium',
    projectId: item.meeting?.nodeId ?? '',
    targetTaskId: target?.id ?? '',
    targetTaskVersion: target?.version ?? null,
    acknowledgeIncompleteDedup: false,
  };
}

/**
 * Builds the edit decision body. Assignee and due date are always sent exactly as shown, so the server
 * never substitutes a default the human did not see (it records changed fields against its own default).
 * Other fields are sent only when changed, keeping the decision log's edit summary (eval data) clean.
 */
export function buildEditDecision(item: ActionItemDTO, form: EditForm, initial: EditForm): ActionItemDecisionInput {
  const body: Extract<ActionItemDecisionInput, { decision: 'edit' }> = {
    decision: 'edit',
    mode: form.mode,
    assigneeId: form.assigneeId || null,
    dueDate: form.dueDate || null,
  };
  if (form.mode === 'create') {
    if (form.title.trim() !== item.text.trim()) body.title = form.title.trim();
    if (form.description.trim()) body.description = form.description.trim();
    if (form.priority !== initial.priority) body.priority = form.priority;
    if (form.projectId !== initial.projectId) body.projectId = form.projectId;
    if (form.acknowledgeIncompleteDedup && editNeedsDedupAck(item, form)) body.acknowledgeIncompleteDedup = true;
  } else {
    if (form.note.trim() !== item.text.trim()) body.description = form.note.trim();
    // The human approves against the target version shown in the preview, never a silently newer one.
    body.targetTaskId = form.targetTaskId;
    body.targetTaskVersion = form.targetTaskVersion ?? undefined;
  }
  return body;
}

export interface Problem {
  code?: string;
  detail?: string;
  currentEntity?: unknown;
  details?: { actionItem?: ActionItemDTO; currentTask?: unknown } & Record<string, unknown>;
}

export type DecisionOutcome =
  | { ok: true; result: ActionItemDecisionResultDTO }
  | { ok: false; status: number; problem: Problem };

export async function postDecision(
  orgId: string,
  item: ActionItemDTO,
  body: ActionItemDecisionInput
): Promise<DecisionOutcome> {
  try {
    const res = await fetch(`/api/orgs/${orgId}/action-items/${item.id}/decision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"v${item.version}"`,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, result: data } : { ok: false, status: res.status, problem: data };
  } catch {
    return { ok: false, status: 0, problem: { detail: 'Network error: the decision was not sent.' } };
  }
}

/** Human-readable explanation for a refused decision (shown in the card's live region). */
export function decisionFailureMessage(status: number, problem: Problem): string {
  if (status === 412) {
    return 'This suggestion changed since you opened it (re-enriched or decided elsewhere). The latest version is shown; review it and decide again.';
  }
  switch (problem.code) {
    case 'ALREADY_DECIDED':
      return 'Someone already decided this suggestion. Its outcome is shown below.';
    case 'TARGET_CHANGED':
      return 'The target task changed since this suggestion was made. The current task is shown in the preview; use Edit to apply the update to it, or reject.';
    case 'DEDUP_INCOMPLETE':
      return 'The duplicate check did not finish for this suggestion. Confirm you checked for an existing task, then approve again.';
    case 'MEETING_NOT_ROUTED':
      return 'The meeting is not routed to a project yet. Route it before deciding its suggestions.';
    case 'MEETING_SKIPPED':
      return 'The meeting was skipped, so its suggestions can no longer be decided.';
    case 'CONSENT_WITHDRAWN':
      return 'Recording consent for this meeting is no longer in effect, so its suggestions cannot be decided.';
    case 'STALE_GENERATION':
      return 'The meeting was re-processed and this suggestion is outdated.';
    case 'INVALID_EVIDENCE':
      return 'This suggestion has no valid transcript evidence and cannot be decided.';
  }
  if (status === 403) return 'Viewers cannot decide AI suggestions.';
  if (status === 404) return 'This suggestion is no longer available to you.';
  return problem.detail || 'The decision could not be saved.';
}
