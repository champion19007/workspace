'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { RotateCw, CircleCheck, SearchX } from 'lucide-react';
import { type MyTaskItemDTO, type MyTasksCountsDTO, type MyTasksCategory } from '@workspace/core';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { TaskDetailDrawer } from '@/components/tasks/TaskDetailDrawer';
import { TaskFilters, TaskList, EMPTY_TASK_FILTERS, type TaskFilterState } from '@/components/tasks/TaskList';
import { useShell } from '@/components/shell/shell-context';

const CATEGORIES: { id: MyTasksCategory; label: string; count: keyof MyTasksCountsDTO }[] = [
  { id: 'all', label: 'All', count: 'all' },
  { id: 'pending', label: 'Open', count: 'pending' },
  { id: 'overdue', label: 'Overdue', count: 'overdue' },
  { id: 'due_today', label: 'Due today', count: 'dueToday' },
  { id: 'upcoming', label: 'Coming up', count: 'upcoming' },
];

const EMPTY_COPY: Record<MyTasksCategory, { title: string; description: string }> = {
  all: { title: 'Nothing assigned to you', description: 'When someone assigns you a task, or you approve a meeting suggestion for yourself, it lands here.' },
  pending: { title: 'No open tasks', description: 'Everything assigned to you is done. Nice work.' },
  overdue: { title: 'Nothing overdue', description: 'All your tasks with a due date are on time.' },
  due_today: { title: 'Nothing due today', description: 'Tasks due today will show up here.' },
  upcoming: { title: 'Nothing coming up', description: 'Tasks due in the next days will show up here.' },
};

export default function MyTasksPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const orgId = params?.orgId as string;
  const { projects } = useShell();

  const [activeCategory, setActiveCategory] = useState<MyTasksCategory>(
    (searchParams.get('category') as MyTasksCategory) || 'all'
  );
  const [filters, setFilters] = useState<TaskFilterState>({
    search: searchParams.get('q') || '',
    status: searchParams.get('status') || 'all',
    priority: searchParams.get('priority') || 'all',
    project: searchParams.get('project') || 'all',
  });
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);

  const [tasks, setTasks] = useState<MyTaskItemDTO[]>([]);
  const [counts, setCounts] = useState<MyTasksCountsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskProjectId, setSelectedTaskProjectId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Searching hits the server, so wait for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 250);
    return () => clearTimeout(t);
  }, [filters.search]);

  const loadMyTasks = useCallback(
    async (isRefresh = false) => {
      if (!orgId) return;
      try {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        setError(null);

        const qParams = new URLSearchParams();
        if (activeCategory !== 'all') qParams.set('category', activeCategory);
        if (filters.project !== 'all') qParams.set('projectId', filters.project);
        if (filters.status !== 'all') qParams.set('status', filters.status);
        if (filters.priority !== 'all') qParams.set('priority', filters.priority);
        if (debouncedSearch.trim()) qParams.set('search', debouncedSearch.trim());

        const res = await fetch(`/api/orgs/${orgId}/me/tasks?${qParams.toString()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || "Your tasks couldn't be loaded.");
        }

        const data = await res.json();
        setTasks(data.tasks || []);
        if (data.counts) setCounts(data.counts);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orgId, activeCategory, filters.project, filters.status, filters.priority, debouncedSearch]
  );

  useEffect(() => {
    loadMyTasks();
  }, [loadMyTasks]);

  const filtering = filters.search !== '' || filters.status !== 'all' || filters.priority !== 'all' || filters.project !== 'all';
  const projectNames = Object.fromEntries(tasks.map((t) => [t.projectId, t.projectName]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="My tasks"
        description="Everything assigned to you, across all projects."
        actions={
          <button
            type="button"
            onClick={() => loadMyTasks(true)}
            disabled={refreshing}
            className="btn btn-secondary btn-icon"
            aria-label="Reload tasks"
            title="Reload tasks"
          >
            <RotateCw className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        }
      />

      <div className="space-y-4">
        <div className="segmented" role="group" aria-label="Show">
          {CATEGORIES.map((c) => {
            const n = counts?.[c.count];
            return (
              <button key={c.id} type="button" aria-pressed={activeCategory === c.id} onClick={() => setActiveCategory(c.id)}>
                {c.label}
                {n !== undefined && (
                  <span className={`count ${c.id === 'overdue' && n > 0 ? 'bg-danger-subtle text-danger' : ''}`}>{n}</span>
                )}
              </button>
            );
          })}
        </div>

        <TaskFilters value={filters} onChange={setFilters} projects={(projects ?? []).map((p) => ({ id: p.id, name: p.name }))} />

        {actionError && <Alert onDismiss={() => setActionError(null)}>{actionError}</Alert>}

        {loading && tasks.length === 0 ? (
          <SkeletonRows rows={6} />
        ) : error && tasks.length === 0 ? (
          <ErrorState title="Couldn't load your tasks" message={error} onRetry={() => loadMyTasks()} />
        ) : tasks.length === 0 ? (
          filtering ? (
            <EmptyState
              icon={SearchX}
              title="No tasks match these filters"
              description="Try another project, status or priority, or clear the filters."
              action={{ label: 'Clear filters', onClick: () => setFilters(EMPTY_TASK_FILTERS) }}
              compact
            />
          ) : (
            <EmptyState
              icon={CircleCheck}
              title={EMPTY_COPY[activeCategory].title}
              description={EMPTY_COPY[activeCategory].description}
              action={activeCategory === 'all' ? { label: 'Browse all tasks', href: `/orgs/${orgId}/tasks` } : undefined}
            />
          )
        ) : (
          <TaskList
            tasks={tasks}
            orgId={orgId}
            projectNames={projectNames}
            onOpen={(task) => {
              setSelectedTaskId(task.id);
              setSelectedTaskProjectId(task.projectId);
              setIsDrawerOpen(true);
            }}
            onTaskUpdated={(updated) => {
              setTasks((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
              // Counts per category depend on status and due date: refresh them.
              loadMyTasks(true);
            }}
            onError={setActionError}
          />
        )}
      </div>

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
            setTasks((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
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
