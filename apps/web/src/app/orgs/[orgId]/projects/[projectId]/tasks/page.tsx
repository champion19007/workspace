'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Plus, ListTodo, SearchX } from 'lucide-react';
import { EmptyState, ErrorState, SkeletonRows, Alert } from '@/components/ui/states';
import { CreateTaskDialog } from '@/components/tasks/CreateTaskDialog';
import { TaskDetailDrawer } from '@/components/tasks/TaskDetailDrawer';
import { TaskList, TaskFilters, filterTasks, isFiltering, EMPTY_TASK_FILTERS } from '@/components/tasks/TaskList';
import { readDeepLinkId } from '@/lib/deep-link';
import { type TaskDTO } from '@workspace/core';

export default function ProjectTasksPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const projectId = params?.projectId as string;

  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filters, setFilters] = useState(EMPTY_TASK_FILTERS);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const loadTasks = useCallback(async () => {
    if (!orgId || !projectId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/orgs/${orgId}/projects/${projectId}/tasks`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "This project's tasks couldn't be loaded.");
      }
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId, projectId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Deep link (?task=<id>) used by approved meeting suggestions.
  useEffect(() => {
    const linkedTaskId = readDeepLinkId(window.location.search, 'task');
    if (linkedTaskId) {
      setSelectedTaskId(linkedTaskId);
      setIsDrawerOpen(true);
    }
  }, []);

  const visibleTasks = filterTasks(tasks, filters);

  const handleTaskUpdated = (updatedTask: TaskDTO) => {
    setTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <TaskFilters value={filters} onChange={setFilters} />
        <button type="button" onClick={() => setIsCreateOpen(true)} className="btn btn-primary btn-sm self-start">
          <Plus aria-hidden="true" />
          New task
        </button>
      </div>

      {actionError && <Alert onDismiss={() => setActionError(null)}>{actionError}</Alert>}

      {loading && tasks.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : error ? (
        <ErrorState title="Couldn't load tasks" message={error} onRetry={loadTasks} />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="No tasks yet"
          description="Add the first task, or approve suggestions from this project's meetings in your Inbox."
          action={{ label: 'New task', onClick: () => setIsCreateOpen(true), primary: true }}
        />
      ) : visibleTasks.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No tasks match these filters"
          description="Try another status or priority, or clear the filters."
          action={{ label: 'Clear filters', onClick: () => setFilters(EMPTY_TASK_FILTERS) }}
          compact
        />
      ) : (
        <>
          <TaskList
            tasks={visibleTasks}
            orgId={orgId}
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

      <CreateTaskDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        orgId={orgId}
        projectId={projectId}
        onTaskCreated={(newTask) => setTasks((prev) => [newTask, ...prev])}
      />

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
