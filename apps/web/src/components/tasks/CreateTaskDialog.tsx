'use client';

import React, { useState, useEffect } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { type TaskDTO, type TaskLabelDTO, type TaskStatus, type TaskPriority } from '@workspace/core';
import { Calendar, User, Tag, AlertCircle } from 'lucide-react';

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
  parentTaskId,
  parentTaskTitle,
  initialStatus = 'todo',
  onTaskCreated,
}: CreateTaskDialogProps) {
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
  }, [isOpen, orgId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Task title is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const endpoint = parentTaskId
        ? `/api/orgs/${orgId}/tasks/${parentTaskId}/subtasks`
        : `/api/orgs/${orgId}/projects/${projectId}/tasks`;

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
        throw new Error(data.detail || data.message || 'Failed to create task');
      }

      onTaskCreated(data);
      onClose();
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
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
      title={parentTaskId ? `Add Subtask to "${parentTaskTitle || 'Parent Task'}"` : 'Create New Task'}
      description="Create a task with title, assignee, deadline, and labels."
      maxWidthClass="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Task Title <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Implement user authentication flow"
            className="w-full rounded-lg bg-[#101319] border border-[#222633] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#d86dfc]"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add relevant context, acceptance criteria or links..."
            rows={3}
            className="w-full rounded-lg bg-[#101319] border border-[#222633] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#d86dfc] resize-y"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className="w-full rounded-lg bg-[#101319] border border-[#222633] px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-[#d86dfc]"
            >
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="w-full rounded-lg bg-[#101319] border border-[#222633] px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-[#d86dfc]"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span>Assignee</span>
            </label>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full rounded-lg bg-[#101319] border border-[#222633] px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-[#d86dfc]"
            >
              <option value="">Unassigned</option>
              {availableMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.email})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center justify-between text-xs font-medium text-slate-300 mb-1">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
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
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-lg bg-[#101319] border border-[#222633] px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-[#d86dfc]"
            />
          </div>
        </div>

        {availableLabels.length > 0 && (
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1.5">
              <Tag className="w-3.5 h-3.5 text-slate-400" />
              <span>Labels</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {availableLabels.map((l) => {
                const isSelected = selectedLabels.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggleLabel(l.id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-colors border ${
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
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-[#222633]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 rounded-lg bg-[#d86dfc] text-[#0d0614] font-semibold text-sm hover:opacity-95 transition-opacity disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : parentTaskId ? 'Add Subtask' : 'Create Task'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
