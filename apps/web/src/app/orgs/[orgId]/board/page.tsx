'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Search, Plus, RotateCw, MoreHorizontal, ArrowUp, ArrowDown, ArrowRight, CornerDownRight, Kanban } from 'lucide-react';
import {
  type TaskDTO,
  type TaskStatus,
  type TaskPriority,
  formatETag,
} from '@workspace/core';
import { PriorityBadge, StatusBadge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, EmptyState, ErrorState } from '@/components/ui/states';
import { useDismiss } from '@/components/ui/use-dismiss';
import { CreateTaskDialog } from '@/components/tasks/CreateTaskDialog';
import { TaskDetailDrawer } from '@/components/tasks/TaskDetailDrawer';
import { useShell } from '@/components/shell/shell-context';
import { dueLabel } from '@/lib/format';

type ColumnId = 'todo' | 'in_progress' | 'done';
type MoveDirection = 'up' | 'down' | 'to_todo' | 'to_in_progress' | 'to_done';

const COLUMNS: { id: ColumnId; status: TaskStatus; label: string; dotClass: string; move: MoveDirection }[] = [
  { id: 'todo', status: 'todo', label: 'To do', dotClass: 'bg-fg-subtle', move: 'to_todo' },
  { id: 'in_progress', status: 'in_progress', label: 'In progress', dotClass: 'bg-info', move: 'to_in_progress' },
  { id: 'done', status: 'done', label: 'Done', dotClass: 'bg-success', move: 'to_done' },
];

function CardMenu({
  task,
  columnId,
  onMove,
}: {
  task: TaskDTO;
  columnId: ColumnId;
  onMove: (task: TaskDTO, direction: MoveDirection) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);

  const move = (direction: MoveDirection) => {
    setOpen(false);
    onMove(task, direction);
  };

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Move ${task.key}`}
        className="btn btn-ghost btn-icon btn-sm -mr-1.5 -mt-1 h-7 w-7 opacity-100 focus-visible:opacity-100 group-hover:opacity-100 md:opacity-0"
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="menu right-0 top-full mt-1 w-48">
          <div className="menu-label">Reorder</div>
          <button type="button" role="menuitem" onClick={() => move('up')} className="menu-item">
            <ArrowUp aria-hidden="true" /> Move up
          </button>
          <button type="button" role="menuitem" onClick={() => move('down')} className="menu-item">
            <ArrowDown aria-hidden="true" /> Move down
          </button>
          <div className="menu-sep" />
          <div className="menu-label">Move to</div>
          {COLUMNS.filter((c) => c.id !== columnId).map((c) => (
            <button key={c.id} type="button" role="menuitem" onClick={() => move(c.move)} className="menu-item">
              <ArrowRight aria-hidden="true" /> {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function KanbanBoardPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { projects: shellProjects, refreshProjects } = useShell();

  const orgId = params?.orgId as string;
  const paramProjectId = params?.projectId as string | undefined;
  const projects = shellProjects ?? [];

  const [selectedProjectId, setSelectedProjectId] = useState<string>(paramProjectId || searchParams.get('projectId') || '');
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [sortBy, setSortBy] = useState<'manual' | 'due_date' | 'priority'>('manual');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createInitialStatus, setCreateInitialStatus] = useState<TaskStatus>('todo');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);

  // Org-level board: default to the first project once the list arrives.
  useEffect(() => {
    if (!paramProjectId && !selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0]!.id);
    }
  }, [paramProjectId, selectedProjectId, projects]);

  const activeProjectId = paramProjectId || selectedProjectId;

  const loadTasks = useCallback(async (isRefresh = false) => {
    if (!orgId || !activeProjectId) return;
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setLoadError(null);
      setConflictNotice(null);

      const res = await fetch(`/api/orgs/${orgId}/projects/${activeProjectId}/tasks`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "The board couldn't be loaded.");
      }

      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId, activeProjectId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return tasks.filter((t) => {
      // Top-level cards only; subtasks live in the task drawer.
      if (t.parentTaskId !== null) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.key.toLowerCase().includes(q) ||
        (t.labels && t.labels.some((l) => l.name.toLowerCase().includes(q)))
      );
    });
  }, [tasks, searchQuery]);

  const columnTasks = useMemo(() => {
    const map: Record<ColumnId, TaskDTO[]> = { todo: [], in_progress: [], done: [] };

    filteredTasks.forEach((t) => {
      if (t.status === 'in_progress') map.in_progress.push(t);
      else if (t.status === 'done') map.done.push(t);
      else map.todo.push(t); // 'todo' and 'blocked' share the To do column
    });

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
      // Manual order: case-sensitive ASCII lexical sort on rank, matching PostgreSQL COLLATE "C"
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

  // Optimistic move with rollback on conflict or failure.
  const executeMove = async (
    taskToMove: TaskDTO,
    destinationStatus: TaskStatus,
    prevTaskId: string | null,
    nextTaskId: string | null
  ) => {
    const previousTasks = [...tasks];

    setTasks((current) =>
      current.map((t) => (t.id === taskToMove.id ? { ...t, status: destinationStatus, version: t.version + 1 } : t))
    );

    try {
      const res = await fetch(`/api/orgs/${orgId}/tasks/${taskToMove.id}/move`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': formatETag(taskToMove.version),
        },
        body: JSON.stringify({ status: destinationStatus, prevTaskId, nextTaskId }),
      });

      if (res.status === 412) {
        // Concurrency conflict: someone else changed the task first.
        setTasks(previousTasks);
        setConflictNotice(`${taskToMove.key} was changed by someone else, so the board was reloaded. Try the move again.`);
        loadTasks(true);
        return;
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `${taskToMove.key} couldn't be moved.`);
      }

      const authoritativeTask: TaskDTO = await res.json();
      setTasks((current) => current.map((t) => (t.id === authoritativeTask.id ? authoritativeTask : t)));
      refreshProjects();
    } catch (err) {
      setTasks(previousTasks);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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
    const prevTaskId = targetTasks.length > 0 ? targetTasks[targetTasks.length - 1]!.id : null;

    setDraggedTaskId(null);
    await executeMove(taskToMove, targetStatus, prevTaskId, null);
  };

  const handleDropOnTask = async (e: React.DragEvent, targetTask: TaskDTO, targetColumnId: ColumnId) => {
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
    setDraggedTaskId(null);
    await executeMove(taskToMove, targetStatus, prevTaskId, targetTask.id);
  };

  // Keyboard / menu alternative to drag and drop.
  const handleKeyboardMove = async (task: TaskDTO, direction: MoveDirection) => {
    const currentColId: ColumnId = task.status === 'in_progress' ? 'in_progress' : task.status === 'done' ? 'done' : 'todo';
    const currentList = columnTasks[currentColId];
    const currentIndex = currentList.findIndex((t) => t.id === task.id);

    if (direction === 'up' && currentIndex > 0) {
      const prevIdx = currentIndex - 1;
      const prevTaskId = prevIdx > 0 ? currentList[prevIdx - 1]!.id : null;
      await executeMove(task, task.status, prevTaskId, currentList[prevIdx]!.id);
    } else if (direction === 'down' && currentIndex < currentList.length - 1) {
      const nextIdx = currentIndex + 1;
      const nextTaskId = nextIdx < currentList.length - 1 ? currentList[nextIdx + 1]!.id : null;
      await executeMove(task, task.status, currentList[nextIdx]!.id, nextTaskId);
    } else {
      const target = COLUMNS.find((c) => c.move === direction);
      if (target && target.id !== currentColId) {
        const targetList = columnTasks[target.id];
        const prevTaskId = targetList.length > 0 ? targetList[targetList.length - 1]!.id : null;
        await executeMove(task, target.status, prevTaskId, null);
      }
    }
  };

  const openCreate = (status: TaskStatus) => {
    setCreateInitialStatus(status);
    setIsCreateOpen(true);
  };

  const toolbar = (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative sm:w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
        <input
          type="search"
          placeholder="Filter cards"
          aria-label="Filter cards"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="field field-sm pl-9"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!paramProjectId && projects.length > 0 && (
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            aria-label="Project"
            className="field field-sm w-auto"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'manual' | 'due_date' | 'priority')}
          aria-label="Card order"
          className="field field-sm w-auto"
        >
          <option value="manual">Manual order</option>
          <option value="due_date">By due date</option>
          <option value="priority">By priority</option>
        </select>
        <button
          type="button"
          onClick={() => loadTasks(true)}
          disabled={refreshing}
          className="btn btn-secondary btn-icon btn-sm"
          aria-label="Reload board"
          title="Reload board"
        >
          <RotateCw className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>
      <button type="button" onClick={() => openCreate('todo')} className="btn btn-primary btn-sm sm:ml-auto">
        <Plus aria-hidden="true" />
        New task
      </button>
    </div>
  );

  if (!paramProjectId && shellProjects !== null && projects.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Board" />
        <EmptyState
          icon={Kanban}
          title="No projects yet"
          description="A board shows one project's tasks by status. Create a project to get started."
          action={{ label: 'Create a project', href: `/orgs/${orgId}/projects?new=1`, primary: true }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!paramProjectId && <PageHeader title="Board" description="Drag cards between columns, or use a card's menu to move it with the keyboard." />}

      {toolbar}

      {sortBy !== 'manual' && (
        <Alert tone="info" action={<button type="button" onClick={() => setSortBy('manual')} className="link shrink-0">Use manual order</button>}>
          Dragging is off while cards are sorted by {sortBy === 'due_date' ? 'due date' : 'priority'}.
        </Alert>
      )}
      {conflictNotice && <Alert tone="warning" onDismiss={() => setConflictNotice(null)}>{conflictNotice}</Alert>}
      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

      {loadError && tasks.length === 0 ? (
        <ErrorState title="Couldn't load the board" message={loadError} onRetry={() => loadTasks()} />
      ) : (
        <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 md:mx-0 md:grid md:snap-none md:grid-cols-3 md:overflow-visible md:px-0">
          {COLUMNS.map((col) => {
            const colTaskList = columnTasks[col.id];
            const isOverThisCol = dragOverColumn === col.id;

            return (
              <section
                key={col.id}
                aria-label={`${col.label}, ${colTaskList.length} tasks`}
                onDragOver={(e) => handleDragOverColumn(e, col.id)}
                onDrop={(e) => handleDropOnColumn(e, col.id)}
                className={`flex w-[82vw] max-w-sm shrink-0 snap-start flex-col rounded-xl border transition-colors md:w-auto md:max-w-none md:min-h-[28rem] ${
                  isOverThisCol ? 'border-accent bg-accent-subtle/50' : 'border-transparent bg-surface-2/70'
                }`}
              >
                <div className="flex items-center justify-between px-3 pb-2 pt-3">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
                    <span className={`h-2 w-2 rounded-full ${col.dotClass}`} aria-hidden="true" />
                    {col.label}
                    <span className="count">{colTaskList.length}</span>
                  </h2>
                  <button
                    type="button"
                    onClick={() => openCreate(col.status)}
                    className="btn btn-ghost btn-icon btn-sm h-7 w-7"
                    aria-label={`New task in ${col.label}`}
                  >
                    <Plus aria-hidden="true" />
                  </button>
                </div>

                <div className="flex-1 space-y-2 px-2 pb-2">
                  {loading && tasks.length === 0 ? (
                    <div className="space-y-2" aria-hidden="true">
                      <div className="card h-24 animate-pulse" />
                      <div className="card h-20 animate-pulse" />
                    </div>
                  ) : colTaskList.length === 0 ? (
                    <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border-strong px-4 text-center text-sm text-fg-subtle">
                      {searchQuery ? 'No matching cards' : 'No tasks. Drop a card here.'}
                    </div>
                  ) : (
                    colTaskList.map((task) => {
                      const isDraggingThis = draggedTaskId === task.id;
                      const isTargetOfDrag = dragOverTaskId === task.id;
                      const due = dueLabel(task.dueDate, task.status === 'done');

                      return (
                        <article
                          key={task.id}
                          draggable={sortBy === 'manual'}
                          onDragStart={(e) => handleDragStart(e, task)}
                          onDragEnd={() => {
                            setDraggedTaskId(null);
                            setDragOverColumn(null);
                            setDragOverTaskId(null);
                          }}
                          onDragOver={(e) => handleDragOverTask(e, task.id)}
                          onDrop={(e) => handleDropOnTask(e, task, col.id)}
                          onClick={() => {
                            setSelectedTaskId(task.id);
                            setIsDrawerOpen(true);
                          }}
                          className={`group cursor-pointer rounded-lg border bg-surface p-3 shadow-xs transition-colors ${
                            isDraggingThis
                              ? 'border-dashed border-accent opacity-40'
                              : isTargetOfDrag
                                ? 'border-accent'
                                : 'border-border hover:border-border-strong'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-mono text-xs text-fg-subtle">{task.key}</span>
                            <CardMenu task={task} columnId={col.id} onMove={handleKeyboardMove} />
                          </div>

                          <h3 className="mt-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTaskId(task.id);
                                setIsDrawerOpen(true);
                              }}
                              className="text-left text-sm font-medium leading-snug text-fg hover:underline"
                            >
                              {task.title}
                            </button>
                          </h3>

                          {task.labels && task.labels.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1">
                              {task.labels.slice(0, 3).map((l) => (
                                <span key={l.id} className="inline-flex items-center gap-1 text-xs text-fg-muted">
                                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} aria-hidden="true" />
                                  {l.name}
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                            {task.status === 'blocked' && <StatusBadge status="blocked" />}
                            {(task.priority === 'urgent' || task.priority === 'high') && <PriorityBadge priority={task.priority} />}
                            {due.text && (
                              <span className={`tabular-nums ${due.overdue ? 'font-medium text-danger' : 'text-fg-muted'}`}>{due.text}</span>
                            )}
                            {(task.subtaskCount ?? 0) > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-fg-muted" title={`${task.subtaskCount} subtasks`}>
                                <CornerDownRight className="h-3 w-3" aria-hidden="true" />
                                {task.subtaskCount}
                              </span>
                            )}
                            {task.assignee && <Avatar name={task.assignee.name} size="xs" label={task.assignee.name} className="ml-auto" />}
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

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
