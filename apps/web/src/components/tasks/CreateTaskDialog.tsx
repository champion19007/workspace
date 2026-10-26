'use client';

import React, { useState, useEffect, useId } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/states';
import { type TaskDTO, type TaskLabelDTO, type TaskStatus, type TaskPriority } from '@workspace/core';

interface MemberOption {
  id: string;
  name: string;
  email: string;
}

interface CreateTaskDialogProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  projectId: string;
  /** When given, the dialog shows a project picker (used on the cross-project task list). */
  projects?: { id: string; name: string }[];
  parentTaskId?: string | null;
  parentTaskTitle?: string;
  initialStatus?: TaskStatus;
  onTaskCreated: (task: TaskDTO) => void;
}

export function CreateTaskDialog({
  isOpen,
  onClose,
  orgId,
  projectId,
  projects,
  parentTaskId,
  parentTaskTitle,
  initialStatus = 'todo',
  onTaskCreated,
}: CreateTaskDialogProps) {
  const ids = useId();
  const [targetProjectId, setTargetProjectId] = useState(projectId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>(initialStatus);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  const [availableMembers, setAvailableMembers] = useState<MemberOption[]>([]);
  const [availableLabels, setAvailableLabels] = useState<TaskLabelDTO[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTargetProjectId(projectId);
      setTitle('');
      setDescription('');
      setStatus(initialStatus || 'todo');
      setPriority('medium');
      setAssigneeId('');
      setDueDate('');
      setSelectedLabels([]);
      setError(null);

      // Fetch members for assignee picker
      fetch(`/api/orgs/${orgId}/members`)
        .then((res) => (res.ok ? res.json() : { members: [] }))
        .then((data) => {
          if (data.members) {
            setAvailableMembers(
              data.members.map((m: any) => ({
                id: m.userId || m.id,
                name: m.user?.name || m.name || m.user?.email || m.email,
                email: m.user?.email || m.email,
              }))
            );
          }
        })
        .catch(() => {});

      // Fetch org labels
      fetch(`/api/orgs/${orgId}/labels`)
        .then((res) => (res.ok ? res.json() : { labels: [] }))
        .then((data) => {
          if (data.labels) {
            setAvailableLabels(data.labels);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, orgId, projectId, initialStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Give the task a title.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const endpoint = parentTaskId
        ? `/api/orgs/${orgId}/tasks/${parentTaskId}/subtasks`
        : `/api/orgs/${orgId}/projects/${targetProjectId}/tasks`;

      const payload: any = {
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        assigneeId: assigneeId || null,
        dueDate: dueDate || null,
        labelIds: selectedLabels,
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || "The task couldn't be created.");
      }

      onTaskCreated(data);
      onClose();
    } catch (err: any) {
      setError(err.message || "The task couldn't be created. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleLabel = (labelId: string) => {
    setSelectedLabels((prev) =>
      prev.includes(labelId) ? prev.filter((id) => id !== labelId) : [...prev, labelId]
    );
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={parentTaskId ? 'New subtask' : 'New task'}
      description={parentTaskId ? `Under “${parentTaskTitle || 'parent task'}”` : undefined}
      maxWidthClass="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}

        {projects && !parentTaskId && (
          <div>
            <label htmlFor={`${ids}-project`} className="label">
              Project
            </label>
            <select
              id={`${ids}-project`}
              value={targetProjectId}
              onChange={(e) => setTargetProjectId(e.target.value)}
              className="field"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor={`${ids}-title`} className="label">
            Title
          </label>
          <input
            id={`${ids}-title`}
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="field"
            autoFocus
          />
        </div>

        <div>
          <label htmlFor={`${ids}-description`} className="label">
            Description <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <textarea
            id={`${ids}-description`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Context, acceptance criteria or links"
            rows={3}
            className="field resize-y"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${ids}-status`} className="label">
              Status
            </label>
            <select
              id={`${ids}-status`}
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className="field"
            >
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>

          <div>
            <label htmlFor={`${ids}-priority`} className="label">
              Priority
            </label>
            <select
              id={`${ids}-priority`}
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="field"
            >
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
            <select
              id={`${ids}-assignee`}
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="field"
            >
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
              </label>
              {dueDate && (
                <button type="button" onClick={() => setDueDate('')} className="mb-1.5 text-xs font-medium text-accent-text hover:underline">
                  Clear
                </button>
              )}
            </div>
            <input
              id={`${ids}-due`}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="field"
            />
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

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={isSubmitting} className="btn btn-primary">
            {isSubmitting ? 'Creating…' : parentTaskId ? 'Create subtask' : 'Create task'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
