'use client';

import React, { useState, useEffect } from 'react';
import { Drawer } from '@/components/ui/drawer';
import { StatusBadge, PriorityBadge } from '@/components/ui/badge';
import { CreateTaskDialog } from './CreateTaskDialog';
import {
  type TaskDTO,
  type TaskLabelDTO,
  type TaskStatus,
  type TaskPriority,
  formatRelativeDueDate,
  isDateOverdue,
  formatETag,
} from '@workspace/core';
import {
  Calendar,
  User,
  Tag,
  AlertTriangle,
  Archive,
  Plus,
  CheckCircle2,
  Save,
} from 'lucide-react';

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

export function TaskDetailDrawer({
  isOpen,
  onClose,
  orgId,
  taskId,
  onTaskUpdated,
  onTaskArchived,
}: TaskDetailDrawerProps) {
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

  // Load task details when opened
  useEffect(() => {
    if (isOpen && taskId) {
      setIsLoading(true);
      setConflictServerTask(null);
      setErrorMessage(null);
      setSuccessMessage(null);

      fetch(`/api/orgs/${orgId}/tasks/${taskId}`)
        .then(async (res) => {
          if (!res.ok) throw new Error('Failed to load task');
          return res.json();
        })
        .then((data: TaskDTO) => {
          setTask(data);
          setTitle(data.title);
          setDescription(data.description || '');
          setStatus(data.status);
          setPriority(data.priority);
          setAssigneeId(data.assigneeId || '');
          setDueDate(data.dueDate || '');
          setSelectedLabels(data.labels.map((l) => l.id));
        })
        .catch((err) => {
          setErrorMessage(err.message || 'Error loading task');
        })
        .finally(() => {
          setIsLoading(false);
        });

      // Fetch subtasks
      fetch(`/api/orgs/${orgId}/tasks/${taskId}/subtasks`)
        .then((res) => (res.ok ? res.json() : { subtasks: [] }))
        .then((data) => setSubtasks(data.subtasks || []))
        .catch(() => {});

      // Fetch members
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

      // Fetch labels
      fetch(`/api/orgs/${orgId}/labels`)
        .then((res) => (res.ok ? res.json() : { labels: [] }))
        .then((data) => {
          if (data.labels) setAvailableLabels(data.labels);
        })
        .catch(() => {});
    }
  }, [isOpen, taskId, orgId]);

  const handleSave = async (overrideVersion?: number) => {
    if (!task) return;
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
        // Optimistic concurrency conflict: preserve draft, show server version
        const serverState = data.currentEntity || (await fetch(`/api/orgs/${orgId}/tasks/${task.id}`).then((r) => r.json()));
        setConflictServerTask(serverState);
        setErrorMessage(
          `Conflict: This task was modified on the server (now version ${serverState.version}) while you were editing.`
        );
        return;
      }

      if (!res.ok) {
        throw new Error(data.detail || data.message || 'Failed to update task');
      }

      // Success
      setTask(data);
      setConflictServerTask(null);
      setSuccessMessage('Task saved successfully');
      onTaskUpdated(data);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error updating task');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResolveOverwrite = () => {
    if (conflictServerTask) {
      handleSave(conflictServerTask.version);
    }
  };

  const handleResolveDiscard = () => {
    if (conflictServerTask) {
      setTask(conflictServerTask);
      setTitle(conflictServerTask.title);
      setDescription(conflictServerTask.description || '');
      setStatus(conflictServerTask.status);
      setPriority(conflictServerTask.priority);
      setAssigneeId(conflictServerTask.assigneeId || '');
      setDueDate(conflictServerTask.dueDate || '');
      setSelectedLabels(conflictServerTask.labels.map((l) => l.id));
      setConflictServerTask(null);
      setErrorMessage(null);
      setSuccessMessage('Loaded server version');
      setTimeout(() => setSuccessMessage(null), 2000);
    }
  };

  const handleArchive = async () => {
    if (!task) return;
    if (!confirm(`Are you sure you want to archive task ${task.key}?`)) return;

    setIsArchiving(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/tasks/${task.id}`, {
        method: 'DELETE',
        headers: {
          'If-Match': formatETag(task.version),
        },
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to archive task');
      }

      if (onTaskArchived) onTaskArchived(task.id);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to archive task');
    } finally {
      setIsArchiving(false);
    }
  };

  const toggleLabel = (labelId: string) => {
    setSelectedLabels((prev) =>
      prev.includes(labelId) ? prev.filter((id) => id !== labelId) : [...prev, labelId]
    );
  };

  if (!isOpen) return null;

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title={task ? task.key : 'Task Details'}
        description={task ? `Version ${task.version} • Created ${new Date(task.createdAt).toLocaleDateString()}` : undefined}
        widthClass="max-w-2xl w-full"
      >
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-slate-400">Loading task...</div>
        ) : task ? (
          <div className="space-y-5 pb-8">
            {/* OCC Stale-Edit Conflict Banner */}
            {conflictServerTask && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 text-xs text-amber-200 space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-amber-300">Concurrent Modification Detected</p>
                    <p className="text-amber-200/90 mt-0.5">
                      Another team member modified this task while you were drafting changes (server is now at{' '}
                      <strong>version {conflictServerTask.version}</strong>, your base was{' '}
                      <strong>version {task.version}</strong>). Your edits have been preserved in this form.
                    </p>
                  </div>
                </div>

                <div className="bg-[#101319] rounded-lg p-2.5 border border-amber-500/20 text-slate-300 space-y-1">
                  <p className="font-medium text-slate-200">Server's latest title:</p>
                  <p className="italic">"{conflictServerTask.title}"</p>
                  <p className="text-[11px] text-slate-400">
                    Status: {conflictServerTask.status} • Assignee:{' '}
                    {conflictServerTask.assignee?.name || 'Unassigned'}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleResolveOverwrite}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-semibold text-xs hover:bg-amber-400 transition-colors"
                  >
                    Keep My Edits & Overwrite
                  </button>
                  <button
                    type="button"
                    onClick={handleResolveDiscard}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 text-xs hover:bg-slate-700 transition-colors"
                  >
                    Discard My Edits (Load Server)
                  </button>
                </div>
              </div>
            )}

            {/* General Status Banners */}
            {errorMessage && !conflictServerTask && (
              <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            {/* Task Key Header & Badges */}
            <div className="flex items-center justify-between pb-2 border-b border-[#222633]">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-[#d86dfc] px-2 py-0.5 rounded bg-[#d86dfc]/10 border border-[#d86dfc]/20">
                  {task.key}
                </span>
                <StatusBadge status={status as any} />
                <PriorityBadge priority={priority as any} />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSave()}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#d86dfc] text-[#0d0614] font-semibold text-xs hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleArchive}
                  disabled={isArchiving}
                  className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 transition-colors"
                  title="Archive Task"
                >
                  <Archive className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Title Editor */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg bg-[#101319] border border-[#222633] px-3 py-2 text-base font-medium text-slate-100 focus:outline-none focus:border-[#d86dfc]"
              />
            </div>

            {/* Description Editor */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add task description or acceptance criteria..."
                rows={4}
                className="w-full rounded-lg bg-[#101319] border border-[#222633] px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#d86dfc] resize-y"
              />
            </div>

            {/* Properties Grid */}
            <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-[#14171e] border border-[#222633]">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                  className="w-full rounded-lg bg-[#101319] border border-[#222633] px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#d86dfc]"
                >
                  <option value="todo">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  className="w-full rounded-lg bg-[#101319] border border-[#222633] px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#d86dfc]"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1">
                  <User className="w-3.5 h-3.5" />
                  <span>Assignee</span>
                </label>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="w-full rounded-lg bg-[#101319] border border-[#222633] px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#d86dfc]"
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
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Deadline</span>
                  </span>
                  {dueDate && (
                    <button
                      type="button"
                      onClick={() => setDueDate('')}
                      className="text-[10px] text-rose-400 hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full rounded-lg bg-[#101319] border border-[#222633] px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#d86dfc]"
                  />
                  {dueDate && (
                    <span
                      className={`text-[11px] whitespace-nowrap px-2 py-1 rounded font-medium border ${
                        isDateOverdue(dueDate)
                          ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}
                    >
                      {formatRelativeDueDate(dueDate)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Labels Section */}
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-2">
                <Tag className="w-3.5 h-3.5" />
                <span>Labels</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {availableLabels.map((l) => {
                  const isSelected = selectedLabels.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => toggleLabel(l.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-colors border ${
                        isSelected
                          ? 'bg-slate-700 text-white border-slate-500 font-medium'
                          : 'bg-[#101319] text-slate-400 border-[#222633] hover:border-slate-600'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
                      <span>{l.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Subtasks Section */}
            <div className="pt-2 border-t border-[#222633]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Subtasks ({subtasks.length})
                </span>
                {!task.parentTaskId && (
                  <button
                    type="button"
                    onClick={() => setIsAddSubtaskOpen(true)}
                    className="flex items-center gap-1 text-xs text-[#d86dfc] hover:underline"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Subtask</span>
                  </button>
                )}
              </div>

              {subtasks.length === 0 ? (
                <div className="rounded-lg bg-[#101319] border border-[#222633] p-4 text-center text-xs text-slate-500">
                  {task.parentTaskId ? 'This task is already a subtask.' : 'No subtasks yet. Break this task down into smaller units.'}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {subtasks.map((st) => (
                    <div
                      key={st.id}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-[#101319] border border-[#222633] hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <StatusBadge status={st.status as any} size="sm" />
                        <span className="font-mono text-xs text-slate-400">{st.key}</span>
                        <span className="text-sm text-slate-200">{st.title}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {st.dueDate && (
                          <span className="text-[11px] text-slate-400">{st.dueDate}</span>
                        )}
                        {st.assignee && (
                          <span className="text-[11px] text-slate-400">{st.assignee.name}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>

      {/* Add Subtask Dialog */}
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
