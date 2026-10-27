'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CircleCheck, FolderKanban } from 'lucide-react';
import { type LeadershipSummaryDTO, type NodeRollupDTO } from '@workspace/core';
import { Badge, HealthBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, SkeletonCards } from '@/components/ui/states';
import { useShell } from '@/components/shell/shell-context';
import { dueLabel } from '@/lib/format';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One sentence on where a project stands, for people who don't follow the task list. */
function statusSentence(r: NodeRollupDTO): string {
  if (r.health === 'no_tasks') return "Work hasn't been planned yet.";
  if (r.tasks.total > 0 && r.tasks.completed === r.tasks.total) return 'All planned work is finished.';
  const stuck = r.tasks.blocked > 0 ? ` ${plural(r.tasks.blocked, 'task is', 'tasks are')} stuck waiting on something.` : '';
  if (r.health === 'at_risk') return `${plural(r.overdueCount, 'task is', 'tasks are')} past the due date.${stuck}`;
  if (r.health === 'needs_attention') return `${plural(r.dueSoonCount, 'task is', 'tasks are')} due in the next few days.${stuck}`;
  const active = r.tasks.inProgress > 0 ? ` ${plural(r.tasks.inProgress, 'task is', 'tasks are')} being worked on now.` : '';
  return `Everything is on schedule.${active}${stuck}`;
}

/** The view Executives and Clients are kept to: how each project is going, in plain words. */
export default function ProgressPage() {
  const { orgId, user } = useShell();
  const [data, setData] = useState<LeadershipSummaryDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/leadership`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Progress couldn't be loaded.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [orgId]);

  useEffect(() => {
    if (orgId) load();
  }, [orgId, load]);

  const projects = data?.projects ?? [];
  const totalTasks = projects.reduce((n, p) => n + p.rollup.tasks.total, 0);
  const doneTasks = projects.reduce((n, p) => n + p.rollup.tasks.completed, 0);
  const count = (health: string) => projects.filter((p) => p.rollup.health === health).length;
  const summary = [
    count('on_track') && `${count('on_track')} on track`,
    count('needs_attention') && `${count('needs_attention')} ${count('needs_attention') === 1 ? 'needs' : 'need'} attention`,
    count('at_risk') && `${count('at_risk')} at risk`,
    count('no_tasks') && `${count('no_tasks')} not started`,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader title="Progress" description="How each project is going, in plain words. It updates as the team works." />

      {error ? (
        <ErrorState title="Couldn't load progress" message={error} onRetry={load} />
      ) : !data ? (
        <SkeletonCards count={4} className="md:grid-cols-2" />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects to show yet"
          description={
            user?.role === 'client'
              ? "You'll see a project here once someone in the organization shares it with you."
              : 'Projects appear here as soon as the team creates them.'
          }
        />
      ) : (
        <>
          <section aria-label="Summary" className="card p-5">
            <p className="text-lg font-semibold text-fg">
              {totalTasks ? `${Math.round((doneTasks / totalTasks) * 100)}% of the work is done` : 'No work planned yet'}
            </p>
            <p className="mt-1 text-sm text-fg-muted">
              {totalTasks > 0 && `${doneTasks} of ${plural(totalTasks, 'task', 'tasks')} finished across `}
              {plural(projects.length, 'project', 'projects')}
              {summary.length > 0 && `: ${summary.join(', ')}`}.
            </p>
          </section>

          <ul className="grid gap-3 md:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/orgs/${orgId}/projects/${p.id}/dashboard`}
                  className="card block h-full space-y-3 p-5 transition-colors hover:border-border-strong"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-fg">{p.name}</h2>
                      {p.teamName && <p className="truncate text-xs text-fg-muted">{p.teamName}</p>}
                    </div>
                    <HealthBadge health={p.rollup.health} />
                  </div>
                  <div>
                    <div
                      className="h-2 overflow-hidden rounded-full bg-surface-3"
                      role="progressbar"
                      aria-valuenow={p.rollup.completionPercentage}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${p.name} progress`}
                    >
                      <div className="h-full rounded-full bg-accent" style={{ width: `${p.rollup.completionPercentage}%` }} />
                    </div>
                    <p className="mt-1.5 text-sm tabular-nums text-fg-muted">
                      {p.rollup.completionPercentage}% done · {p.rollup.tasks.completed} of{' '}
                      {plural(p.rollup.tasks.total, 'task', 'tasks')} finished
                    </p>
                  </div>
                  <p className="text-sm text-fg">{statusSentence(p.rollup)}</p>
                </Link>
              </li>
            ))}
          </ul>

          <section aria-labelledby="attention-heading" className="space-y-3">
            <h2 id="attention-heading" className="text-sm font-semibold text-fg">
              What needs attention <span className="font-normal text-fg-muted">{data.atRiskTasks.length}</span>
            </h2>
            {data.atRiskTasks.length === 0 ? (
              <EmptyState icon={CircleCheck} title="Nothing is late or stuck" description="Every task is on schedule." compact />
            ) : (
              <ul className="card divide-y divide-border overflow-hidden">
                {data.atRiskTasks.map((task) => {
                  const due = dueLabel(task.dueDate);
                  return (
                    <li key={task.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-fg">{task.title}</p>
                        <p className="truncate text-xs text-fg-muted">
                          {task.projectName} · {task.assignee ? `With ${task.assignee.name || task.assignee.email.split('@')[0]}` : 'No one assigned yet'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {task.isBlocked && <Badge variant="danger">Stuck</Badge>}
                        {task.isOverdue && <Badge variant="warning">Late</Badge>}
                        {due.text && <span className={`text-sm tabular-nums ${due.overdue ? 'text-danger' : 'text-fg-muted'}`}>{due.text}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
