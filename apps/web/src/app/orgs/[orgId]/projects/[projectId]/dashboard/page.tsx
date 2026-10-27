'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, Activity } from 'lucide-react';
import { CompletionRing } from '@/components/ui/completion-ring';
import { MetricStrip, type MetricItem } from '@/components/ui/metric-strip';
import { ErrorState } from '@/components/ui/states';
import { Avatar } from '@/components/ui/avatar';
import { isReadOnlyRole, type ProjectDashboardDTO } from '@workspace/core';
import { useShell } from '@/components/shell/shell-context';
import { formatRelativeTime } from '@/lib/format';

const STATUS_SEGMENTS = [
  { key: 'todo', label: 'To do', className: 'bg-fg-subtle' },
  { key: 'inProgress', label: 'In progress', className: 'bg-info' },
  { key: 'blocked', label: 'Blocked', className: 'bg-danger' },
  { key: 'completed', label: 'Done', className: 'bg-success' },
] as const;

function OverviewSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">Loading…</span>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-3 p-4">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-6 w-12" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card h-64" />
        <div className="card h-64" />
      </div>
    </div>
  );
}

export default function ProjectOverviewPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const projectId = params?.projectId as string;
  const base = `/orgs/${orgId}/projects/${projectId}`;
  // Executives and Clients have no List or Board tab.
  const readOnly = isReadOnlyRole(useShell().user?.role);

  const [dashboard, setDashboard] = useState<ProjectDashboardDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/orgs/${orgId}/projects/${projectId}/dashboard`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || (res.status === 404 ? "This project doesn't exist or you can't see it." : "The overview couldn't be loaded."));
      }
      setDashboard(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId, projectId]);

  useEffect(() => {
    if (orgId && projectId) fetchDashboard();
  }, [orgId, projectId, fetchDashboard]);

  if (loading && !dashboard) return <OverviewSkeleton />;
  if (error || !dashboard) return <ErrorState title="Couldn't load the overview" message={error} onRetry={fetchDashboard} />;

  const { rollup, recentActivity } = dashboard;
  const counts = {
    todo: Math.max(0, rollup.tasks.open - rollup.tasks.inProgress - rollup.tasks.blocked),
    inProgress: rollup.tasks.inProgress,
    blocked: rollup.tasks.blocked,
    completed: rollup.tasks.completed,
  };
  const total = rollup.tasks.total;

  const metrics: MetricItem[] = [
    {
      id: 'open',
      label: 'Open tasks',
      value: rollup.tasks.open,
      dotColor: 'indigo',
      subtext: `${rollup.tasks.inProgress} in progress`,
      href: readOnly ? undefined : `${base}/tasks`,
    },
    {
      id: 'overdue',
      label: 'Overdue',
      value: rollup.overdueCount,
      dotColor: rollup.overdueCount > 0 ? 'rose' : 'neutral',
      subtext: rollup.dueSoonCount > 0 ? `${rollup.dueSoonCount} due in the next 7 days` : 'Nothing due this week',
    },
    {
      id: 'blocked',
      label: 'Blocked',
      value: rollup.tasks.blocked,
      dotColor: rollup.tasks.blocked > 0 ? 'amber' : 'neutral',
      subtext: rollup.tasks.blocked > 0 ? 'Waiting on something' : 'Nothing blocked',
    },
    {
      id: 'unassigned',
      label: 'Unassigned',
      value: rollup.unassignedCount,
      dotColor: 'neutral',
      subtext: rollup.subtasks.total > 0 ? `${rollup.subtasks.completed}/${rollup.subtasks.total} subtasks done` : 'Open tasks without an owner',
    },
  ];

  return (
    <div className="space-y-6">
      <MetricStrip items={metrics} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5" aria-labelledby="progress-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="progress-heading" className="text-sm font-semibold text-fg">
              Progress
            </h2>
            {!readOnly && (
              <Link href={`${base}/board`} className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline">
                Open board
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            )}
          </div>

          <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:items-center">
            <CompletionRing percentage={rollup.completionPercentage} size={124} strokeWidth={10} label="done" />
            <div className="w-full flex-1 space-y-4">
              <p className="text-sm text-fg-muted">
                {total === 0 ? (
                  readOnly ? 'No tasks yet.' : 'No tasks yet. Add some from the List tab.'
                ) : (
                  <>
                    <span className="font-medium text-fg">{rollup.tasks.completed}</span> of{' '}
                    <span className="font-medium text-fg">{total}</span> tasks done
                  </>
                )}
              </p>
              {total > 0 && (
                <div className="flex h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                  {STATUS_SEGMENTS.map((s) =>
                    counts[s.key] > 0 ? (
                      <div key={s.key} className={s.className} style={{ width: `${(counts[s.key] / total) * 100}%` }} />
                    ) : null
                  )}
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {STATUS_SEGMENTS.map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-2">
                    <dt className="flex items-center gap-2 text-fg-muted">
                      <span className={`h-2 w-2 rounded-full ${s.className}`} aria-hidden="true" />
                      {s.label}
                    </dt>
                    <dd className="font-medium tabular-nums text-fg">{counts[s.key]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section className="card flex flex-col" aria-labelledby="activity-heading">
          <div className="border-b border-border px-5 py-4">
            <h2 id="activity-heading" className="text-sm font-semibold text-fg">
              Recent activity
            </h2>
          </div>
          {recentActivity.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
              <Activity className="h-5 w-5 text-fg-subtle" aria-hidden="true" />
              <p className="text-sm text-fg-muted">Changes to tasks in this project will show up here.</p>
            </div>
          ) : (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {recentActivity.map((item) => {
                const who = item.actor.name || item.actor.email || 'Workspace';
                return (
                  <li key={item.id} className="flex items-start gap-3 px-5 py-3">
                    <Avatar name={who} size="sm" className="mt-0.5" />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="text-fg">
                        <span className="font-medium">{who}</span>{' '}
                        <span className="text-fg-muted">{item.verb.replace(/_/g, ' ').replace(/^task /, '')}</span>{' '}
                        {item.targetTitle && <span className="font-medium">{item.targetTitle}</span>}
                      </p>
                      <p className="text-xs text-fg-muted">
                        {item.targetKey && <span className="font-mono">{item.targetKey} · </span>}
                        {formatRelativeTime(item.createdAt)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
