'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Search,
  RotateCw,
  X,
  ChevronDown,
  Calendar,
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Folder,
  CornerDownRight,
} from 'lucide-react';
import {
  type MyTaskItemDTO,
  type MyTasksCountsDTO,
  type MyTasksCategory,
  type TaskStatus,
  formatRelativeDueDate,
  isDateOverdue,
  formatETag,
} from '@workspace/core';
import { PriorityBadge } from '@/components/ui/badge';
import { TableShell, EmptyState } from '@/components/ui/table-shell';
import { TaskDetailDrawer } from '@/components/tasks/TaskDetailDrawer';

interface ProjectOption {
  id: string;
  name: string;
  keyPrefix?: string | null;
}

export default function MyTasksPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const orgId = params?.orgId as string;

  // Filter States
  const [activeCategory, setActiveCategory] = useState<MyTasksCategory>(
    (searchParams.get('category') as MyTasksCategory) || 'all'
  );
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [selectedProject, setSelectedProject] = useState(searchParams.get('project') || 'all');
  const [selectedStatus, setSelectedStatus] = useState(searchParams.get('status') || 'all');
  const [selectedPriority, setSelectedPriority] = useState(searchParams.get('priority') || 'all');

  // Data States
  const [tasks, setTasks] = useState<MyTaskItemDTO[]>([]);
  const [counts, setCounts] = useState<MyTasksCountsDTO>({
    all: 0,
    pending: 0,
    overdue: 0,
    dueToday: 0,
    upcoming: 0,
  });
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drawer & Inline state
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskProjectId, setSelectedTaskProjectId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);

  // Fetch projects list for filter dropdown
  useEffect(() => {
    if (!orgId) return;
    fetch(`/api/orgs/${orgId}/projects`)
      .then((res) => (res.ok ? res.json() : { projects: [] }))
      .then((data) => setProjects(data.projects || []))
      .catch(() => {});
  }, [orgId]);

  // Load My Tasks
  const loadMyTasks = useCallback(
    async (isRefresh = false) => {
      if (!orgId) return;
      try {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        setError(null);

        const qParams = new URLSearchParams();
        if (activeCategory !== 'all') qParams.set('category', activeCategory);
        if (selectedProject !== 'all') qParams.set('projectId', selectedProject);
        if (selectedStatus !== 'all') qParams.set('status', selectedStatus);
        if (selectedPriority !== 'all') qParams.set('priority', selectedPriority);
        if (searchQuery.trim()) qParams.set('search', searchQuery.trim());

        const res = await fetch(`/api/orgs/${orgId}/me/tasks?${qParams.toString()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Failed to load assigned tasks');
        }

        const data = await res.json();
        setTasks(data.tasks || []);
        if (data.counts) {
          setCounts(data.counts);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orgId, activeCategory, selectedProject, selectedStatus, selectedPriority, searchQuery]
  );

  useEffect(() => {
    loadMyTasks();
  }, [loadMyTasks]);

  // Reset Filters handler
  const handleResetFilters = () => {
    setActiveCategory('all');
    setSearchQuery('');
    setSelectedProject('all');
    setSelectedStatus('all');
    setSelectedPriority('all');
  };

  const hasActiveFilters =
    activeCategory !== 'all' ||
    searchQuery.trim() !== '' ||
    selectedProject !== 'all' ||
    selectedStatus !== 'all' ||
    selectedPriority !== 'all';

  // Inline Status Toggle with Strong ETag
  const handleToggleStatus = async (task: MyTaskItemDTO, e: React.MouseEvent) => {
    e.stopPropagation();
    if (togglingTaskId) return;

    const newStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done';
    setTogglingTaskId(task.id);

    try {
      const res = await fetch(`/api/orgs/${orgId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': formatETag(task.version),
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to update task status');
      }

      const updated = await res.json();
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, ...updated, status: newStatus } : t))
      );
      // Reload counts
      loadMyTasks(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingTaskId(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header Navigation matching Screenshot 938 */}
      <div className="flex flex-col gap-2">
        <Link
          href={`/orgs/${orgId}`}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Dashboard
        </Link>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span className="bg-gradient-to-r from-accent to-purple-400 bg-clip-text text-transparent">
                My Tasks
              </span>
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              View and manage tasks across all projects in your organization
            </p>
          </div>

          <button
            onClick={() => loadMyTasks(true)}
            disabled={refreshing}
            className="p-2 bg-[#14171e] hover:bg-[#1c202a] border border-[#222633] text-zinc-300 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh tasks"
          >
            <RotateCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-accent' : ''}`} />
          </button>
        </div>
      </div>

      {/* 2. Filter Toolbar matching Screenshot 938 */}
      <div className="bg-[#14171e] border border-[#222633] rounded-xl p-3 flex flex-wrap items-center gap-3">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#101319] text-zinc-200 border border-[#222633] rounded-lg pl-9 pr-3 py-1.5 text-xs focus:outline-none focus:border-accent placeholder:text-zinc-500"
          />
        </div>

        {/* Project Select */}
        <div className="relative">
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="bg-[#101319] text-zinc-300 border border-[#222633] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-accent appearance-none pr-8 cursor-pointer"
          >
            <option value="all">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Status Select */}
        <div className="relative">
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="bg-[#101319] text-zinc-300 border border-[#222633] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-accent appearance-none pr-8 cursor-pointer"
          >
            <option value="all">All Statuses</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Completed</option>
            <option value="blocked">Blocked</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Priority Select */}
        <div className="relative">
          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            className="bg-[#101319] text-zinc-300 border border-[#222633] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-accent appearance-none pr-8 cursor-pointer"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Reset Filters */}
        {hasActiveFilters && (
          <button
            onClick={handleResetFilters}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-[#101319] hover:bg-[#1a1e28] border border-[#222633] rounded-lg transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Reset Filters
          </button>
        )}
      </div>

      {/* 3. Category Filter Chips matching Screenshot 938 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setActiveCategory('all')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
            activeCategory === 'all'
              ? 'bg-accent text-[#0d0614] shadow-sm'
              : 'bg-[#14171e] text-zinc-300 border border-[#222633] hover:bg-[#1a1e28]'
          }`}
        >
          My Tasks
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              activeCategory === 'all' ? 'bg-[#0d0614]/20 text-[#0d0614]' : 'bg-[#1c202a] text-zinc-400'
            }`}
          >
            {counts.all}
          </span>
        </button>

        <button
          onClick={() => setActiveCategory('pending')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
            activeCategory === 'pending'
              ? 'bg-accent text-[#0d0614] shadow-sm'
              : 'bg-[#14171e] text-zinc-300 border border-[#222633] hover:bg-[#1a1e28]'
          }`}
        >
          Pending
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              activeCategory === 'pending' ? 'bg-[#0d0614]/20 text-[#0d0614]' : 'bg-[#1c202a] text-zinc-400'
            }`}
          >
            {counts.pending}
          </span>
        </button>

        <button
          onClick={() => setActiveCategory('overdue')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
            activeCategory === 'overdue'
              ? 'bg-red-500 text-white shadow-sm'
              : 'bg-[#14171e] text-red-400 border border-red-500/30 hover:bg-red-500/10'
          }`}
        >
          <AlertCircle className="w-3 h-3" />
          Overdue
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              activeCategory === 'overdue' ? 'bg-white/20 text-white' : 'bg-red-500/20 text-red-300'
            }`}
          >
            {counts.overdue}
          </span>
        </button>

        <button
          onClick={() => setActiveCategory('due_today')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
            activeCategory === 'due_today'
              ? 'bg-accent text-[#0d0614] shadow-sm'
              : 'bg-[#14171e] text-zinc-300 border border-[#222633] hover:bg-[#1a1e28]'
          }`}
        >
          Due Today
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              activeCategory === 'due_today' ? 'bg-[#0d0614]/20 text-[#0d0614]' : 'bg-[#1c202a] text-zinc-400'
            }`}
          >
            {counts.dueToday}
          </span>
        </button>

        <button
          onClick={() => setActiveCategory('upcoming')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
            activeCategory === 'upcoming'
              ? 'bg-accent text-[#0d0614] shadow-sm'
              : 'bg-[#14171e] text-zinc-300 border border-[#222633] hover:bg-[#1a1e28]'
          }`}
        >
          Upcoming
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              activeCategory === 'upcoming' ? 'bg-[#0d0614]/20 text-[#0d0614]' : 'bg-[#1c202a] text-zinc-400'
            }`}
          >
            {counts.upcoming}
          </span>
        </button>
      </div>

      {/* Error alert */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-zinc-400 hover:text-white text-xs">
            Dismiss
          </button>
        </div>
      )}

      {/* 4. Table Shell matching Screenshot 938 / 928 */}
      <TableShell>
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-[#222633] bg-[#101319] text-zinc-400 font-semibold uppercase text-[11px] tracking-wider">
              <th className="py-3 px-4 w-12 text-center">Status</th>
              <th className="py-3 px-4">Task</th>
              <th className="py-3 px-4">Project</th>
              <th className="py-3 px-4">Priority</th>
              <th className="py-3 px-4">Due Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#222633]/60">
            {loading && tasks.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-zinc-500">
                  <div className="flex items-center justify-center gap-2">
                    <RotateCw className="w-4 h-4 animate-spin text-accent" />
                    <span>Loading assigned tasks...</span>
                  </div>
                </td>
              </tr>
            ) : tasks.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12">
                  <EmptyState
                    icon={CheckCircle2}
                    title="No tasks found"
                    description={
                      hasActiveFilters
                        ? 'Try adjusting your filters or search criteria.'
                        : 'You currently have no tasks assigned to you.'
                    }
                  />
                </td>
              </tr>
            ) : (
              tasks.map((task) => {
                const overdue = isDateOverdue(task.dueDate) && task.status !== 'done';
                const isSubtask = task.parentTaskId !== null;

                return (
                  <tr
                    key={task.id}
                    onClick={() => {
                      setSelectedTaskId(task.id);
                      setSelectedTaskProjectId(task.projectId);
                      setIsDrawerOpen(true);
                    }}
                    className="hover:bg-[#14171e] transition-colors cursor-pointer group"
                  >
                    {/* Status Toggle Checkbox */}
                    <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => handleToggleStatus(task, e)}
                        disabled={togglingTaskId === task.id}
                        className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                          task.status === 'done'
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : 'border-zinc-600 hover:border-accent text-transparent'
                        }`}
                        title={task.status === 'done' ? 'Mark incomplete' : 'Mark done'}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </td>

                    {/* Task Title & Key */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-bold text-accent">
                            {task.key}
                          </span>
                          <span
                            className={`font-medium ${
                              task.status === 'done'
                                ? 'line-through text-zinc-500'
                                : 'text-zinc-100 group-hover:text-white'
                            }`}
                          >
                            {task.title}
                          </span>
                        </div>

                        {/* If subtask, show parent context */}
                        {isSubtask && task.parentKey && (
                          <div className="flex items-center gap-1 text-[11px] text-zinc-500 mt-0.5">
                            <CornerDownRight className="w-3 h-3 text-zinc-600" />
                            <span>Subtask of</span>
                            <span className="text-zinc-400 font-mono">{task.parentKey}</span>
                            {task.parentTitle && (
                              <span className="truncate max-w-[200px]">({task.parentTitle})</span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Project */}
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] bg-[#1c202a] text-zinc-300 border border-[#262a38]">
                        <Folder className="w-3 h-3 text-zinc-500" />
                        {task.projectName}
                      </span>
                    </td>

                    {/* Priority */}
                    <td className="py-3 px-4">
                      <PriorityBadge priority={task.priority} />
                    </td>

                    {/* Due Date with Asia/Kolkata Urgency badge */}
                    <td className="py-3 px-4">
                      {task.dueDate ? (
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border ${
                            overdue
                              ? 'bg-red-500/10 border-red-500/30 text-red-400 font-semibold'
                              : 'bg-[#14171e] border-[#222633] text-zinc-300'
                          }`}
                        >
                          <Calendar className="w-3 h-3" />
                          {formatRelativeDueDate(task.dueDate)}
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </TableShell>

      {/* Task Detail Drawer */}
      {isDrawerOpen && selectedTaskId && selectedTaskProjectId && (
        <TaskDetailDrawer
          isOpen={isDrawerOpen}
          onClose={() => {
            setIsDrawerOpen(false);
            setSelectedTaskId(null);
            setSelectedTaskProjectId(null);
          }}
          orgId={orgId}
          projectId={selectedTaskProjectId}
          taskId={selectedTaskId}
          onTaskUpdated={(updated) => {
            setTasks((prev) =>
              prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t))
            );
          }}
          onTaskArchived={(archivedId) => {
            setTasks((prev) => prev.filter((t) => t.id !== archivedId));
            setIsDrawerOpen(false);
            setSelectedTaskId(null);
            setSelectedTaskProjectId(null);
          }}
        />
      )}
    </div>
  );
}
