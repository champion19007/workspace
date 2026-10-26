'use client';

import React, { useState } from 'react';
import { useShell } from '@/components/shell/shell-context';
import { Check, CornerDownRight, Search, X } from 'lucide-react';
import { type TaskDTO, formatETag } from '@workspace/core';
import { StatusBadge, PriorityBadge, TaskStatus } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { dueLabel } from '@/lib/format';

export interface TaskFilterState {
  search: string;
  status: string;
  priority: string;
  project: string;
}

export const EMPTY_TASK_FILTERS: TaskFilterState = { search: '', status: 'all', priority: 'all', project: 'all' };

export function isFiltering(f: TaskFilterState): boolean {
  return Boolean(f.search) || f.status !== 'all' || f.priority !== 'all' || f.project !== 'all';
}

export function filterTasks(tasks: TaskDTO[], f: TaskFilterState): TaskDTO[] {
  const q = f.search.trim().toLowerCase();
  return tasks.filter(
    (task) =>
      (!q ||
        task.title.toLowerCase().includes(q) ||
        task.key.toLowerCase().includes(q) ||
        (task.assignee?.name || '').toLowerCase().includes(q)) &&
      (f.status === 'all' || task.status === f.status) &&
      (f.priority === 'all' || task.priority === f.priority) &&
      (f.project === 'all' || task.projectId === f.project)
  );
}

/** Search box and filter selects shared by the task lists. */
export function TaskFilters({
  value,
  onChange,
  projects,
}: {
  value: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
  projects?: { id: string; name: string }[];
}) {
  const set = (patch: Partial<TaskFilterState>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative sm:w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
        <input
          type="search"
          value={value.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Filter by title, key or person"
          aria-label="Filter tasks"
          className="field field-sm pl-9"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {projects && projects.length > 0 && (
          <select value={value.project} onChange={(e) => set({ project: e.target.value })} aria-label="Project" className="field field-sm w-auto">
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <select value={value.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status" className="field field-sm w-auto">
          <option value="all">Any status</option>
          <option value="todo">To do</option>
          <option value="in_progress">In progress</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
        </select>
        <select value={value.priority} onChange={(e) => set({ priority: e.target.value })} aria-label="Priority" className="field field-sm w-auto">
          <option value="all">Any priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        {isFiltering(value) && (
          <button type="button" onClick={() => onChange(EMPTY_TASK_FILTERS)} className="btn btn-ghost btn-sm">
            <X aria-hidden="true" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function DoneCheckbox({ task, busy, onToggle }: { task: TaskDTO; busy: boolean; onToggle: (e: React.MouseEvent) => void }) {
  const done = task.status === 'done';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={`${task.key} ${task.title}: done`}
      disabled={busy}
      onClick={onToggle}
      // 16px box inside a 32px hit area.
      className="group/check -m-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50"
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
          done ? 'border-accent bg-accent text-accent-fg' : 'border-input text-transparent group-hover/check:border-accent'
        }`}
      >
        <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
      </span>
    </button>
  );
}

function Labels({ task }: { task: TaskDTO }) {
  if (!task.labels?.length) return null;
  return (
    <>
      {task.labels.map((l) => (
        <span key={l.id} className="inline-flex items-center gap-1 text-xs text-fg-muted">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} aria-hidden="true" />
          {l.name}
        </span>
      ))}
    </>
  );
}

/** "Subtask of MOBI-2" for lists that carry parent context (My tasks). */
function ParentNote({ task }: { task: TaskDTO & { parentKey?: string | null } }) {
  if (!task.parentKey) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
      <CornerDownRight className="h-3 w-3" aria-hidden="true" />
      Subtask of <span className="font-mono">{task.parentKey}</span>
    </span>
  );
}

function Due({ task }: { task: TaskDTO }) {
  const due = dueLabel(task.dueDate, task.status === 'done');
  if (!due.text) return <span className="text-fg-subtle">—</span>;
  return (
    <span className={`whitespace-nowrap tabular-nums ${due.overdue ? 'font-medium text-danger' : due.soon ? 'text-fg' : 'text-fg-muted'}`}>
      {due.text}
    </span>
  );
}

/**
 * Task list: a table from md up, two-line rows on phones. Titles are buttons so every row can be
 * opened from the keyboard; the checkbox marks a task done/to do in place.
 */
export function TaskList({
  tasks,
  orgId,
  onOpen,
  onTaskUpdated,
  onError,
  projectNames,
}: {
  tasks: TaskDTO[];
  orgId: string;
  onOpen: (task: TaskDTO) => void;
  onTaskUpdated: (task: TaskDTO) => void;
  onError: (message: string) => void;
  /** Adds a Project column (cross-project lists). */
  projectNames?: Record<string, string>;
}) {
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const { refreshProjects } = useShell();

  const toggleDone = async (task: TaskDTO, e: React.MouseEvent) => {
    e.stopPropagation();
    if (togglingId) return;
    setTogglingId(task.id);
    const nextStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done';
    try {
      const res = await fetch(`/api/orgs/${orgId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': formatETag(task.version) },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `${task.key} couldn't be updated.`);
      }
      onTaskUpdated(await res.json());
      refreshProjects();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="card overflow-hidden">
      <table className="table hidden md:table">
        <thead>
          <tr>
            <th className="w-10">
              <span className="sr-only">Done</span>
            </th>
            <th>Task</th>
            {projectNames && <th>Project</th>}
            <th className="w-32">Status</th>
            <th className="w-28">Priority</th>
            <th className="w-44">Assignee</th>
            <th className="w-36">Due</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const done = task.status === 'done';
            return (
              <tr key={task.id} onClick={() => onOpen(task)} className="group cursor-pointer transition-colors hover:bg-surface-2/60">
                <td className="py-2.5">
                  <DoneCheckbox task={task} busy={togglingId === task.id} onToggle={(e) => toggleDone(task, e)} />
                </td>
                <td className="py-2.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="font-mono text-xs text-fg-subtle">{task.key}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(task);
                      }}
                      className={`text-left font-medium hover:underline ${done ? 'text-fg-subtle line-through' : 'text-fg'}`}
                    >
                      {task.title}
                    </button>
                    {(task.subtaskCount ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-fg-muted" title={`${task.subtaskCount} subtasks`}>
                        <CornerDownRight className="h-3 w-3" aria-hidden="true" />
                        {task.subtaskCount}
                        <span className="sr-only"> subtasks</span>
                      </span>
                    )}
                    <Labels task={task} />
                    <ParentNote task={task} />
                  </div>
                </td>
                {projectNames && <td className="whitespace-nowrap py-2.5 text-fg-muted">{projectNames[task.projectId] ?? '—'}</td>}
                <td className="py-2.5">
                  <StatusBadge status={task.status} />
                </td>
                <td className="py-2.5">
                  <PriorityBadge priority={task.priority} />
                </td>
                <td className="py-2.5">
                  {task.assignee ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar name={task.assignee.name} size="sm" />
                      <span className="truncate text-fg">{task.assignee.name}</span>
                    </span>
                  ) : (
                    <span className="text-fg-subtle">Unassigned</span>
                  )}
                </td>
                <td className="py-2.5">
                  <Due task={task} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul className="divide-y divide-border md:hidden">
        {tasks.map((task) => {
          const done = task.status === 'done';
          return (
            <li key={task.id} className="flex gap-3 px-4 py-3">
              <div className="pt-0.5">
                <DoneCheckbox task={task} busy={togglingId === task.id} onToggle={(e) => toggleDone(task, e)} />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <button
                  type="button"
                  onClick={() => onOpen(task)}
                  className={`block text-left font-medium ${done ? 'text-fg-subtle line-through' : 'text-fg'}`}
                >
                  {task.title}
                </button>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
                  <span className="font-mono text-fg-subtle">{task.key}</span>
                  <StatusBadge status={task.status} />
                  {task.priority !== 'medium' && task.priority !== 'low' && <PriorityBadge priority={task.priority} />}
                  {task.dueDate && <Due task={task} />}
                  {projectNames && <span className="text-fg-muted">{projectNames[task.projectId]}</span>}
                </div>
              </div>
              {task.assignee && <Avatar name={task.assignee.name} size="sm" label={task.assignee.name} className="mt-0.5" />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
