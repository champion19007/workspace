'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CompletionRing } from '@/components/ui/completion-ring';
import { MetricStrip, type MetricItem } from '@/components/ui/metric-strip';
import { Badge } from '@/components/ui/badge';
import {
  type ProjectDashboardDTO,
  type HealthStatus,
  HEALTH_STATUS_LABELS,
} from '@workspace/core';
import {
  ArrowRight,
  TrendingUp,
  Activity,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Layers,
  Sparkles,
  RefreshCw,
  FolderKanban,
  ListTodo,
  User,
} from 'lucide-react';

function getHealthBadge(health: HealthStatus) {
  switch (health) {
    case 'at_risk':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <AlertTriangle className="w-3.5 h-3.5" />
          {HEALTH_STATUS_LABELS.at_risk}
        </span>
      );
    case 'needs_attention':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Clock className="w-3.5 h-3.5" />
          {HEALTH_STATUS_LABELS.needs_attention}
        </span>
      );
    case 'on_track':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {HEALTH_STATUS_LABELS.on_track}
        </span>
      );
    case 'no_tasks':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
          <Layers className="w-3.5 h-3.5" />
          {HEALTH_STATUS_LABELS.no_tasks}
        </span>
      );
  }
}

function formatRelativeTime(dateStr: string): string {
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    return `${diffDays}d ago`;
  } catch {
    return dateStr;
  }
}

export default function ProjectDashboardPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const projectId = params?.projectId as string;

  const [dashboard, setDashboard] = useState<ProjectDashboardDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/orgs/${orgId}/projects/${projectId}/dashboard`);
      if (!res.ok) {
        throw new Error(`Failed to load dashboard (${res.status})`);
      }
      const data: ProjectDashboardDTO = await res.json();
      setDashboard(data);
    } catch (err: any) {
      setError(err.message || 'An error occurred loading project dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orgId && projectId) {
      fetchDashboard();
    }
  }, [orgId, projectId]);

  if (loading && !dashboard) {
    return (
      <div className="space-y-6 animate-pulse p-4">
        <div className="h-44 bg-panel rounded-2xl border border-border-subtle" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-panel rounded-xl border border-border-subtle" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64 bg-panel rounded-2xl border border-border-subtle" />
          <div className="h-64 bg-panel rounded-2xl border border-border-subtle" />
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="p-8 text-center space-y-4 max-w-md mx-auto">
        <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto" />
        <h2 className="text-lg font-bold text-foreground">Project Dashboard Unavailable</h2>
        <p className="text-xs text-muted-foreground">{error || 'Project data could not be retrieved.'}</p>
        <button
          onClick={fetchDashboard}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground text-xs font-bold hover:opacity-90"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  const { project, rollup, recentActivity } = dashboard;

  const metrics: MetricItem[] = [
    {
      id: 'total-tasks',
      label: 'Total Tasks',
      value: rollup.tasks.total,
      dotColor: 'accent',
      subtext: `${rollup.subtasks.total} subtasks tracked`,
      change: rollup.tasks.total > 0 ? `${rollup.completionPercentage}% done` : undefined,
    },
    {
      id: 'in-progress',
      label: 'In Progress',
      value: rollup.tasks.inProgress,
      dotColor: 'amber',
      subtext: `${rollup.tasks.open} total open tasks`,
    },
    {
      id: 'due-soon-overdue',
      label: rollup.overdueCount > 0 ? 'Overdue Tasks' : 'Due Soon',
      value: rollup.overdueCount > 0 ? rollup.overdueCount : rollup.dueSoonCount,
      dotColor: rollup.overdueCount > 0 ? 'rose' : 'emerald',
      subtext:
        rollup.overdueCount > 0
          ? `${rollup.dueSoonCount} due in 7 days`
          : rollup.dueSoonCount > 0
          ? 'Next 7 calendar days'
          : 'Deadlines on track',
    },
    {
      id: 'health-status',
      label: 'Health Status',
      value: HEALTH_STATUS_LABELS[rollup.health],
      dotColor:
        rollup.health === 'at_risk'
          ? 'rose'
          : rollup.health === 'needs_attention'
          ? 'amber'
          : rollup.health === 'on_track'
          ? 'emerald'
          : 'accent',
      subtext: `${rollup.unassignedCount} unassigned tasks`,
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Summary Hero Card matching Screenshot 927 */}
      <div className="p-6 lg:p-8 rounded-2xl bg-panel border border-border-subtle border-l-4 border-l-accent shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-3 max-w-xl">
          <div className="flex flex-wrap items-center gap-2">
            {getHealthBadge(rollup.health)}
            {project.keyPrefix && (
              <Badge variant="neutral" className="font-mono text-xs">
                {project.keyPrefix}
              </Badge>
            )}
            {project.teamName && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <span>in</span>
                <span className="font-semibold text-foreground">{project.teamName}</span>
              </span>
            )}
            <Badge variant={project.visibility === 'private' ? 'accent' : 'neutral'}>
              {project.visibility}
            </Badge>
          </div>

          <h1 className="text-2xl lg:text-3xl font-extrabold text-foreground tracking-tight">
            {project.name}
          </h1>

          <p className="text-xs lg:text-sm text-muted-foreground leading-relaxed">
            {project.description || 'Track deliverables, deadlines, and project execution with multi-tenant isolation.'}
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <Link
              href={`/orgs/${orgId}/projects/${projectId}/tasks`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs tracking-wide shadow-md hover:opacity-90 transition-opacity"
            >
              <ListTodo className="w-3.5 h-3.5" />
              <span>View Task List</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>

            <Link
              href={`/orgs/${orgId}/board?projectId=${projectId}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-panel-elevated border border-border-subtle hover:border-border-strong text-foreground font-semibold text-xs transition-colors"
            >
              <FolderKanban className="w-3.5 h-3.5" />
              <span>Kanban Board</span>
            </Link>
          </div>
        </div>

        {/* 2. Circular Completion Ring matching Screenshot 927 */}
        <div className="shrink-0 p-5 rounded-2xl bg-panel-inset border border-border-subtle/80 flex flex-col items-center">
          <CompletionRing percentage={rollup.completionPercentage} label="COMPLETE" />
          <span className="text-[11px] font-mono text-muted-foreground mt-2">
            {rollup.tasks.completed} of {rollup.tasks.total} Tasks Done
          </span>
        </div>
      </div>

      {/* 3. Four-Part Metric Strip matching Screenshot 927 */}
      <MetricStrip items={metrics} />

      {/* 4. Split Cards: Project Progress & Recent Movement Activity Card */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Project Progress & Velocity Card */}
        <div className="p-6 rounded-2xl bg-panel border border-border-subtle flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                  Project Focus & Breakdown
                </h3>
              </div>
              {getHealthBadge(rollup.health)}
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-muted-foreground">Top-Level Tasks Completion</span>
                  <span className="font-mono font-semibold text-foreground">
                    {rollup.completionPercentage}% ({rollup.tasks.completed}/{rollup.tasks.total})
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-panel-inset overflow-hidden flex">
                  <div
                    className="h-full bg-accent transition-all duration-500"
                    style={{ width: `${rollup.completionPercentage}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-muted-foreground">Subtasks Progress</span>
                  <span className="font-mono font-semibold text-emerald-400">
                    {rollup.subtasks.total > 0
                      ? `${Math.round((rollup.subtasks.completed / rollup.subtasks.total) * 100)}%`
                      : '0%'}{' '}
                    ({rollup.subtasks.completed}/{rollup.subtasks.total})
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-panel-inset overflow-hidden flex">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-500"
                    style={{
                      width:
                        rollup.subtasks.total > 0
                          ? `${(rollup.subtasks.completed / rollup.subtasks.total) * 100}%`
                          : '0%',
                    }}
                  />
                </div>
              </div>

              {/* Status Pills Strip */}
              <div className="pt-2 grid grid-cols-4 gap-2 text-center text-xs">
                <div className="p-2.5 rounded-xl bg-panel-inset border border-border-subtle">
                  <div className="text-[10px] text-muted-foreground uppercase font-semibold">To Do</div>
                  <div className="text-base font-bold font-mono text-foreground mt-0.5">
                    {Math.max(0, rollup.tasks.open - rollup.tasks.inProgress - rollup.tasks.blocked)}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-panel-inset border border-border-subtle">
                  <div className="text-[10px] text-amber-400 uppercase font-semibold">In Progress</div>
                  <div className="text-base font-bold font-mono text-amber-400 mt-0.5">
                    {rollup.tasks.inProgress}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-panel-inset border border-border-subtle">
                  <div className="text-[10px] text-rose-400 uppercase font-semibold">Blocked</div>
                  <div className="text-base font-bold font-mono text-rose-400 mt-0.5">
                    {rollup.tasks.blocked}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-panel-inset border border-border-subtle">
                  <div className="text-[10px] text-emerald-400 uppercase font-semibold">Done</div>
                  <div className="text-base font-bold font-mono text-emerald-400 mt-0.5">
                    {rollup.tasks.completed}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border-subtle flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {rollup.overdueCount > 0 ? (
                <span className="text-rose-400 font-semibold">{rollup.overdueCount} overdue item(s)</span>
              ) : (
                <span>Zero overdue work</span>
              )}
            </span>
            <Link
              href={`/orgs/${orgId}/projects/${projectId}/tasks`}
              className="text-accent font-semibold hover:underline flex items-center gap-1"
            >
              <span>Manage tasks</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Recent Movement Activity Feed Card matching Screenshot 927 */}
        <div className="p-6 rounded-2xl bg-panel border border-border-subtle flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                  Recent Movement
                </h3>
              </div>
              <span className="text-xs text-muted-foreground">Live Telemetry</span>
            </div>

            {recentActivity.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-panel-inset border border-border-subtle text-xs text-muted-foreground space-y-2">
                <Sparkles className="w-6 h-6 mx-auto text-muted-foreground/60" />
                <p>No recent activity recorded for this project yet.</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
                {recentActivity.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-panel-inset border border-border-subtle/80 hover:border-border-strong transition-all text-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-2">
                      <span className="shrink-0 p-1 rounded bg-panel border border-border-subtle text-accent">
                        {item.verb.includes('task') ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <Layers className="w-3.5 h-3.5" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground truncate">
                          {item.targetKey ? `${item.targetKey}: ` : ''}
                          {item.targetTitle || item.verb}
                        </div>
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <User className="w-3 h-3" />
                          <span>{item.actor.name || item.actor.email || 'System'}</span>
                          <span>&bull;</span>
                          <span className="capitalize">{item.verb.replace(/_/g, ' ')}</span>
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {formatRelativeTime(item.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-border-subtle flex items-center justify-between text-xs text-muted-foreground">
            <span>Audited under PostgreSQL tenant context</span>
            <span className="text-emerald-400 font-mono text-[11px]">Synced</span>
          </div>
        </div>
      </div>
    </div>
  );
}
