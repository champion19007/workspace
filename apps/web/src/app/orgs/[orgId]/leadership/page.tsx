'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Search, Lock, CircleCheck, FolderKanban } from 'lucide-react';
import { type LeadershipSummaryDTO } from '@workspace/core';
import { Badge, HealthBadge, HEALTH_META } from '@/components/ui/badge';
import { MetricStrip, type MetricItem } from '@/components/ui/metric-strip';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { dueLabel } from '@/lib/format';

const HEALTH_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'at_risk', label: HEALTH_META.at_risk.label },
  { id: 'needs_attention', label: HEALTH_META.needs_attention.label },
  { id: 'on_track', label: HEALTH_META.on_track.label },
  { id: 'no_tasks', label: HEALTH_META.no_tasks.label },
];

export default function InsightsPage() {
  const params = useParams();
  const orgId = params?.orgId as string;

  const [data, setData] = useState<LeadershipSummaryDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState<string>('all');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const fetchInsights = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const searchParams = new URLSearchParams();
      if (debouncedSearch.trim()) searchParams.set('search', debouncedSearch.trim());
      if (healthFilter !== 'all') searchParams.set('health', healthFilter);

      const res = await fetch(`/api/orgs/${orgId}/leadership?${searchParams.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Insights couldn't be loaded.");
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId, debouncedSearch, healthFilter]);

  useEffect(() => {
    if (orgId) fetchInsights();
  }, [orgId, fetchInsights]);

  const s = data?.summary;
  const metrics: MetricItem[] = s
    ? [
        {
          id: 'projects',
          label: 'Projects',
          value: s.totalProjects,
          dotColor: 'indigo',
          subtext: `${s.totalTasks} tasks in total`,
        },
        {
          id: 'at-risk',
          label: 'At risk',
          value: s.atRiskProjects,
          dotColor: s.atRiskProjects > 0 ? 'rose' : 'neutral',
          subtext: s.atRiskProjects > 0 ? 'Projects with overdue or blocked work' : 'No projects at risk',
        },
        {
          id: 'overdue',
          label: 'Overdue tasks',
          value: s.totalOverdue,
          dotColor: s.totalOverdue > 0 ? 'rose' : 'neutral',
          subtext: `${s.totalUnassigned} open tasks have no owner`,
        },
        {
          id: 'completion',
          label: 'Average completion',
          value: `${s.averageCompletionPercentage}%`,
          dotColor: 'emerald',
          subtext: 'Across projects with tasks',
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Insights" description="How every project you can see is doing, and which work is at risk." />

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card space-y-3 p-4">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-6 w-12" />
            </div>
          ))}
        </div>
      ) : (
        data && <MetricStrip items={metrics} />
      )}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter projects by name"
            aria-label="Filter projects"
            className="field field-sm pl-9"
          />
        </div>
        <div className="segmented" role="group" aria-label="Health">
          {HEALTH_FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={healthFilter === f.id} onClick={() => setHealthFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <ErrorState title="Couldn't load insights" message={error} onRetry={fetchInsights} />
      ) : loading && !data ? (
        <SkeletonRows rows={4} />
      ) : (
        data && (
          <>
            <section aria-labelledby="health-heading" className="space-y-3">
              <h2 id="health-heading" className="text-sm font-semibold text-fg">
                Project health <span className="font-normal text-fg-muted">{data.projects.length}</span>
              </h2>
              {data.projects.length === 0 ? (
                <EmptyState
                  icon={FolderKanban}
                  title="No projects match"
                  description="Try another health filter or search."
                  action={{
                    label: 'Show all projects',
                    onClick: () => {
                      setHealthFilter('all');
                      setSearch('');
                    },
                  }}
                  compact
                />
              ) : (
                <div className="card overflow-x-auto">
                  <table className="table min-w-[44rem]">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th className="w-40">Health</th>
                        <th className="w-48">Progress</th>
                        <th className="w-20 text-right">Tasks</th>
                        <th className="w-24 text-right">Overdue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.projects.map((p) => (
                        <tr key={p.id} className="transition-colors hover:bg-surface-2/60">
                          <td>
                            <Link href={`/orgs/${orgId}/projects/${p.id}/dashboard`} className="flex items-center gap-1.5 font-medium text-fg hover:underline">
                              {p.name}
                              {p.visibility === 'private' && <Lock className="h-3 w-3 text-fg-subtle" aria-label="Private" />}
                            </Link>
                            {p.teamName && <span className="text-xs text-fg-muted">{p.teamName}</span>}
                          </td>
                          <td>
                            <HealthBadge health={p.rollup.health} />
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                                <div className="h-full rounded-full bg-accent" style={{ width: `${p.rollup.completionPercentage}%` }} />
                              </div>
                              <span className="w-24 text-xs tabular-nums text-fg-muted">
                                {p.rollup.completionPercentage}% · {p.rollup.tasks.completed}/{p.rollup.tasks.total}
                              </span>
                            </div>
                          </td>
                          <td className="text-right tabular-nums text-fg">{p.rollup.tasks.total}</td>
                          <td className={`text-right tabular-nums ${p.rollup.overdueCount > 0 ? 'font-medium text-danger' : 'text-fg-muted'}`}>
                            {p.rollup.overdueCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section aria-labelledby="risk-heading" className="space-y-3">
              <h2 id="risk-heading" className="text-sm font-semibold text-fg">
                Work at risk <span className="font-normal text-fg-muted">{data.atRiskTasks.length}</span>
              </h2>
              {data.atRiskTasks.length === 0 ? (
                <EmptyState icon={CircleCheck} title="Nothing at risk" description="No overdue or blocked tasks in the projects you can see." compact />
              ) : (
                <ul className="card divide-y divide-border overflow-hidden">
                  {data.atRiskTasks.map((task) => {
                    const due = dueLabel(task.dueDate);
                    return (
                      <li key={task.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/orgs/${orgId}/projects/${task.projectId}/tasks?task=${task.id}`}
                            className="font-medium text-fg hover:underline"
                          >
                            {task.title}
                          </Link>
                          <p className="truncate text-xs text-fg-muted">
                            <span className="font-mono">{task.key}</span> · {task.projectName} ·{' '}
                            {task.assignee ? task.assignee.name || task.assignee.email : 'Unassigned'}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {task.isBlocked && <Badge variant="danger">Blocked</Badge>}
                          {task.isOverdue && <Badge variant="warning">Overdue</Badge>}
                          {due.text && <span className={`text-sm tabular-nums ${due.overdue ? 'text-danger' : 'text-fg-muted'}`}>{due.text}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )
      )}
    </div>
  );
}
