'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ExternalLink,
  GitMerge,
  Pencil,
  PlusCircle,
  Quote,
  RotateCw,
  User,
  Video,
  XCircle,
} from 'lucide-react';
import type {
  ActionItemDTO,
  ActionItemDecisionInput,
  ActionItemDecisionResultDTO,
  ActionItemRejectReason,
  ActionItemTaskSummaryDTO,
  TaskDTO,
  TaskPriority,
} from '@workspace/core';
import { APP_TIME_ZONE } from '@workspace/core';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { formatShortDate } from '@/lib/format';
import {
  REJECT_REASON_LABELS,
  buildEditDecision,
  decisionFailureMessage,
  dedupComplete,
  editNeedsDedupAck,
  initialEditForm,
  postDecision,
  type EditForm,
  type TargetPreview,
} from '@/lib/action-item-decision';

const STATE_LABEL: Record<ActionItemDTO['state'], string> = {
  suggested: 'Awaiting decision',
  approved: 'Approved',
  edited: 'Approved with edits',
  rejected: 'Rejected',
};

const inputClass = 'field';
const secondaryButton = 'btn btn-secondary btn-sm';
const primaryButton = 'btn btn-primary btn-sm';

/** Meeting times are shown in the deployment's time zone, the one due dates are resolved in. */
function formatIst(iso: string | null | undefined): string {
  if (!iso) return 'time unknown';
  return new Date(iso).toLocaleString(undefined, { timeZone: APP_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short' });
}

const toPreview = (t: ActionItemTaskSummaryDTO): TargetPreview => ({
  id: t.id,
  key: t.key,
  title: t.title,
  description: t.description,
  status: t.status,
  assigneeId: t.assigneeId,
  assigneeName: t.assigneeName,
  dueDate: t.dueDate,
  version: t.version,
});

function successMessage(r: ActionItemDecisionResultDTO): string {
  if (!r.task) return 'Suggestion rejected. No task was created or changed.';
  const dropped = r.assignment.suggestedOwnerDropped
    ? ' The suggested owner cannot be assigned in that project, so they were not assigned.'
    : '';
  return `Task ${r.task.key} ${r.taskOperation === 'created' ? 'created' : 'updated'}.${dropped}`;
}

function BeforeAfter({ target, after }: { target: TargetPreview; after: { assignee: string; due: string; note: string } }) {
  const excerpt = (s: string | null) => (s ? (s.length > 80 ? `${s.slice(0, 80)}…` : s) : 'Empty');
  return (
    <table className="w-full border-collapse text-left text-xs">
      <caption className="sr-only">Changes to {target.key} if this update is approved</caption>
      <thead className="text-fg-muted">
        <tr>
          <th scope="col" className="py-1.5 pr-3 font-medium">Field</th>
          <th scope="col" className="py-1.5 pr-3 font-medium">Now</th>
          <th scope="col" className="py-1.5 font-medium">After approval</th>
        </tr>
      </thead>
      <tbody className="align-top">
        <tr className="border-t border-border">
          <th scope="row" className="py-1.5 pr-3 font-medium text-fg-muted">Assignee</th>
          <td className="py-1.5 pr-3 text-fg-muted">{target.assigneeName ?? 'Unassigned'}</td>
          <td className="py-1.5 text-fg">{after.assignee}</td>
        </tr>
        <tr className="border-t border-border">
          <th scope="row" className="py-1.5 pr-3 font-medium text-fg-muted">Due date</th>
          <td className="py-1.5 pr-3 tabular-nums text-fg-muted">{target.dueDate ?? 'None'}</td>
          <td className="py-1.5 tabular-nums text-fg">{after.due}</td>
        </tr>
        <tr className="border-t border-border">
          <th scope="row" className="py-1.5 pr-3 font-medium text-fg-muted">Description</th>
          <td className="py-1.5 pr-3 text-fg-muted">{excerpt(target.description)}</td>
          <td className="py-1.5 text-fg">{after.note ? `Unchanged, plus note: "${after.note}"` : 'Unchanged'}</td>
        </tr>
      </tbody>
    </table>
  );
}

interface ActionItemCardProps {
  item: ActionItemDTO;
  orgId: string;
  onItemChange: (item: ActionItemDTO) => void;
  onJumpToCue?: (seq: number) => void;
  showMeeting?: boolean;
}

/** One AI suggestion with its human decision controls (meeting drawer + approvals inbox). */
export function ActionItemCard({ item, orgId, onItemChange, onJumpToCue, showMeeting = false }: ActionItemCardProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [ackDedup, setAckDedup] = useState(false);
  const [dialog, setDialog] = useState<'edit' | 'reject' | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const textId = `action-item-text-${item.id}`;
  const needsAck = item.proposalType !== 'update_task' && !dedupComplete(item);
  const target = item.targetTask ?? null;
  const canDecide = !!item.canDecide && !!item.meeting?.nodeId;

  // After a decision the buttons (and the dialog's trigger) may be gone: move focus to the announced result.
  // Runs after the dialog's focus-restore cleanup in the same commit, so the result keeps focus.
  useEffect(() => {
    if (status) statusRef.current?.focus();
  }, [status]);
  const announce = (ok: boolean, text: string) => setStatus({ ok, text });

  /** Returns an error to keep showing inside the open dialog, or null once the dialog can close. */
  const decide = async (body: ActionItemDecisionInput, inDialog: boolean): Promise<string | null> => {
    setBusy(true);
    setStatus(null);
    const outcome = await postDecision(orgId, item, body);
    setBusy(false);
    if (outcome.ok) {
      setDialog(null);
      onItemChange(outcome.result.actionItem);
      announce(true, successMessage(outcome.result));
      return null;
    }
    const text = decisionFailureMessage(outcome.status, outcome.problem);
    const conflict = outcome.status === 409 || outcome.status === 412;
    if (inDialog && !conflict) return text;
    setDialog(null);
    announce(false, text);
    if (conflict) {
      // Re-fetch and re-present the current suggestion (and its target task) for a fresh human review.
      const res = await fetch(`/api/orgs/${orgId}/action-items/${item.id}`);
      if (res.ok) onItemChange(await res.json());
    }
    return null;
  };

  return (
    <article aria-labelledby={textId} className="card space-y-3 p-4 text-sm">
      {showMeeting && item.meeting && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          <Video className="h-3.5 w-3.5" aria-hidden="true" />
          <Link href={`/orgs/${orgId}/meetings?meeting=${item.meetingId}`} className="font-medium text-fg hover:underline">
            {item.meeting.title || 'Untitled meeting'}
          </Link>
          <span>{formatIst(item.meeting.startedAt)}</span>
          <span>· {item.project ? item.project.name : 'No project yet'}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {item.proposalType === 'update_task' ? (
          <Badge variant="warning" icon={GitMerge}>
            Update existing task
          </Badge>
        ) : (
          <Badge variant="accent" icon={PlusCircle}>
            New task
          </Badge>
        )}
        {item.state !== 'suggested' && <Badge>{STATE_LABEL[item.state]}</Badge>}
        <span className="text-xs text-fg-muted" title="How sure the assistant is that this is an action item">
          {Math.round(item.confidence * 100)}% sure
        </span>
      </div>

      <p id={textId} className="font-medium leading-snug text-fg">
        {item.text}
      </p>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span className="flex items-center gap-1">
          <User className="h-3.5 w-3.5" aria-hidden="true" />
          Owner:{' '}
          <span className="font-medium text-fg">
            {item.suggestedOwner
              ? item.suggestedOwner.name || item.suggestedOwner.email
              : item.ownerName
                ? `${item.ownerName} (not matched to a member)`
                : 'None'}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
          Due:{' '}
          <span className="font-medium text-fg">
            {item.suggestedDue
              ? formatShortDate(item.suggestedDue)
              : item.duePhrase
                ? `“${item.duePhrase}” (no date found)`
                : 'None'}
          </span>
        </span>
      </div>

      {item.proposalType === 'update_task' && (
        <div className="space-y-2 rounded-lg border border-border bg-surface-2/60 p-3">
          {target ? (
            <>
              <div className="text-xs font-medium text-fg">
                Updates <span className="font-mono">{target.key}</span> · {target.title}
              </div>
              {item.state === 'suggested' && (target.status === 'done' || target.archivedAt) ? (
                <p className="flex gap-1.5 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  That task is done or archived, so this update can't be applied. Use Edit to create a new task instead, or
                  reject.
                </p>
              ) : item.state === 'suggested' && target.version !== item.targetTaskVersion ? (
                <p className="flex gap-1.5 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  That task changed after this suggestion was made, so Approve will be refused. Use Edit to apply the update
                  to the current version.
                </p>
              ) : null}
              {item.state === 'suggested' && (
                <BeforeAfter
                  target={toPreview(target)}
                  after={{
                    assignee: item.suggestedOwner
                      ? `${item.suggestedOwner.name || item.suggestedOwner.email} (if eligible)`
                      : (target.assigneeName ?? 'Unassigned'),
                    due: item.suggestedDue ?? target.dueDate ?? 'None',
                    note: item.text,
                  }}
                />
              )}
            </>
          ) : (
            <p className="text-xs text-fg-muted">Updates an existing task in a project you can't see.</p>
          )}
        </div>
      )}

      {item.evidence.length > 0 && (
        <ul className="space-y-1" aria-label="Where this was said">
          {item.evidence.map((ev, idx) => (
            <li key={idx}>
              {onJumpToCue ? (
                <button
                  type="button"
                  onClick={() => onJumpToCue(ev.seq)}
                  className="flex max-w-full items-start gap-1.5 text-left text-xs text-fg-muted transition-colors hover:text-accent-text"
                  title="Show this line in the transcript"
                >
                  <Quote className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>“{ev.canonicalExcerpt || ev.quote}”</span>
                </button>
              ) : (
                <blockquote className="flex items-start gap-1.5 border-l-2 border-border-strong pl-2 text-xs text-fg-muted">
                  “{ev.canonicalExcerpt || ev.quote}”
                </blockquote>
              )}
            </li>
          ))}
        </ul>
      )}

      {item.state !== 'suggested' && (
        <div className="space-y-1 rounded-lg bg-surface-2/60 p-3 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-fg">
            {item.state === 'rejected' ? (
              <XCircle className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
            )}
            {item.state === 'rejected'
              ? `Rejected: ${item.decisionReason ? REJECT_REASON_LABELS[item.decisionReason] : 'no reason recorded'}`
              : STATE_LABEL[item.state]}
            {item.decidedAt && <span className="font-normal text-fg-muted">· {formatIst(item.decidedAt)}</span>}
          </div>
          {item.decisionNote && <p className="text-fg-muted">Note: {item.decisionNote}</p>}
          {item.task ? (
            <Link
              href={`/orgs/${orgId}/projects/${item.task.projectId}/tasks?task=${item.task.id}`}
              className="link inline-flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              Open {item.task.key}: {item.task.title}
            </Link>
          ) : item.taskId ? (
            <p className="text-fg-muted">The task is in a project you can't see.</p>
          ) : null}
        </div>
      )}

      {item.canDecide && !item.meeting?.nodeId && (
        <p className="text-xs text-fg-muted">Choose this meeting's project before deciding its suggestions.</p>
      )}

      {item.state === 'suggested' && item.superseded && (
        <p className="text-xs text-fg-muted">
          Outdated: the meeting was processed again (or paused) after this suggestion was made, so it can no longer be
          decided.
        </p>
      )}

      {item.state === 'suggested' && !item.superseded && item.consentWithdrawn && (
        <p className="text-xs text-fg-muted">
          On hold: the host's consent for processing is no longer in effect (they opted out or an admin disabled it), so
          this suggestion can't be decided.
        </p>
      )}

      {canDecide && needsAck && (
        <label className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-subtle p-2.5 text-xs text-warning">
          <input type="checkbox" checked={ackDedup} onChange={(e) => setAckDedup(e.target.checked)} className="mt-0.5" />
          <span>
            The duplicate check didn't finish ({item.dedupStatus ?? 'pending'}). I confirm this isn't already an open task.
          </span>
        </label>
      )}

      {canDecide && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => decide({ decision: 'approve', ...(needsAck ? { acknowledgeIncompleteDedup: true } : {}) }, false)}
            disabled={busy || (needsAck && !ackDedup)}
            aria-describedby={textId}
            className={primaryButton}
          >
            {busy ? <RotateCw className="animate-spin" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
            Approve
          </button>
          <button type="button" onClick={() => setDialog('edit')} disabled={busy} aria-describedby={textId} className={secondaryButton}>
            <Pencil aria-hidden="true" />
            Edit…
          </button>
          <button
            type="button"
            onClick={() => setDialog('reject')}
            disabled={busy}
            aria-describedby={textId}
            className="btn btn-ghost btn-sm hover:text-danger"
          >
            <XCircle aria-hidden="true" />
            Reject…
          </button>
        </div>
      )}

      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className={
          status
            ? `flex items-start gap-1.5 rounded-lg border p-2.5 text-xs ${
                status.ok ? 'border-success/30 bg-success-subtle text-success' : 'border-danger/30 bg-danger-subtle text-danger'
              }`
            : undefined
        }
      >
        {status && (
          <>
            {status.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>
              <strong>{status.ok ? 'Saved: ' : 'Not saved: '}</strong>
              {status.text}
            </span>
          </>
        )}
      </div>

      <EditDecisionDialog
        item={item}
        orgId={orgId}
        isOpen={dialog === 'edit'}
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={(body) => decide(body, true)}
      />
      <RejectDecisionDialog
        isOpen={dialog === 'reject'}
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={(body) => decide(body, true)}
      />
    </article>
  );
}

interface DecisionDialogProps {
  isOpen: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: ActionItemDecisionInput) => Promise<string | null>;
}

function RejectDecisionDialog({ isOpen, busy, onClose, onSubmit }: DecisionDialogProps) {
  const [reason, setReason] = useState<ActionItemRejectReason | ''>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setNote('');
      setError(null);
    }
  }, [isOpen]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) {
      setError('Choose a reason for rejecting.');
      return;
    }
    setError(await onSubmit({ decision: 'reject', reason, ...(note.trim() ? { note: note.trim() } : {}) }));
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Reject suggestion"
      description="No task is created or changed. The reason is recorded to improve future suggestions."
      maxWidthClass="max-w-md"
    >
      <form onSubmit={submit} className="space-y-4 text-sm text-fg">
        <fieldset className="space-y-1.5">
          <legend className="label">Reason</legend>
          {(Object.entries(REJECT_REASON_LABELS) as Array<[ActionItemRejectReason, string]>).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="reject-reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="block space-y-1">
          <span className="label">Note (optional)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} className={inputClass} />
        </label>
        {error && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger-subtle p-2.5 text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy && <RotateCw className="animate-spin" aria-hidden="true" />}
            Reject suggestion
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface MemberOption {
  id: string;
  name: string | null;
  email: string;
  role: string;
}
interface ProjectOption {
  id: string;
  name: string;
  visibility: 'public' | 'private';
}

function EditDecisionDialog({ item, orgId, isOpen, busy, onClose, onSubmit }: DecisionDialogProps & { item: ActionItemDTO; orgId: string }) {
  const meetingProjectId = item.meeting?.nodeId ?? '';
  const [members, setMembers] = useState<MemberOption[] | null>(null);
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [projectMembers, setProjectMembers] = useState<Record<string, Set<string>>>({});
  const [target, setTarget] = useState<TargetPreview | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [initial, setInitial] = useState<EditForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tasks the human may choose to update: the proposal's target plus the dedup alternatives.
  const targetOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string }> = [];
    if (item.targetTask) opts.push({ id: item.targetTask.id, label: `${item.targetTask.key} — ${item.targetTask.title}` });
    for (const alt of item.rankedAlternatives ?? []) {
      if (!opts.some((o) => o.id === alt.taskId)) opts.push({ id: alt.taskId, label: `${alt.taskKey} — ${alt.taskTitle}` });
    }
    return opts;
  }, [item]);

  useEffect(() => {
    if (!isOpen) {
      setForm(null);
      setInitial(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const getJson = (url: string): Promise<{ members?: MemberOption[]; projects?: ProjectOption[] }> =>
      fetch(url).then((r) => (r.ok ? r.json() : {}));
    Promise.all([getJson(`/api/orgs/${orgId}/members`), getJson(`/api/orgs/${orgId}/projects?limit=100`)])
      .then(([m, p]) => {
        if (cancelled) return;
        setMembers(m.members ?? []);
        setProjects((p.projects ?? []).map((x) => ({ id: x.id, name: x.name, visibility: x.visibility })));
      })
      .catch(() => {
        if (cancelled) return;
        setMembers([]);
        setProjects([]);
        setError('Could not load members and projects.');
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, orgId]);

  /**
   * Assignee eligibility mirrors the task-assignment rule (server re-checks and returns 422):
   * public project -> any org member; private -> Owners/Admins and project members. null = still loading.
   */
  const eligibleIn = useCallback(
    (projectId: string): ((userId: string) => boolean) | null => {
      if (!members || !projects) return null;
      const project = projects.find((p) => p.id === projectId);
      if (!project || project.visibility === 'public') return (id) => members.some((m) => m.id === id);
      const projectMemberIds = projectMembers[projectId];
      if (!projectMemberIds) return null;
      return (id) => members.some((m) => m.id === id && (m.role === 'owner' || m.role === 'admin' || projectMemberIds.has(id)));
    },
    [members, projects, projectMembers]
  );

  const activeProjectId = form?.mode === 'create' ? form.projectId : meetingProjectId;
  useEffect(() => {
    const project = projects?.find((p) => p.id === activeProjectId);
    if (!isOpen || !project || project.visibility !== 'private' || projectMembers[project.id]) return;
    fetch(`/api/orgs/${orgId}/nodes/${project.id}/members`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) =>
        setProjectMembers((prev) => ({ ...prev, [project.id]: new Set((d.members ?? []).map((m: { userId: string }) => m.userId)) }))
      )
      .catch(() => setProjectMembers((prev) => ({ ...prev, [project.id]: new Set() })));
  }, [isOpen, orgId, projects, activeProjectId, projectMembers]);

  const reset = (next: EditForm) => {
    setForm(next);
    setInitial(next);
  };

  // Prefill once members/projects (and the meeting project's eligibility) are known.
  useEffect(() => {
    const eligible = eligibleIn(meetingProjectId);
    if (!isOpen || form || !eligible) return;
    const t = item.targetTask ? toPreview(item.targetTask) : null;
    setTarget(t);
    reset(initialEditForm(item, item.proposalType === 'update_task' && t ? 'update' : 'create', t, eligible));
  }, [isOpen, form, eligibleIn, meetingProjectId, item]);

  // A project change can make the chosen assignee ineligible: clear it rather than send a doomed request.
  useEffect(() => {
    if (!form || form.mode !== 'create' || !form.assigneeId) return;
    const eligible = eligibleIn(form.projectId);
    if (eligible && !eligible(form.assigneeId)) setForm({ ...form, assigneeId: '' });
  }, [form, eligibleIn]);

  const chooseTarget = async (taskId: string) => {
    const eligible = eligibleIn(meetingProjectId);
    if (!eligible) return;
    let next: TargetPreview;
    if (item.targetTask?.id === taskId) {
      next = toPreview(item.targetTask);
    } else {
      const res = await fetch(`/api/orgs/${orgId}/tasks/${taskId}`);
      if (!res.ok) {
        setError('Could not load that task.');
        return;
      }
      const task: TaskDTO = await res.json();
      next = { ...task, assigneeName: task.assignee?.name ?? null };
    }
    setError(null);
    setTarget(next);
    reset(initialEditForm(item, 'update', next, eligible));
  };

  const switchMode = (mode: 'create' | 'update') => {
    const eligible = eligibleIn(meetingProjectId);
    if (!eligible) return;
    if (mode === 'update') void chooseTarget(target?.id ?? targetOptions[0]!.id);
    else reset(initialEditForm(item, 'create', null, eligible));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !initial) return;
    if (form.mode === 'create' && !form.title.trim()) return setError('A task title is required.');
    if (editNeedsDedupAck(item, form) && !form.acknowledgeIncompleteDedup) {
      return setError('Confirm that this is not already a task before creating it.');
    }
    if (form.mode === 'update' && !form.targetTaskId) return setError('Choose the task to update.');
    setError(null);
    setError(await onSubmit(buildEditDecision(item, form, initial)));
  };

  const eligible = form ? eligibleIn(form.mode === 'create' ? form.projectId : meetingProjectId) : null;
  const assigneeOptions = members?.filter((m) => eligible?.(m.id)) ?? [];
  const nameOf = (id: string) => {
    const m = members?.find((x) => x.id === id);
    return m ? m.name || m.email : 'Unassigned';
  };
  const projectOptions =
    projects && item.project && !projects.some((p) => p.id === item.project!.id)
      ? [{ ...item.project, visibility: 'private' as const }, ...projects]
      : (projects ?? []);
  const set = (patch: Partial<EditForm>) => form && setForm({ ...form, ...patch });

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Edit and approve suggestion"
      description="The task is created or updated with your values. Changed fields are recorded to improve future suggestions."
      maxWidthClass="max-w-xl"
    >
      {!form ? (
        <p role="status" className="text-xs text-fg-muted flex items-center gap-2">
          <RotateCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading members and projects…
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4 text-sm text-fg">
          <p className="rounded-lg bg-surface-2 p-3 text-fg-muted">
            Suggestion: <span className="text-fg">{item.text}</span>
          </p>

          {targetOptions.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="label">Apply as</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name={`mode-${item.id}`} checked={form.mode === 'create'} onChange={() => switchMode('create')} />
                Create a new task
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name={`mode-${item.id}`} checked={form.mode === 'update'} onChange={() => switchMode('update')} />
                Update an existing task
              </label>
            </fieldset>
          )}

          {form.mode === 'update' ? (
            <>
              {targetOptions.length > 1 && (
                <label className="block space-y-1">
                  <span className="label">Task to update</span>
                  <select value={form.targetTaskId} onChange={(e) => void chooseTarget(e.target.value)} className={inputClass}>
                    {targetOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block space-y-1">
                <span className="label">Note appended to the task description</span>
                <textarea value={form.note} onChange={(e) => set({ note: e.target.value })} rows={3} className={inputClass} />
              </label>
            </>
          ) : (
            <>
              <label className="block space-y-1">
                <span className="label">Title</span>
                <input value={form.title} onChange={(e) => set({ title: e.target.value })} required maxLength={500} className={inputClass} />
              </label>
              <label className="block space-y-1">
                <span className="label">Description (optional)</span>
                <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={3} className={inputClass} />
                <span className="block text-xs text-fg-muted">A line linking back to the meeting is added automatically.</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="label">Project</span>
                  <select value={form.projectId} onChange={(e) => set({ projectId: e.target.value })} className={inputClass}>
                    {projectOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="label">Priority</span>
                  <select value={form.priority} onChange={(e) => set({ priority: e.target.value as TaskPriority })} className={inputClass}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
              </div>
            </>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="label">Assignee</span>
              <select
                value={form.assigneeId}
                onChange={(e) => set({ assigneeId: e.target.value })}
                disabled={!eligible}
                className={inputClass}
              >
                <option value="">Unassigned</option>
                {assigneeOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
              {!eligible && <span className="block text-xs text-fg-muted">Loading eligible members…</span>}
            </label>
            <label className="block space-y-1">
              <span className="label">Due date</span>
              <input type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} className={inputClass} />
            </label>
          </div>
          {item.suggestedOwnerId && eligible && !eligible(item.suggestedOwnerId) && (
            <p className="text-xs text-warning">
              Warning: the suggested owner ({item.suggestedOwner?.name || item.suggestedOwner?.email}) cannot be assigned in this
              project.
            </p>
          )}

          {form.mode === 'update' && target && (
            <div className="space-y-1 rounded-lg border border-border bg-surface-2/60 p-3">
              <div className="text-xs font-medium">
                {target.key} — {target.title}
              </div>
              <BeforeAfter
                target={target}
                after={{ assignee: nameOf(form.assigneeId), due: form.dueDate || 'None', note: form.note.trim() }}
              />
            </div>
          )}

          {editNeedsDedupAck(item, form) && (
            <label className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-subtle p-2.5 text-warning">
              <input
                type="checkbox"
                checked={form.acknowledgeIncompleteDedup}
                onChange={(e) => set({ acknowledgeIncompleteDedup: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                {dedupComplete(item)
                  ? 'No duplicate check was run for the chosen project.'
                  : `The duplicate check did not complete (${item.dedupStatus ?? 'pending'}).`}{' '}
                I confirm this is not already an open task.
              </span>
            </label>
          )}

          {error && (
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger-subtle p-2.5 text-danger">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className={secondaryButton}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy && <RotateCw className="animate-spin" aria-hidden="true" />}
              {form.mode === 'create' ? 'Create task' : 'Update task'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
