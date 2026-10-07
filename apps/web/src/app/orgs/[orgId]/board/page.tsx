'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  Search,
  Plus,
  RotateCw,
  MoreHorizontal,
  ChevronDown,
  Calendar,
  AlertCircle,
  CheckSquare,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  SlidersHorizontal,
} from 'lucide-react';
import {
  type TaskDTO,
  type TaskStatus,
  type TaskPriority,
  formatRelativeDueDate,
  isDateOverdue,
  formatETag,
} from '@workspace/core';
import { PriorityBadge } from '@/components/ui/badge';
import { CreateTaskDialog } from '@/components/tasks/CreateTaskDialog';
import { TaskDetailDrawer } from '@/components/tasks/TaskDetailDrawer';

interface ProjectOption {
  id: string;
  name: string;
  keyPrefix?: string | null;
  visibility?: 'public' | 'private';
}

type ColumnId = 'todo' | 'in_progress' | 'done';

const COLUMNS: { id: ColumnId; status: TaskStatus; label: string; dotClass: string }[] = [
  {
    id: 'todo',
    status: 'todo',
    label: 'To Do',
    dotClass: 'bg-accent shadow-[0_0_8px_var(--accent,#d86dfc)]',
  },
  {
    id: 'in_progress',
    status: 'in_progress',
    label: 'In Progress',
    dotClass: 'bg-amber-400 shadow-[0_0_8px_#fbbf24]',
  },
  {
    id: 'done',
    status: 'done',
    label: 'Completed',
    dotClass: 'bg-emerald-400 shadow-[0_0_8px_#34d399]',
  },
];

export default function KanbanBoardPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const orgId = params?.orgId as string;
  const paramProjectId = params?.projectId as string | undefined;

  // Projects & Active Project
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(paramProjectId || '');
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [sortBy, setSortBy] = useState<'manual' | 'due_date' | 'priority'>('manual');

  // Modals & Drawers
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createInitialStatus, setCreateInitialStatus] = useState<TaskStatus>('todo');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Drag and Drop state
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);

  // Active card menu
  const [cardMenuTaskId, setCardMenuTaskId] = useState<string | null>(null);

  // 1. Fetch Projects
  useEffect(() => {
    if (!orgId) return;
    fetch(`/api/orgs/${orgId}/projects`)
      .then((res) => (res.ok ? res.json() : { projects: [] }))
      .then((data) => {
        const prjs: ProjectOption[] = data.projects || [];
        setProjects(prjs);
        if (!paramProjectId && prjs.length > 0 && !selectedProjectId) {
          setSelectedProjectId(prjs[0]!.id);
        }
      })
      .catch(() => {});
  }, [orgId, paramProjectId, selectedProjectId]);

  const activeProjectId = paramProjectId || selectedProjectId;

  // 2. Fetch Tasks for active project
  const loadTasks = useCallback(async (isRefresh = false) => {
    if (!orgId || !activeProjectId) return;
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      setConflictNotice(null);

      const res = await fetch(`/api/orgs/${orgId}/projects/${activeProjectId}/tasks`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to load project tasks');
      }

      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId, activeProjectId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Filter tasks to top-level cards and search query
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // Top-level only on project board (subtasks displayed inside parent or detail drawer)
      if (t.parentTaskId !== null) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        t.title.toLowerCase().includes(q) ||
        t.key.toLowerCase().includes(q) ||
        (t.labels && t.labels.some((l) => l.name.toLowerCase().includes(q)))
      );
    });
  }, [tasks, searchQuery]);

  // Tasks grouped by column
  const columnTasks = useMemo(() => {
    const map: Record<ColumnId, TaskDTO[]> = {
      todo: [],
      in_progress: [],
      done: [],
    };

    filteredTasks.forEach((t) => {
      if (t.status === 'in_progress') map.in_progress.push(t);
      else if (t.status === 'done') map.done.push(t);
      else map.todo.push(t); // 'todo' and 'blocked' appear under To Do by default
    });

    // Apply sorting
    if (sortBy === 'due_date') {
      Object.keys(map).forEach((col) => {
        map[col as ColumnId].sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate.localeCompare(b.dueDate);
        });
      });
    } else if (sortBy === 'priority') {
      const priorityOrder: Record<TaskPriority, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
      Object.keys(map).forEach((col) => {
        map[col as ColumnId].sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
      });
    } else {
      // Default: case-sensitive ASCII lexical sort on rank matching PostgreSQL COLLATE "C"
      Object.keys(map).forEach((col) => {
        map[col as ColumnId].sort((a, b) => {
          if (a.rank < b.rank) return -1;
          if (a.rank > b.rank) return 1;
          return a.id.localeCompare(b.id);
        });
      });
    }

    return map;
  }, [filteredTasks, sortBy]);

  // Total active top-level count
  const totalActiveTasks = filteredTasks.length;

  // Move task execution with Optimistic update and rollback on conflict
  const executeMove = async (
    taskToMove: TaskDTO,
    destinationStatus: TaskStatus,
    prevTaskId: string | null,
    nextTaskId: string | null
  ) => {
    // Preserve snapshot for rollback
    const previousTasks = [...tasks];

    // Optimistic Update: calculate provisional rank and update local state
    setTasks((current) => {
      return current.map((t) => {
        if (t.id === taskToMove.id) {
          return {
            ...t,
            status: destinationStatus,
            // Bump provisional version
            version: t.version + 1,
          };
        }
        return t;
      });
    });

    try {
      const res = await fetch(`/api/orgs/${orgId}/tasks/${taskToMove.id}/move`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': formatETag(taskToMove.version),
        },
        body: JSON.stringify({
          status: destinationStatus,
          prevTaskId,
          nextTaskId,
        }),
      });

      if (res.status === 412) {
        // Concurrency conflict: loser receives 412 Precondition Failed
        setTasks(previousTasks);
        setConflictNotice('Another user modified this task. The board has been refreshed with authoritative data.');
        loadTasks(true);
        return;
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to move task');
      }

      const authoritativeTask: TaskDTO = await res.json();

      // Apply authoritative version and rank from server
      setTasks((current) =>
        current.map((t) => (t.id === authoritativeTask.id ? authoritativeTask : t))
      );
    } catch (err) {
      // Rollback to prior position on rejection/network failure
      setTasks(previousTasks);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, task: TaskDTO) => {
    if (sortBy !== 'manual') return;
    setDraggedTaskId(task.id);
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverColumn = (e: React.DragEvent, colId: ColumnId) => {
    if (sortBy !== 'manual') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(colId);
  };

  const handleDragOverTask = (e: React.DragEvent, taskId: string) => {
    if (sortBy !== 'manual') return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverTaskId(taskId);
  };

  const handleDropOnColumn = async (e: React.DragEvent, targetColumnId: ColumnId) => {
    e.preventDefault();
    setDragOverColumn(null);
    setDragOverTaskId(null);

    if (!draggedTaskId || sortBy !== 'manual') return;

    const taskToMove = tasks.find((t) => t.id === draggedTaskId);
    if (!taskToMove) return;

    const targetStatus = COLUMNS.find((c) => c.id === targetColumnId)?.status || 'todo';
    const targetTasks = columnTasks[targetColumnId].filter((t) => t.id !== taskToMove.id);

    // If dropping on empty column or end of column
    const prevTaskId = targetTasks.length > 0 ? targetTasks[targetTasks.length - 1]!.id : null;
    const nextTaskId = null;

    setDraggedTaskId(null);
    await executeMove(taskToMove, targetStatus, prevTaskId, nextTaskId);
  };

  const handleDropOnTask = async (
    e: React.DragEvent,
    targetTask: TaskDTO,
    targetColumnId: ColumnId
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverColumn(null);
    setDragOverTaskId(null);

    if (!draggedTaskId || sortBy !== 'manual') return;
    if (draggedTaskId === targetTask.id) return;

    const taskToMove = tasks.find((t) => t.id === draggedTaskId);
    if (!taskToMove) return;

    const targetStatus = COLUMNS.find((c) => c.id === targetColumnId)?.status || 'todo';
    const currentColumnList = columnTasks[targetColumnId].filter((t) => t.id !== taskToMove.id);
    const targetIdx = currentColumnList.findIndex((t) => t.id === targetTask.id);

    if (targetIdx === -1) return;

    // Place before targetTask
    const prevTaskId = targetIdx > 0 ? currentColumnList[targetIdx - 1]!.id : null;
    const nextTaskId = targetTask.id;

    setDraggedTaskId(null);
    await executeMove(taskToMove, targetStatus, prevTaskId, nextTaskId);
  };

  // Keyboard / Menu Reordering (Accessibility)
  const handleKeyboardMove = async (
    task: TaskDTO,
    direction: 'up' | 'down' | 'to_todo' | 'to_in_progress' | 'to_done'
  ) => {
    const currentColId: ColumnId =
      task.status === 'in_progress' ? 'in_progress' : task.status === 'done' ? 'done' : 'todo';
    const currentList = columnTasks[currentColId];
    const currentIndex = currentList.findIndex((t) => t.id === task.id);

    if (direction === 'up' && currentIndex > 0) {
      const prevIdx = currentIndex - 1;
      const prevTaskId = prevIdx > 0 ? currentList[prevIdx - 1]!.id : null;
      const nextTaskId = currentList[prevIdx]!.id;
      await executeMove(task, task.status, prevTaskId, nextTaskId);
    } else if (direction === 'down' && currentIndex < currentList.length - 1) {
      const nextIdx = currentIndex + 1;
      const prevTaskId = currentList[nextIdx]!.id;
      const nextTaskId = nextIdx < currentList.length - 1 ? currentList[nextIdx + 1]!.id : null;
      await executeMove(task, task.status, prevTaskId, nextTaskId);
    } else if (direction === 'to_todo' && currentColId !== 'todo') {
      const targetList = columnTasks.todo;
      const prevTaskId = targetList.length > 0 ? targetList[targetList.length - 1]!.id : null;
      await executeMove(task, 'todo', prevTaskId, null);
    } else if (direction === 'to_in_progress' && currentColId !== 'in_progress') {
      const targetList = columnTasks.in_progress;
      const prevTaskId = targetList.length > 0 ? targetList[targetList.length - 1]!.id : null;
      await executeMove(task, 'in_progress', prevTaskId, null);
    } else if (direction === 'to_done' && currentColId !== 'done') {
      const targetList = columnTasks.done;
      const prevTaskId = targetList.length > 0 ? targetList[targetList.length - 1]!.id : null;
      await executeMove(task, 'done', prevTaskId, null);
    }

    setCardMenuTaskId(null);
  };

  const handleOpenAdd = (status: TaskStatus) => {
    setCreateInitialStatus(status);
    setIsCreateOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Subheader Row matching Screenshot 929 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#222633] pb-4">
        {/* Left: Project selector & Board Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-zinc-100">Board</span>
            <span className="text-xs text-zinc-400 bg-[#14171e] px-2.5 py-1 rounded-full border border-[#222633]">
              {totalActiveTasks} active tasks across 3 columns
            </span>
          </div>

          {!paramProjectId && projects.length > 0 && (
            <div className="relative">
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="bg-[#14171e] text-zinc-200 border border-[#222633] rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none focus:border-accent appearance-none pr-8 cursor-pointer"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}
        </div>

        {/* Right: Search board, Sort & Refresh */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search board..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#101319] text-zinc-200 border border-[#222633] rounded-full pl-9 pr-4 py-1.5 text-xs focus:outline-none focus:border-accent w-48 sm:w-64 transition-colors placeholder:text-zinc-500"
            />
          </div>

          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'manual' | 'due_date' | 'priority')}
              className="bg-[#14171e] text-zinc-300 border border-[#222633] rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:border-accent appearance-none pr-7 cursor-pointer"
              title="Sort board cards"
            >
              <option value="manual">Manual Board Order</option>
              <option value="due_date">Sort by Due Date</option>
              <option value="priority">Sort by Priority</option>
            </select>
            <SlidersHorizontal className="w-3 h-3 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <button
            onClick={() => loadTasks(true)}
            disabled={refreshing}
            className="p-1.5 bg-[#14171e] hover:bg-[#1c202a] border border-[#222633] text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh board"
          >
            <RotateCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-accent' : ''}`} />
          </button>
        </div>
      </div>

      {/* Non-manual sort warning banner */}
      {sortBy !== 'manual' && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2 text-xs text-amber-300 flex items-center justify-between">
          <span>
            Dragging is disabled while sorted by <strong>{sortBy === 'due_date' ? 'Due Date' : 'Priority'}</strong>.
            Switch to <strong>Manual Board Order</strong> to drag and reorder cards.
          </span>
          <button
            onClick={() => setSortBy('manual')}
            className="text-amber-200 underline font-semibold ml-2 hover:text-white"
          >
            Reset to Manual Order
          </button>
        </div>
      )}

      {/* Concurrency Conflict Banner */}
      {conflictNotice && (
        <div className="bg-purple-950/40 border border-purple-500/40 rounded-lg p-3 text-xs text-purple-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-accent shrink-0" />
            <span>{conflictNotice}</span>
          </div>
          <button
            onClick={() => setConflictNotice(null)}
            className="text-zinc-400 hover:text-white text-xs ml-3"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-zinc-400 hover:text-white text-xs">
            Dismiss
          </button>
        </div>
      )}

      {/* 2. Three Columns Grid Container (Responsive horizontal scroll on narrow screens) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const colTaskList = columnTasks[col.id];
          const isOverThisCol = dragOverColumn === col.id;

          return (
            <div
              key={col.id}
              onDragOver={(e) => handleDragOverColumn(e, col.id)}
              onDrop={(e) => handleDropOnColumn(e, col.id)}
              className={`flex flex-col rounded-xl border bg-[#0f1117] transition-all min-h-[520px] ${
                isOverThisCol ? 'border-accent/60 shadow-[0_0_15px_rgba(216,109,252,0.15)]' : 'border-[#222633]'
              }`}
            >
              {/* Column Header matching Screenshot 929 */}
              <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#222633]/60 bg-[#14171e]/50 rounded-t-xl">
                <div className="flex items-center gap-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${col.dotClass}`} />
                  <span className="text-sm font-bold text-zinc-100">{col.label}</span>
                  <span className="text-xs font-semibold text-zinc-400 bg-[#1c202a] px-2 py-0.5 rounded-full border border-[#262a38]">
                    {colTaskList.length}
                  </span>
                </div>
              </div>

              {/* Tasks List */}
              <div className="flex-1 p-3 space-y-3 overflow-y-auto max-h-[calc(100vh-280px)]">
                {loading && tasks.length === 0 ? (
                  <div className="space-y-3">
                    <div className="h-28 rounded-lg bg-[#14171e]/50 border border-[#222633] animate-pulse" />
                    <div className="h-28 rounded-lg bg-[#14171e]/30 border border-[#222633] animate-pulse" />
                  </div>
                ) : colTaskList.length === 0 ? (
                  <div className="h-44 border border-dashed border-[#222633] rounded-lg flex flex-col items-center justify-center text-center p-4">
                    <p className="text-xs text-zinc-500">
                      {searchQuery ? 'No matching tasks' : `No tasks in ${col.label}`}
                    </p>
                    <p className="text-[11px] text-zinc-600 mt-1">
                      {searchQuery ? 'Try adjusting your search' : 'Drop cards here or click Add Task'}
                    </p>
                  </div>
                ) : (
                  colTaskList.map((task) => {
                    const isDraggingThis = draggedTaskId === task.id;
                    const isTargetOfDrag = dragOverTaskId === task.id;
                    const overdue = isDateOverdue(task.dueDate) && task.status !== 'done';

                    return (
                      <div
                        key={task.id}
                        draggable={sortBy === 'manual'}
                        onDragStart={(e) => handleDragStart(e, task)}
                        onDragOver={(e) => handleDragOverTask(e, task.id)}
                        onDrop={(e) => handleDropOnTask(e, task, col.id)}
                        onClick={() => {
                          setSelectedTaskId(task.id);
                          setIsDrawerOpen(true);
                        }}
                        className={`group relative p-3.5 rounded-lg border bg-[#14171e] hover:bg-[#171b24] cursor-pointer transition-all ${
                          isDraggingThis
                            ? 'opacity-30 border-dashed border-accent'
                            : isTargetOfDrag
                            ? 'border-accent shadow-[0_0_10px_rgba(216,109,252,0.25)]'
                            : 'border-[#222633] hover:border-zinc-700'
                        }`}
                      >
                        {/* Top: Key & Quick Actions Menu */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-mono font-bold text-accent tracking-wide">
                            {task.key}
                          </span>

                          <div
                            className="relative"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() =>
                                setCardMenuTaskId(cardMenuTaskId === task.id ? null : task.id)
                              }
                              className="p-1 text-zinc-500 hover:text-zinc-200 rounded hover:bg-[#222633] transition-colors"
                              title="Task actions & keyboard move"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>

                            {/* Accessible Keyboard Move Popover Menu */}
                            {cardMenuTaskId === task.id && (
                              <div
                                className="absolute right-0 top-6 w-44 bg-[#181c25] border border-[#2a2f40] rounded-lg shadow-xl z-30 p-1 space-y-0.5 text-xs text-zinc-200"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="px-2 py-1 text-[10px] uppercase font-semibold text-zinc-500 border-b border-[#222633]">
                                  Keyboard Reorder
                                </div>
                                <button
                                  onClick={() => handleKeyboardMove(task, 'up')}
                                  className="w-full text-left px-2 py-1.5 hover:bg-[#222633] rounded flex items-center gap-1.5"
                                >
                                  <ArrowUp className="w-3 h-3 text-zinc-400" /> Move Up
                                </button>
                                <button
                                  onClick={() => handleKeyboardMove(task, 'down')}
                                  className="w-full text-left px-2 py-1.5 hover:bg-[#222633] rounded flex items-center gap-1.5"
                                >
                                  <ArrowDown className="w-3 h-3 text-zinc-400" /> Move Down
                                </button>
                                <div className="border-t border-[#222633] my-1" />
                                <div className="px-2 py-1 text-[10px] uppercase font-semibold text-zinc-500">
                                  Change Status
                                </div>
                                {col.id !== 'todo' && (
                                  <button
                                    onClick={() => handleKeyboardMove(task, 'to_todo')}
                                    className="w-full text-left px-2 py-1.5 hover:bg-[#222633] rounded flex items-center gap-1.5"
                                  >
                                    <ArrowRight className="w-3 h-3 text-accent" /> To Do
                                  </button>
                                )}
                                {col.id !== 'in_progress' && (
                                  <button
                                    onClick={() => handleKeyboardMove(task, 'to_in_progress')}
                                    className="w-full text-left px-2 py-1.5 hover:bg-[#222633] rounded flex items-center gap-1.5"
                                  >
                                    <ArrowRight className="w-3 h-3 text-amber-400" /> In Progress
                                  </button>
                                )}
                                {col.id !== 'done' && (
                                  <button
                                    onClick={() => handleKeyboardMove(task, 'to_done')}
                                    className="w-full text-left px-2 py-1.5 hover:bg-[#222633] rounded flex items-center gap-1.5"
                                  >
                                    <ArrowRight className="w-3 h-3 text-emerald-400" /> Completed
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Title */}
                        <h4 className="text-sm font-medium text-zinc-100 line-clamp-2 mb-3 leading-snug">
                          {task.title}
                        </h4>

                        {/* Metadata strip: Priority, Deadline, Subtasks, Assignee */}
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <PriorityBadge priority={task.priority} />

                          {task.dueDate && (
                            <span
                              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                                overdue
                                  ? 'bg-red-500/10 border-red-500/30 text-red-400 font-semibold'
                                  : 'bg-[#1a1e28] border-[#222633] text-zinc-300'
                              }`}
                              title={`Deadline: ${task.dueDate}`}
                            >
                              <Calendar className="w-3 h-3" />
                              {formatRelativeDueDate(task.dueDate)}
                            </span>
                          )}

                          {task.subtaskCount !== undefined && task.subtaskCount > 0 && (
                            <span
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-[#1a1e28] border border-[#222633] text-zinc-400"
                              title={`${task.subtaskCount} subtask(s)`}
                            >
                              <CheckSquare className="w-3 h-3 text-zinc-500" />
                              {task.subtaskCount}
                            </span>
                          )}

                          {task.labels && task.labels.length > 0 && (
                            <div className="flex items-center gap-1">
                              {task.labels.slice(0, 2).map((l) => (
                                <span
                                  key={l.id}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-medium border"
                                  style={{
                                    backgroundColor: `${l.color}15`,
                                    borderColor: `${l.color}40`,
                                    color: l.color,
                                  }}
                                >
                                  {l.name}
                                </span>
                              ))}
                              {task.labels.length > 2 && (
                                <span className="text-[10px] text-zinc-500">
                                  +{task.labels.length - 2}
                                </span>
                              )}
                            </div>
                          )}

                          {task.assignee && (
                            <div
                              className="ml-auto w-5 h-5 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-[10px] font-bold text-accent"
                              title={`Assignee: ${task.assignee.name}`}
                            >
                              {task.assignee.name.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Bottom: Add Task button matching Screenshot 929 */}
              <div className="p-3 border-t border-[#222633]/50">
                <button
                  onClick={() => handleOpenAdd(col.status)}
                  className="w-full py-2 px-3 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1e28] rounded-lg transition-colors flex items-center justify-center gap-1.5 border border-dashed border-[#222633] hover:border-zinc-600"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Task
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Task Dialog */}
      {isCreateOpen && activeProjectId && (
        <CreateTaskDialog
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          orgId={orgId}
          projectId={activeProjectId}
          initialStatus={createInitialStatus}
          onTaskCreated={(newTask) => {
            setTasks((prev) => [...prev, newTask]);
            setIsCreateOpen(false);
          }}
        />
      )}

      {/* Task Detail Drawer */}
      {isDrawerOpen && selectedTaskId && activeProjectId && (
        <TaskDetailDrawer
          isOpen={isDrawerOpen}
          onClose={() => {
            setIsDrawerOpen(false);
            setSelectedTaskId(null);
          }}
          orgId={orgId}
          projectId={activeProjectId}
          taskId={selectedTaskId}
          onTaskUpdated={(updated) => {
            setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
          }}
          onTaskArchived={(archivedId) => {
            setTasks((prev) => prev.filter((t) => t.id !== archivedId));
            setIsDrawerOpen(false);
            setSelectedTaskId(null);
          }}
        />
      )}
    </div>
  );
}
