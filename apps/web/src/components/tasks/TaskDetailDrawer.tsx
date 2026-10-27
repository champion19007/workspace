'use client';

import React, { useState, useEffect, useId } from 'react';
import { useShell } from '@/components/shell/shell-context';
import { Drawer } from '@/components/ui/drawer';
import { StatusBadge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/states';
import { CreateTaskDialog } from './CreateTaskDialog';
import { CommentThread } from '@/components/comments/CommentThread';
import {
  type TaskDTO,
  type TaskLabelDTO,
  type TaskStatus,
  type TaskPriority,
  formatETag,
} from '@workspace/core';
import { Archive, Plus } from 'lucide-react';
import { dueLabel, formatShortDate } from '@/lib/format';

interface MemberOption {
  id: string;
  name: string;
  email: string;
}

interface TaskDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  projectId?: string;
  taskId: string | null;
  onTaskUpdated: (task: TaskDTO) => void;
  onTaskArchived?: (taskId: string) => void;
}

function sameLabels(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function TaskDetailDrawer({
  isOpen,
  onClose,
  orgId,
  taskId,
  onTaskUpdated,
  onTaskArchived,
}: TaskDetailDrawerProps) {
  const ids = useId();
  const { refreshProjects } = useShell();
  const [task, setTask] = useState<TaskDTO | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  // Subtasks
  const [subtasks, setSubtasks] = useState<TaskDTO[]>([]);
  const [isAddSubtaskOpen, setIsAddSubtaskOpen] = useState(false);

  // Members & Labels
  const [availableMembers, setAvailableMembers] = useState<MemberOption[]>([]);
  const [availableLabels, setAvailableLabels] = useState<TaskLabelDTO[]>([]);

  // OCC Conflict State
  const [conflictServerTask, setConflictServerTask] = useState<TaskDTO | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadForm = (data: TaskDTO) => {
    setTask(data);
    setTitle(data.title);
    setDescription(data.description || '');
    setStatus(data.status);
    setPriority(data.priority);
    setAssigneeId(data.assigneeId || '');
    setDueDate(data.dueDate || '');
    setSelectedLabels(data.labels.map((l) => l.id));
  };

  // Load task details when opened
  useEffect(() => {
    if (isOpen && taskId) {
      setIsLoading(true);
      setTask(null);
      setConflictServerTask(null);
      setErrorMessage(null);
      setSuccessMessage(null);

      fetch(`/api/orgs/${orgId}/tasks/${taskId}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(res.status === 404 ? "This task doesn't exist or was archived." : "The task couldn't be loaded.");
          return res.json();
        })
        .then((data: TaskDTO) => loadForm(data))
        .catch((err) => setErrorMessage((err as Error).message))
        .finally(() => setIsLoading(false));

      fetch(`/api/orgs/${orgId}/tasks/${taskId}/subtasks`)
        .then((res) => (res.ok ? res.json() : { subtasks: [] }))
        .then((data) => setSubtasks(data.subtasks || []))
        .catch(() => {});

      fetch(`/api/orgs/${orgId}/members`)
        .then((res) => (res.ok ? res.json() : { members: [] }))
        .then((data) => {
          if (data.members) {
            setAvailableMembers(
              data.members.map((m: { id: string; name: string | null; email: string }) => ({
                id: m.id,
                name: m.name || m.email,
                email: m.email,
              }))
            );
          }
        })
        .catch(() => {});

      fetch(`/api/orgs/${orgId}/labels`)
        .then((res) => (res.ok ? res.json() : { labels: [] }))
        .then((data) => {
          if (data.labels) setAvailableLabels(data.labels);
        })
        .catch(() => {});
    }
  }, [isOpen, taskId, orgId]);

  const isDirty =
    task !== null &&
    (title.trim() !== task.title ||
      (description.trim() || null) !== (task.description || null) ||
      status !== task.status ||
      priority !== task.priority ||
      (assigneeId || null) !== (task.assigneeId || null) ||
      (dueDate || null) !== (task.dueDate || null) ||
      !sameLabels(selectedLabels, task.labels.map((l) => l.id)));

  const handleSave = async (overrideVersion?: number) => {
    if (!task) return;
    if (!title.trim()) {
      setErrorMessage('A task needs a title.');
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const versionToUse = overrideVersion !== undefined ? overrideVersion : task.version;

    try {
      const res = await fetch(`/api/orgs/${orgId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': formatETag(versionToUse),
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          status,
          priority,
          assigneeId: assigneeId || null,
          dueDate: dueDate || null,
          labelIds: selectedLabels,
        }),
      });

      const data = await res.json();

      if (res.status === 412) {
        // Someone else saved first: keep the draft and show what changed on the server.
        const serverState = data.currentEntity || (await fetch(`/api/orgs/${orgId}/tasks/${task.id}`).then((r) => r.json()));
        setConflictServerTask(serverState);
        return;
      }

      if (!res.ok) {
        throw new Error(data.detail || data.message || "Your changes couldn't be saved.");
      }

      setTask(data);
      setConflictServerTask(null);
      setSuccessMessage('Saved');
      onTaskUpdated(data);
      refreshProjects();
      setTimeout(() => setSuccessMessage(null), 2500);
    } catch (err) {
      setErrorMessage((err as Error).message || "Your changes couldn't be saved.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleResolveOverwrite = () => {
    if (conflictServerTask) handleSave(conflictServerTask.version);
  };

  const handleResolveDiscard = () => {
    if (conflictServerTask) {
      loadForm(conflictServerTask);
      setConflictServerTask(null);
      setErrorMessage(null);
      setSuccessMessage('Showing the latest saved version');
      setTimeout(() => setSuccessMessage(null), 2500);
    }
  };

  const handleArchive = async () => {
    if (!task) return;
    if (!confirm(`Archive ${task.key}? It will disappear from lists and boards.`)) return;

    setIsArchiving(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/tasks/${task.id}`, {
        method: 'DELETE',
        headers: { 'If-Match': formatETag(task.version) },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as Error).message || "The task couldn't be archived.");
      }

      if (onTaskArchived) onTaskArchived(task.id);
      refreshProjects();
      onClose();
    } catch (err) {
      setErrorMessage((err as Error).message || "The task couldn't be archived.");
    } finally {
      setIsArchiving(false);
    }
  };

  const toggleLabel = (labelId: string) => {
    setSelectedLabels((prev) => (prev.includes(labelId) ? prev.filter((id) => id !== labelId) : [...prev, labelId]));
  };

  if (!isOpen) return null;

  const due = dueLabel(dueDate || null, status === 'done');

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title={task ? task.key : 'Task'}
        description={task ? `Created ${formatShortDate(task.createdAt.slice(0, 10))}` : undefined}
        widthClass="max-w-2xl w-full"
        footer={
          task && (
            <>
              <button type="button" onClick={handleArchive} disabled={isArchiving} className="btn btn-ghost btn-sm text-danger hover:bg-danger-subtle hover:text-danger">
                <Archive aria-hidden="true" />
                {isArchiving ? 'Archiving…' : 'Archive'}
              </button>
              <span className="ml-auto text-xs text-fg-muted" role="status">
                {successMessage ?? (isDirty ? 'Unsaved changes' : '')}
              </span>
              <button type="button" onClick={() => handleSave()} disabled={isSaving || !isDirty} className="btn btn-primary btn-sm">
                {isSaving ? 'Saving…' : 'Save changes'}
              </button>
            </>
          )
        }
      >
        {isLoading ? (
          <div role="status" aria-busy="true" className="space-y-4">
            <span className="sr-only">Loading task…</span>
            <div className="skeleton h-9 w-full" />
            <div className="skeleton h-24 w-full" />
            <div className="grid grid-cols-2 gap-3">
              <div className="skeleton h-9" />
              <div className="skeleton h-9" />
              <div className="skeleton h-9" />
              <div className="skeleton h-9" />
            </div>
          </div>
        ) : task ? (
          <div className="space-y-6 pb-4">
            {conflictServerTask && (
              <Alert tone="warning" title="Someone else saved this task while you were editing">
                <p>
                  The latest version is titled “{conflictServerTask.title}” ({conflictServerTask.status.replace('_', ' ')},{' '}
                  {conflictServerTask.assignee?.name || 'unassigned'}). Your edits are still in the form.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={handleResolveOverwrite} className="btn btn-secondary btn-sm">
                    Keep my edits
                  </button>
                  <button type="button" onClick={handleResolveDiscard} className="btn btn-ghost btn-sm">
                    Use their version
                  </button>
                </div>
              </Alert>
            )}

            {errorMessage && !conflictServerTask && <Alert onDismiss={() => setErrorMessage(null)}>{errorMessage}</Alert>}

            <div className="space-y-4">
              <div>
                <label htmlFor={`${ids}-title`} className="sr-only">
                  Title
                </label>
                <input
                  id={`${ids}-title`}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="field h-11 text-base font-semibold"
                />
              </div>
              <div>
                <label htmlFor={`${ids}-description`} className="label">
                  Description
                </label>
                <textarea
                  id={`${ids}-description`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add context, acceptance criteria or links"
                  rows={4}
                  className="field resize-y"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={`${ids}-status`} className="label">
                  Status
                </label>
                <select id={`${ids}-status`} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className="field">
                  <option value="todo">To do</option>
                  <option value="in_progress">In progress</option>
                  <option value="blocked">Blocked</option>
                  <option value="done">Done</option>
                </select>
              </div>
              <div>
                <label htmlFor={`${ids}-priority`} className="label">
                  Priority
                </label>
                <select id={`${ids}-priority`} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="field">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label htmlFor={`${ids}-assignee`} className="label">
                  Assignee
                </label>
                <select id={`${ids}-assignee`} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="field">
                  <option value="">Unassigned</option>
                  {availableMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor={`${ids}-due`} className="label">
                    Due date
                    {due.text && (
                      <span className={`ml-2 font-normal ${due.overdue ? 'text-danger' : 'text-fg-muted'}`}>
                        {due.overdue ? 'overdue' : due.soon ? due.text.toLowerCase() : ''}
                      </span>
                    )}
                  </label>
                  {dueDate && (
                    <button type="button" onClick={() => setDueDate('')} className="mb-1.5 text-xs font-medium text-accent-text hover:underline">
                      Clear
                    </button>
                  )}
                </div>
                <input id={`${ids}-due`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="field" />
              </div>
            </div>

            {availableLabels.length > 0 && (
              <fieldset>
                <legend className="label">Labels</legend>
                <div className="flex flex-wrap gap-1.5">
                  {availableLabels.map((l) => {
                    const isSelected = selectedLabels.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => toggleLabel(l.id)}
                        className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors ${
                          isSelected
                            ? 'border-accent bg-accent-subtle text-accent-text'
                            : 'border-border-strong text-fg-muted hover:border-input hover:text-fg'
                        }`}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} aria-hidden="true" />
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}

            <section aria-labelledby={`${ids}-subtasks`} className="space-y-2 border-t border-border pt-5">
              <div className="flex items-center justify-between">
                <h3 id={`${ids}-subtasks`} className="text-sm font-semibold text-fg">
                  Subtasks <span className="font-normal text-fg-muted">{subtasks.length}</span>
                </h3>
                {!task.parentTaskId && (
                  <button type="button" onClick={() => setIsAddSubtaskOpen(true)} className="btn btn-ghost btn-sm">
                    <Plus aria-hidden="true" />
                    Add subtask
                  </button>
                )}
              </div>

              {subtasks.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  {task.parentTaskId ? 'Subtasks can’t have their own subtasks.' : 'Break this task into smaller steps.'}
                </p>
              ) : (
                <ul className="card divide-y divide-border overflow-hidden">
                  {subtasks.map((st) => (
                    <li key={st.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                      <StatusBadge status={st.status} size="sm" />
                      <span className="font-mono text-xs text-fg-subtle">{st.key}</span>
                      <span className="min-w-0 flex-1 text-fg">{st.title}</span>
                      {st.dueDate && <span className="text-xs text-fg-muted">{formatShortDate(st.dueDate)}</span>}
                      {st.assignee && <span className="text-xs text-fg-muted">{st.assignee.name}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="border-t border-border pt-5">
              <CommentThread
                orgId={orgId}
                targetType="task"
                targetId={task.id}
                emptyText="Ask a question or share an update. People you @mention get a notification."
                hint="Only the team sees task comments, never clients."
              />
            </div>
          </div>
        ) : errorMessage ? (
          <Alert>{errorMessage}</Alert>
        ) : null}
      </Drawer>

      {task && (
        <CreateTaskDialog
          isOpen={isAddSubtaskOpen}
          onClose={() => setIsAddSubtaskOpen(false)}
          orgId={orgId}
          projectId={task.projectId}
          parentTaskId={task.id}
          parentTaskTitle={task.title}
          onTaskCreated={(newSubtask) => {
            setSubtasks((prev) => [...prev, newSubtask]);
          }}
        />
      )}
    </>
  );
}
