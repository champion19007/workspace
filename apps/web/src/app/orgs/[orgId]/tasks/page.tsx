'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Search,
  Plus,
  CheckSquare,
  Calendar,
  Check,
  AlertCircle,
  CornerDownRight,
} from 'lucide-react';
import { TableShell, EmptyState } from '@/components/ui/table-shell';
import {
  StatusBadge,
  PriorityBadge,
  TaskStatus,
} from '@/components/ui/badge';
import { CreateTaskDialog } from '@/components/tasks/CreateTaskDialog';
import { TaskDetailDrawer } from '@/components/tasks/TaskDetailDrawer';
import {
  type TaskDTO,
  formatRelativeDueDate,
  isDateOverdue,
  formatETag,
} from '@workspace/core';

interface ProjectOption {
  id: string;
  name: string;
}

export default function TasksPage() {
  const params = useParams();
  const orgId = params?.orgId as string;

  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  // Modals & Drawers
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedProjectIdForCreate, setSelectedProjectIdForCreate] = useState<string>('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Toggling status loading
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);

  // 1. Fetch projects and tasks
  const loadData = useCallback(async () => {
    if (!orgId) return;

    try {
      setLoading(true);
      setError(null);

      // Load projects for project dropdown
      fetch(`/api/orgs/${orgId}/projects?limit=100`)
        .then((res) => (res.ok ? res.json() : { projects: [] }))
        .then((data) => {
          if (data.projects) {
            const list = data.projects.map((p: any) => ({ id: p.id, name: p.name }));
            setProjects(list);
            if (list.length > 0 && !selectedProjectIdForCreate) {
              setSelectedProjectIdForCreate(list[0].id);
            }
          }
        })
        .catch(() => {});

      // Load tasks
      const projQuery = projectFilter !== 'all' ? `?projectId=${projectFilter}` : '';
      const res = await fetch(`/api/orgs/${orgId}/tasks${projQuery}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to load organization tasks');
      }

      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId, projectFilter, selectedProjectIdForCreate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 2. Filter tasks
  const filteredTasks = tasks.filter((task) => {
    const matchesSearch =
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (task.assignee?.name || '').toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;
    const matchesProject = projectFilter === 'all' || task.projectId === projectFilter;

    return matchesSearch && matchesStatus && matchesPriority && matchesProject;
  });

  // 3. Toggle task status
  const handleToggleStatus = async (task: TaskDTO, e: React.MouseEvent) => {
    e.stopPropagation();
    if (togglingTaskId === task.id) return;

    setTogglingTaskId(task.id);
    const nextStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done';

    try {
      const res = await fetch(`/api/orgs/${orgId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': formatETag(task.version),
        },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to update task status');
      }

      const updated = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (err: any) {
      alert(`Could not toggle status: ${err.message}`);
    } finally {
      setTogglingTaskId(null);
    }
  };

  const handleOpenDetail = (task: TaskDTO) => {
    setSelectedTaskId(task.id);
    setIsDrawerOpen(true);
  };

  const handleTaskCreated = (newTask: TaskDTO) => {
    setTasks((prev) => [newTask, ...prev]);
  };

  const handleTaskUpdated = (updatedTask: TaskDTO) => {
    setTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)));
  };

  const handleTaskArchived = (archivedId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== archivedId));
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Header & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
            Organization Tasks
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            System of record tasks across all accessible projects, protected with atomic concurrency.
          </p>
        </div>

        {projects.length > 0 && (
          <button
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs shadow-md hover:opacity-90 transition-opacity self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Add Task</span>
          </button>
        )}
      </div>

      {/* Toolbar Matching Screenshot 928 */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-3 rounded-xl bg-panel border border-border-subtle">
        {/* Search Input */}
        <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-inset border border-border-subtle text-xs text-foreground">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks by title, key, or assignee..."
            className="w-full bg-transparent focus:outline-none placeholder:text-muted-foreground text-xs"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {projects.length > 0 && (
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              aria-label="Filter by project"
              className="rounded-lg bg-panel-inset border border-border-subtle px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="rounded-lg bg-panel-inset border border-border-subtle px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="all">All Statuses</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
            <option value="blocked">Blocked</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            aria-label="Filter by priority"
            className="rounded-lg bg-panel-inset border border-border-subtle px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tasks Table Shell */}
      {loading ? (
        <div className="p-12 text-center text-xs text-muted-foreground bg-panel rounded-2xl border border-border-subtle">
          Loading tasks...
        </div>
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks found"
          description={
            searchQuery || statusFilter !== 'all' || priorityFilter !== 'all' || projectFilter !== 'all'
              ? 'Try adjusting your filters or search query.'
              : 'There are no active tasks in this organization.'
          }
          action={
            projects.length > 0
              ? {
                  label: '+ Add Task',
                  onClick: () => setIsCreateOpen(true),
                }
              : undefined
          }
        />
      ) : (
        <TableShell>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-panel-inset border-b border-border-subtle text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">
                <th className="py-3 px-4 w-10">Done</th>
                <th className="py-3 px-4">Task Key & Title</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Assignee</th>
                <th className="py-3 px-4">Deadline (IST)</th>
                <th className="py-3 px-4 text-right">Subtasks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/60">
              {filteredTasks.map((task) => {
                const isOverdue = task.dueDate ? isDateOverdue(task.dueDate) : false;
                const relativeDue = task.dueDate ? formatRelativeDueDate(task.dueDate) : null;
                const isCompleted = task.status === 'done';

                return (
                  <tr
                    key={task.id}
                    onClick={() => handleOpenDetail(task)}
                    className="hover:bg-panel-elevated/50 transition-colors group cursor-pointer"
                  >
                    {/* Done Checkbox */}
                    <td className="py-3 px-4">
                      <button
                        onClick={(e) => handleToggleStatus(task, e)}
                        aria-label={`Toggle task ${task.key} completion`}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                          isCompleted
                            ? 'bg-accent border-accent text-accent-foreground'
                            : 'border-border-strong hover:border-accent text-transparent'
                        }`}
                      >
                        <Check className="w-3 h-3 stroke-[3]" />
                      </button>
                    </td>

                    {/* Key & Title */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded bg-panel-inset text-accent border border-border-subtle">
                            {task.key}
                          </span>
                          <span
                            className={`font-medium transition-all ${
                              isCompleted
                                ? 'line-through text-muted-foreground'
                                : 'text-foreground group-hover:text-accent'
                            }`}
                          >
                            {task.title}
                          </span>
                        </div>

                        {/* Labels row */}
                        {task.labels && task.labels.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {task.labels.map((l) => (
                              <span
                                key={l.id}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-panel-inset border border-border-subtle text-slate-300"
                              >
                                <span
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: l.color }}
                                />
                                {l.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4">
                      <StatusBadge status={task.status} size="sm" />
                    </td>

                    {/* Priority */}
                    <td className="py-3 px-4">
                      <PriorityBadge priority={task.priority} size="sm" />
                    </td>

                    {/* Assignee */}
                    <td className="py-3 px-4">
                      {task.assignee ? (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <div className="w-5 h-5 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-[10px] font-bold text-accent uppercase">
                            {task.assignee.name.charAt(0)}
                          </div>
                          <span className="truncate max-w-[120px] text-foreground">
                            {task.assignee.name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/60 italic text-[11px]">
                          Unassigned
                        </span>
                      )}
                    </td>

                    {/* Deadline */}
                    <td className="py-3 px-4 text-muted-foreground font-mono text-[11px]">
                      {task.dueDate ? (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            <span className={isOverdue && !isCompleted ? 'text-rose-400 font-bold' : ''}>
                              {task.dueDate}
                            </span>
                          </div>
                          {relativeDue && !isCompleted && (
                            <span
                              className={`text-[10px] ${
                                isOverdue ? 'text-rose-400 font-semibold' : 'text-slate-400'
                              }`}
                            >
                              {relativeDue}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>

                    {/* Subtasks Count */}
                    <td className="py-3 px-4 text-right">
                      {(task.subtaskCount ?? 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-panel-inset border border-border-subtle text-slate-300">
                          <CornerDownRight className="w-3 h-3 text-accent" />
                          <span>{task.subtaskCount}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30 text-[10px]">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      )}

      {/* Create Task Dialog */}
      {selectedProjectIdForCreate && (
        <CreateTaskDialog
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          orgId={orgId}
          projectId={selectedProjectIdForCreate}
          onTaskCreated={handleTaskCreated}
        />
      )}

      {/* Task Details Drawer */}
      <TaskDetailDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setSelectedTaskId(null);
        }}
        orgId={orgId}
        taskId={selectedTaskId}
        onTaskUpdated={handleTaskUpdated}
        onTaskArchived={handleTaskArchived}
      />
    </div>
  );
}
