'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ExternalLink,
  GitMerge,
  Pencil,
  PlusCircle,
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
import { Dialog } from '@/components/ui/dialog';
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

const inputClass =
  'w-full px-2.5 py-1.5 rounded-lg bg-panel-inset border border-border-subtle text-xs text-foreground focus:border-accent';
const secondaryButton =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-subtle text-xs text-foreground hover:bg-panel-elevated transition-colors disabled:opacity-50';
const primaryButton =
  'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent text-accent-foreground font-semibold text-xs hover:opacity-90 transition-opacity disabled:opacity-50';

/** Meeting-relative times are shown in Asia/Kolkata. */
function formatIst(iso: string | null | undefined): string {
  if (!iso) return 'time unknown';
  return `${new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST`;
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
    <table className="w-full text-left text-[11px] border-collapse">
      <caption className="sr-only">Changes to {target.key} if this update is approved</caption>
      <thead className="text-muted-foreground">
        <tr>
          <th scope="col" className="py-1 pr-2 font-medium">Field</th>
          <th scope="col" className="py-1 pr-2 font-medium">Before</th>
          <th scope="col" className="py-1 font-medium">After</th>
        </tr>
      </thead>
      <tbody className="align-top">
        <tr className="border-t border-border-subtle">
          <th scope="row" className="py-1 pr-2 font-medium text-muted-foreground">Assignee</th>
          <td className="py-1 pr-2">{target.assigneeName ?? 'Unassigned'}</td>
          <td className="py-1 text-foreground">{after.assignee}</td>
        </tr>
        <tr className="border-t border-border-subtle">
          <th scope="row" className="py-1 pr-2 font-medium text-muted-foreground">Due date</th>
          <td className="py-1 pr-2 font-mono">{target.dueDate ?? 'None'}</td>
          <td className="py-1 font-mono text-foreground">{after.due}</td>
        </tr>
        <tr className="border-t border-border-subtle">
          <th scope="row" className="py-1 pr-2 font-medium text-muted-foreground">Description</th>
          <td className="py-1 pr-2">{excerpt(target.description)}</td>
          <td className="py-1 text-foreground">{after.note ? `Unchanged, plus note: "${after.note}"` : 'Unchanged'}</td>
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
    <article
      aria-labelledby={textId}
      className="p-3.5 rounded-lg bg-panel border border-border-subtle hover:border-accent/30 transition-colors space-y-2.5 text-xs"
    >
      {showMeeting && item.meeting && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <Video className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
          <a href={`/orgs/${orgId}/meetings?meeting=${item.meetingId}`} className="font-semibold text-foreground hover:underline">
            {item.meeting.title || 'Untitled meeting'}
          </a>
          <span>{formatIst(item.meeting.startedAt)}</span>
          <span>· {item.project ? `Project: ${item.project.name}` : 'Not routed to a project'}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {item.proposalType === 'update_task' ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <GitMerge className="w-3 h-3" aria-hidden="true" /> Update existing task
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            <PlusCircle className="w-3 h-3" aria-hidden="true" /> New task
          </span>
        )}
        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-panel-inset text-foreground border border-border-subtle">
          {STATE_LABEL[item.state]}
        </span>
        <span className="px-2 py-0.5 rounded text-[10px] font-mono text-muted-foreground border border-border-subtle">
          {Math.round(item.confidence * 100)}% confidence
        </span>
      </div>

      <p id={textId} className="text-sm font-medium text-foreground leading-snug">
        {item.text}
      </p>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <User className="w-3 h-3" aria-hidden="true" />
          Suggested owner:{' '}
          <strong className="text-foreground">
            {item.suggestedOwner
              ? item.suggestedOwner.name || item.suggestedOwner.email
              : item.ownerName
                ? `${item.ownerName} (not matched to a member)`
                : 'None'}
          </strong>
        </span>
        <span className="flex items-center gap-1">
          <Calendar className="w-3 h-3" aria-hidden="true" />
          Suggested due:{' '}
          <strong className="text-foreground font-mono">
            {item.suggestedDue ?? (item.duePhrase ? `"${item.duePhrase}" (no date resolved)` : 'None')}
          </strong>
        </span>
      </div>

      {item.proposalType === 'update_task' && (
        <div className="p-2.5 rounded bg-panel-inset border border-border-subtle space-y-1.5">
          {target ? (
            <>
              <div className="text-[11px] font-semibold text-foreground">
                Target task: {target.key} — {target.title}
              </div>
              {item.state === 'suggested' && (target.status === 'done' || target.archivedAt) ? (
                <p className="flex gap-1.5 text-[11px] text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  Warning: the target task is completed or archived, so this update cannot be applied. Use Edit to create a
                  new task instead, or reject.
                </p>
              ) : item.state === 'suggested' && target.version !== item.targetTaskVersion ? (
                <p className="flex gap-1.5 text-[11px] text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  Warning: the target task changed after this suggestion was made (version {item.targetTaskVersion} → {target.version}).
                  Approve will be refused; use Edit to apply the update to the current task.
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
            <p className="text-[11px] text-muted-foreground">Updates an existing task in a project you cannot see.</p>
          )}
        </div>
      )}

      {item.evidence.length > 0 && (
        <ul className="space-y-1" aria-label="Transcript evidence">
          {item.evidence.map((ev, idx) => (
            <li key={idx}>
              {onJumpToCue ? (
                <button
                  type="button"
                  onClick={() => onJumpToCue(ev.seq)}
                  className="inline-flex items-start gap-1 px-2 py-1 rounded text-[10px] font-mono bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 transition-colors text-left"
                >
                  <ExternalLink className="w-2.5 h-2.5 shrink-0 mt-0.5" aria-hidden="true" />
                  Jump to cue #{ev.seq}: &quot;{ev.canonicalExcerpt || ev.quote}&quot;
                </button>
              ) : (
                <blockquote className="px-2 py-1 rounded text-[11px] italic text-muted-foreground bg-panel-inset border border-border-subtle">
                  Cue #{ev.seq}: &quot;{ev.canonicalExcerpt || ev.quote}&quot;
                </blockquote>
              )}
            </li>
          ))}
        </ul>
      )}

      {item.state !== 'suggested' && (
        <div className="p-2.5 rounded bg-panel-inset border border-border-subtle space-y-1 text-[11px]">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            {item.state === 'rejected' ? (
              <XCircle className="w-3.5 h-3.5 text-rose-400" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
            )}
            {item.state === 'rejected'
              ? `Rejected: ${item.decisionReason ? REJECT_REASON_LABELS[item.decisionReason] : 'no reason recorded'}`
              : STATE_LABEL[item.state]}
            {item.decidedAt && <span className="font-normal text-muted-foreground">· {formatIst(item.decidedAt)}</span>}
          </div>
          {item.decisionNote && <p className="text-muted-foreground">Note: {item.decisionNote}</p>}
          {item.task ? (
            <a
              href={`/orgs/${orgId}/projects/${item.task.projectId}/tasks?task=${item.task.id}`}
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
              Open task {item.task.key}: {item.task.title}
            </a>
          ) : item.taskId ? (
            <p className="text-muted-foreground">The linked task is in a project you cannot see.</p>
          ) : null}
        </div>
      )}

      {item.canDecide && !item.meeting?.nodeId && (
        <p className="text-[11px] text-muted-foreground">Route this meeting to a project before deciding its suggestions.</p>
      )}

      {item.state === 'suggested' && item.superseded && (
        <p className="text-[11px] text-muted-foreground">
          Outdated: the meeting was re-processed or its processing was paused after this suggestion was made, so it can no
          longer be decided.
        </p>
      )}

      {canDecide && needsAck && (
        <label className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-200">
          <input type="checkbox" checked={ackDedup} onChange={(e) => setAckDedup(e.target.checked)} className="mt-0.5" />
          <span>
            The duplicate check did not complete ({item.dedupStatus ?? 'pending'}). I confirm this is not already an open
            task.
          </span>
        </label>
      )}

      {canDecide && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border-subtle">
          <button
            type="button"
            onClick={() => decide({ decision: 'approve', ...(needsAck ? { acknowledgeIncompleteDedup: true } : {}) }, false)}
            disabled={busy || (needsAck && !ackDedup)}
            aria-describedby={textId}
            className={primaryButton}
          >
            {busy ? (
              <RotateCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            Approve
          </button>
          <button type="button" onClick={() => setDialog('edit')} disabled={busy} aria-describedby={textId} className={secondaryButton}>
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            Edit…
          </button>
          <button
            type="button"
            onClick={() => setDialog('reject')}
            disabled={busy}
            aria-describedby={textId}
            className={`${secondaryButton} hover:text-rose-300`}
          >
            <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
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
            ? `flex items-start gap-1.5 p-2 rounded border text-[11px] ${
                status.ok ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200' : 'bg-rose-500/10 border-rose-500/20 text-rose-200'
              }`
            : undefined
        }
      >
        {status && (
          <>
            {status.ok ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
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
      <form onSubmit={submit} className="space-y-4 text-xs text-foreground">
        <fieldset className="space-y-1.5">
          <legend className="font-semibold mb-1.5">Reason</legend>
          {(Object.entries(REJECT_REASON_LABELS) as Array<[ActionItemRejectReason, string]>).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="reject-reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="block space-y-1">
          <span className="font-semibold">Note (optional)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} className={inputClass} />
        </label>
        {error && (
          <p role="alert" className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-200">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy && <RotateCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
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
        <p role="status" className="text-xs text-muted-foreground flex items-center gap-2">
          <RotateCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading members and projects…
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4 text-xs text-foreground">
          <p className="p-2 rounded bg-panel-inset border border-border-subtle text-muted-foreground">
            Suggestion: <span className="text-foreground">{item.text}</span>
          </p>

          {targetOptions.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="font-semibold mb-1.5">Apply as</legend>
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
                  <span className="font-semibold">Task to update</span>
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
                <span className="font-semibold">Note appended to the task description</span>
                <textarea value={form.note} onChange={(e) => set({ note: e.target.value })} rows={3} className={inputClass} />
              </label>
            </>
          ) : (
            <>
              <label className="block space-y-1">
                <span className="font-semibold">Title</span>
                <input value={form.title} onChange={(e) => set({ title: e.target.value })} required maxLength={500} className={inputClass} />
              </label>
              <label className="block space-y-1">
                <span className="font-semibold">Description (optional)</span>
                <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={3} className={inputClass} />
                <span className="block text-[11px] text-muted-foreground">A line linking back to the meeting is added automatically.</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="font-semibold">Project</span>
                  <select value={form.projectId} onChange={(e) => set({ projectId: e.target.value })} className={inputClass}>
                    {projectOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="font-semibold">Priority</span>
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
              <span className="font-semibold">Assignee</span>
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
              {!eligible && <span className="block text-[11px] text-muted-foreground">Loading eligible members…</span>}
            </label>
            <label className="block space-y-1">
              <span className="font-semibold">Due date</span>
              <input type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} className={inputClass} />
            </label>
          </div>
          {item.suggestedOwnerId && eligible && !eligible(item.suggestedOwnerId) && (
            <p className="text-[11px] text-amber-300">
              Warning: the suggested owner ({item.suggestedOwner?.name || item.suggestedOwner?.email}) cannot be assigned in this
              project.
            </p>
          )}

          {form.mode === 'update' && target && (
            <div className="p-2.5 rounded bg-panel-inset border border-border-subtle space-y-1">
              <div className="text-[11px] font-semibold">
                {target.key} — {target.title}
              </div>
              <BeforeAfter
                target={target}
                after={{ assignee: nameOf(form.assigneeId), due: form.dueDate || 'None', note: form.note.trim() }}
              />
            </div>
          )}

          {editNeedsDedupAck(item, form) && (
            <label className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-200">
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
            <p role="alert" className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-200">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
            <button type="button" onClick={onClose} className={secondaryButton}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy && <RotateCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              {form.mode === 'create' ? 'Create task' : 'Update task'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
