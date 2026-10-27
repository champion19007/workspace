'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getKolkataTodayDateString, type TaskDTO } from '@workspace/core';
import { TaskDetailDrawer } from '@/components/tasks/TaskDetailDrawer';
import { ErrorState } from '@/components/ui/states';
import { formatShortDate } from '@/lib/format';
import { addDays, daysBetween, useProjectTasks, weekStart } from '@/components/tasks/use-project-tasks';

const DAY_PX = 28;
const WEEKS = 8;
const DAYS = WEEKS * 7;
const LABEL_PX = 224;

function barClass(t: TaskDTO, today: string): string {
  if (t.status === 'done') return 'border-success/40 bg-success-subtle text-success';
  if (t.status === 'blocked' || (t.dueDate && t.dueDate < today)) return 'border-danger/40 bg-danger-subtle text-danger';
  if (t.status === 'in_progress') return 'border-info/40 bg-info-subtle text-info';
  return 'border-border-strong bg-surface-3 text-fg';
}

/** Eight weeks of the project: each task drawn from its start date to its due date. */
export default function ProjectTimelinePage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const projectId = params?.projectId as string;
  const today = getKolkataTodayDateString();
  const [start, setStart] = useState(() => addDays(weekStart(today), -7));
  const { tasks, error, load, openTaskId, setOpenTaskId, onTaskUpdated, onTaskArchived } = useProjectTasks(orgId, projectId);
  // Dates are written in the viewer's locale, which the server doesn't know: render them in the browser only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const end = addDays(start, DAYS - 1);
  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(start, i * 7));
  const scheduled = (tasks ?? [])
    .filter((t) => t.startDate || t.dueDate)
    .map((t) => ({ t, from: t.startDate ?? t.dueDate!, to: t.dueDate ?? t.startDate! }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const visible = scheduled.filter(({ from, to }) => to >= start && from <= end);
  const outside = scheduled.length - visible.length;
  const unscheduled = (tasks ?? []).filter((t) => !t.startDate && !t.dueDate && t.status !== 'done');
  const todayOffset = daysBetween(start, today);

  if (!mounted) return <div className="skeleton h-96 w-full" />;
  if (error) return <ErrorState title="Couldn't load the timeline" message={error} onRetry={load} />;

  return (
    <section aria-labelledby="timeline-range" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="timeline-range" className="text-base font-semibold text-fg" aria-live="polite">
          {formatShortDate(start)} – {formatShortDate(end)}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setStart(addDays(start, -28))} aria-label="Earlier weeks" className="btn btn-ghost btn-icon">
            <ChevronLeft aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setStart(addDays(weekStart(today), -7))} className="btn btn-secondary btn-sm">
            Today
          </button>
          <button type="button" onClick={() => setStart(addDays(start, 28))} aria-label="Later weeks" className="btn btn-ghost btn-icon">
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="relative" style={{ width: LABEL_PX + DAYS * DAY_PX }}>
          <div className="flex border-b border-border bg-surface-2 text-xs font-medium text-fg-muted">
            <div className="sticky left-0 z-10 shrink-0 bg-surface-2 px-3 py-2" style={{ width: LABEL_PX }}>
              Task
            </div>
            {weeks.map((w) => (
              <div key={w} className="shrink-0 border-l border-border px-2 py-2" style={{ width: 7 * DAY_PX }}>
                Week of {formatShortDate(w)}
              </div>
            ))}
          </div>

          {tasks === null ? (
            <div className="skeleton m-3 h-40" />
          ) : visible.length === 0 ? (
            <p className="sticky left-0 px-3 py-10 text-sm text-fg-muted" style={{ width: 'min(100%, 36rem)' }}>
              Nothing is planned in these weeks. Give tasks a start or due date to see them here.
            </p>
          ) : (
            <ul>
              {visible.map(({ t, from, to }) => {
                const left = Math.max(0, daysBetween(start, from));
                const right = Math.min(DAYS - 1, daysBetween(start, to));
                const range = from === to ? formatShortDate(from) : `${formatShortDate(from)} – ${formatShortDate(to)}`;
                return (
                  <li key={t.id} className="flex border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setOpenTaskId(t.id)}
                      className="sticky left-0 z-10 shrink-0 truncate bg-surface px-3 py-2.5 text-left text-sm text-fg hover:underline"
                      style={{ width: LABEL_PX }}
                    >
                      {t.title}
                    </button>
                    <div className="relative h-10 shrink-0" style={{ width: DAYS * DAY_PX }}>
                      {weeks.map((w, i) => (
                        <span key={w} className="absolute inset-y-0 border-l border-border" style={{ left: i * 7 * DAY_PX }} aria-hidden="true" />
                      ))}
                      <button
                        type="button"
                        onClick={() => setOpenTaskId(t.id)}
                        title={`${t.title}: ${range}`}
                        aria-label={`${t.title}, ${range}`}
                        className={`absolute top-2 h-6 truncate rounded-md border px-2 text-left text-xs font-medium ${barClass(t, today)}`}
                        style={{ left: left * DAY_PX + 2, width: (right - left + 1) * DAY_PX - 4 }}
                      >
                        {range}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {todayOffset >= 0 && todayOffset < DAYS && (
            <span
              className="pointer-events-none absolute bottom-0 top-[33px] w-0.5 bg-accent"
              style={{ left: LABEL_PX + todayOffset * DAY_PX + DAY_PX / 2 }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      {outside > 0 && (
        <p className="text-sm text-fg-muted">
          {outside} more {outside === 1 ? 'task is' : 'tasks are'} planned outside these weeks.
        </p>
      )}

      {unscheduled.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-fg">
            Not scheduled yet <span className="font-normal text-fg-muted">{unscheduled.length}</span>
          </h3>
          <p className="text-sm text-fg-muted">Open a task and give it a start or due date to put it on the timeline.</p>
          <ul className="flex flex-wrap gap-2">
            {unscheduled.slice(0, 24).map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setOpenTaskId(t.id)} className="btn btn-secondary btn-sm max-w-xs">
                  <span className="truncate">{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
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
