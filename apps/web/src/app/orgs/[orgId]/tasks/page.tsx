'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Plus, ListTodo, SearchX } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, SkeletonRows, Alert } from '@/components/ui/states';
import { CreateTaskDialog } from '@/components/tasks/CreateTaskDialog';
import { TaskDetailDrawer } from '@/components/tasks/TaskDetailDrawer';
import { TaskList, TaskFilters, filterTasks, isFiltering, EMPTY_TASK_FILTERS } from '@/components/tasks/TaskList';
import { useShell } from '@/components/shell/shell-context';
import { type TaskDTO } from '@workspace/core';

export default function TasksPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const { projects } = useShell();

  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filters, setFilters] = useState(EMPTY_TASK_FILTERS);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const loadTasks = useCallback(async () => {
    if (!orgId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/orgs/${orgId}/tasks`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Tasks couldn't be loaded.");
      }
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const projectOptions = (projects ?? []).map((p) => ({ id: p.id, name: p.name }));
  const projectNames = Object.fromEntries(projectOptions.map((p) => [p.id, p.name]));
  const visibleTasks = filterTasks(tasks, filters);
  const createInProject = filters.project !== 'all' ? filters.project : projectOptions[0]?.id;

  const handleTaskUpdated = (updatedTask: TaskDTO) => {
    setTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="All tasks"
        description="Every task you can see, across all projects."
        actions={
          createInProject && (
            <button type="button" onClick={() => setIsCreateOpen(true)} className="btn btn-primary">
              <Plus aria-hidden="true" />
              New task
            </button>
          )
        }
      />

      <div className="space-y-4">
        <TaskFilters value={filters} onChange={setFilters} projects={projectOptions} />

        {actionError && <Alert onDismiss={() => setActionError(null)}>{actionError}</Alert>}

        {loading && tasks.length === 0 ? (
          <SkeletonRows rows={8} />
        ) : error ? (
          <ErrorState title="Couldn't load tasks" message={error} onRetry={loadTasks} />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title="No tasks yet"
            description={
              createInProject
                ? 'Tasks from every project you can see will be listed here.'
                : 'Create a project first, then add its tasks.'
            }
            action={
              createInProject
                ? { label: 'New task', onClick: () => setIsCreateOpen(true), primary: true }
                : { label: 'Go to projects', href: `/orgs/${orgId}/projects`, primary: true }
            }
          />
        ) : visibleTasks.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No tasks match these filters"
            description="Try another project, status or priority, or clear the filters."
            action={{ label: 'Clear filters', onClick: () => setFilters(EMPTY_TASK_FILTERS) }}
            compact
          />
        ) : (
          <>
            <TaskList
              tasks={visibleTasks}
              orgId={orgId}
              projectNames={projectNames}
              onOpen={(task) => {
                setSelectedTaskId(task.id);
                setIsDrawerOpen(true);
              }}
              onTaskUpdated={handleTaskUpdated}
              onError={setActionError}
            />
            <p className="text-xs text-fg-muted">
              {isFiltering(filters) ? `${visibleTasks.length} of ${tasks.length} tasks` : `${tasks.length} tasks`}
            </p>
          </>
        )}
      </div>

      {createInProject && (
        <CreateTaskDialog
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          orgId={orgId}
          projectId={createInProject}
          projects={projectOptions}
          onTaskCreated={(newTask) => setTasks((prev) => [newTask, ...prev])}
        />
      )}

      <TaskDetailDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setSelectedTaskId(null);
        }}
        orgId={orgId}
        taskId={selectedTaskId}
        onTaskUpdated={handleTaskUpdated}
        onTaskArchived={(archivedId) => setTasks((prev) => prev.filter((t) => t.id !== archivedId))}
      />
    </div>
  );
}
