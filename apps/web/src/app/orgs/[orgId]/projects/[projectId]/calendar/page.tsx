'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getKolkataTodayDateString, type TaskDTO } from '@workspace/core';
import { TaskDetailDrawer } from '@/components/tasks/TaskDetailDrawer';
import { ErrorState } from '@/components/ui/states';
import { addDays, dayOf, useProjectTasks, weekStart } from '@/components/tasks/use-project-tasks';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATUS_DOT: Record<TaskDTO['status'], string> = {
  todo: 'bg-fg-subtle',
  in_progress: 'bg-info',
  blocked: 'bg-danger',
  done: 'bg-success',
};

/** A month of the project's tasks, each on its due date. */
export default function ProjectCalendarPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const projectId = params?.projectId as string;
  const today = getKolkataTodayDateString();
  const [month, setMonth] = useState(today.slice(0, 7));
  const { tasks, error, load, openTaskId, setOpenTaskId, onTaskUpdated, onTaskArchived } = useProjectTasks(orgId, projectId);
  // Dates are written in the viewer's locale, which the server doesn't know: render them in the browser only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const first = `${month}-01`;
  const gridStart = weekStart(first);
  // Five or six rows of weeks, as many as the month needs.
  const weeks = addDays(gridStart, 35).startsWith(month) ? 6 : 5;
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));

  const byDay = useMemo(() => {
    const map = new Map<string, TaskDTO[]>();
    for (const t of tasks ?? []) if (t.dueDate) map.set(t.dueDate, [...(map.get(t.dueDate) ?? []), t]);
    return map;
  }, [tasks]);
  const undated = (tasks ?? []).filter((t) => !t.dueDate && t.status !== 'done').length;

  const shiftMonth = (n: number) => {
    const d = dayOf(first);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dayOf(first));

  if (!mounted) return <div className="skeleton h-96 w-full" />;
  if (error) return <ErrorState title="Couldn't load the calendar" message={error} onRetry={load} />;

  return (
    <section aria-labelledby="calendar-month" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="calendar-month" className="text-base font-semibold text-fg" aria-live="polite">
          {monthLabel}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="btn btn-ghost btn-icon">
            <ChevronLeft aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setMonth(today.slice(0, 7))} className="btn btn-secondary btn-sm">
            Today
          </button>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className="btn btn-ghost btn-icon">
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-xs font-medium text-fg-muted" aria-hidden="true">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1.5">
              {d}
            </div>
          ))}
        </div>
        {tasks === null ? (
          <div className="skeleton m-3 h-80" />
        ) : (
          <ol className="grid grid-cols-7">
            {days.map((day) => {
              const inMonth = day.startsWith(month);
              const dayTasks = byDay.get(day) ?? [];
              return (
                <li key={day} className={`min-h-24 min-w-0 border-b border-r border-border p-1 sm:p-1.5 ${inMonth ? '' : 'bg-surface-2'}`}>
                  <time
                    dateTime={day}
                    aria-current={day === today ? 'date' : undefined}
                    className={`mb-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs ${
                      day === today ? 'bg-accent font-semibold text-accent-fg' : inMonth ? 'text-fg-muted' : 'text-fg-subtle'
                    }`}
                  >
                    {Number(day.slice(8))}
                  </time>
                  <ul className="space-y-0.5">
                    {dayTasks.slice(0, 3).map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => setOpenTaskId(t.id)}
                          className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-surface-3 ${
                            t.status === 'done' ? 'text-fg-subtle line-through' : day < today ? 'text-danger' : 'text-fg'
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[t.status]}`} aria-hidden="true" />
                          <span className="truncate">{t.title}</span>
                        </button>
                      </li>
                    ))}
                    {dayTasks.length > 3 && <li className="px-1 text-xs text-fg-muted">+{dayTasks.length - 3} more</li>}
                  </ul>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {undated > 0 && (
        <p className="text-sm text-fg-muted">
          {undated} open {undated === 1 ? 'task has' : 'tasks have'} no due date, so {undated === 1 ? "it isn't" : "they aren't"}{' '}
          on the calendar.
        </p>
      )}

      <TaskDetailDrawer
        isOpen={openTaskId !== null}
        onClose={() => setOpenTaskId(null)}
        orgId={orgId}
        taskId={openTaskId}
        onTaskUpdated={onTaskUpdated}
        onTaskArchived={onTaskArchived}
      />
    </section>
  );
}
