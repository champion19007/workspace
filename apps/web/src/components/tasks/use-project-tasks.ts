'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TaskDTO } from '@workspace/core';

/** A project's tasks, plus the task open in the detail drawer, for the Calendar and Timeline views. */
export function useProjectTasks(orgId: string, projectId: string) {
  const [tasks, setTasks] = useState<TaskDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/projects/${projectId}/tasks`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Tasks couldn't be loaded.");
      setTasks(body.tasks);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [orgId, projectId]);

  useEffect(() => {
    if (orgId && projectId) load();
  }, [orgId, projectId, load]);

  const onTaskUpdated = (updated: TaskDTO) =>
    setTasks((prev) => prev?.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)) ?? null);
  const onTaskArchived = (id: string) => setTasks((prev) => prev?.filter((t) => t.id !== id) ?? null);

  return { tasks, error, load, openTaskId, setOpenTaskId, onTaskUpdated, onTaskArchived };
}

/** Calendar-date arithmetic on YYYY-MM-DD strings, in UTC so no time zone shifts a day. */
export const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => isoOf(new Date(dayOf(iso).getTime() + n * 86_400_000));
export const daysBetween = (from: string, to: string) => Math.round((dayOf(to).getTime() - dayOf(from).getTime()) / 86_400_000);
/** The Monday on or before `iso`. */
export const weekStart = (iso: string) => addDays(iso, -((dayOf(iso).getUTCDay() + 6) % 7));
