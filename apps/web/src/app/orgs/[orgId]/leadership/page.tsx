'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import {
  type LeadershipSummaryDTO,
  type HealthStatus,
  HEALTH_STATUS_LABELS,
} from '@workspace/core';
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  Layers,
  Search,
  FolderKanban,
  ExternalLink,
  Shield,
  HelpCircle,
} from 'lucide-react';

function getHealthBadge(health: HealthStatus) {
  switch (health) {
    case 'at_risk':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <AlertTriangle className="w-3 h-3" />
          {HEALTH_STATUS_LABELS.at_risk}
        </span>
      );
    case 'needs_attention':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Clock className="w-3 h-3" />
          {HEALTH_STATUS_LABELS.needs_attention}
        </span>
      );
    case 'on_track':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 className="w-3 h-3" />
          {HEALTH_STATUS_LABELS.on_track}
        </span>
      );
    case 'no_tasks':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
          <Layers className="w-3 h-3" />
          {HEALTH_STATUS_LABELS.no_tasks}
        </span>
      );
  }
}

export default function LeadershipDashboardPage() {
  const params = useParams();
  const orgId = params?.orgId as string;

  const [data, setData] = useState<LeadershipSummaryDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState<string>('all');

  const fetchLeadershipData = async () => {
    try {
      setLoading(true);
      setError(null);

      const searchParams = new URLSearchParams();
      if (search.trim()) {
        searchParams.set('search', search.trim());
      }
      if (healthFilter && healthFilter !== 'all') {
        searchParams.set('health', healthFilter);
      }

      const res = await fetch(`/api/orgs/${orgId}/leadership?${searchParams.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load leadership metrics (${res.status})`);
      }
      const json: LeadershipSummaryDTO = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Error loading leadership dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orgId) {
      fetchLeadershipData();
    }
  }, [orgId, healthFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLeadershipData();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border-subtle pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Leadership & Risk Dashboard
            </h1>
            <Badge variant="accent" className="font-mono text-[11px]">
              Direct SQL Parity
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time project health rollups, risk hotspots, and completion tracking across all permitted projects.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/orgs/${orgId}/projects`}
            className="px-3 py-1.5 rounded-lg bg-panel-elevated border border-border-subtle hover:border-border-strong text-foreground text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <FolderKanban className="w-3.5 h-3.5" />
            <span>Directory</span>
          </Link>
        </div>
      </div>

      {/* 2. Top-level Leadership KPI Strip (Direct SQL Parity) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 rounded-xl bg-panel border border-border-subtle flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Total Projects
          </span>
          <div className="text-2xl font-bold font-mono text-foreground mt-2">
            {data?.summary.totalProjects ?? 0}
          </div>
          <span className="text-[10px] text-muted-foreground mt-1">Authorized scope</span>
        </div>

        <div className="p-4 rounded-xl bg-panel border border-border-subtle flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Total Tasks
          </span>
          <div className="text-2xl font-bold font-mono text-foreground mt-2">
            {data?.summary.totalTasks ?? 0}
          </div>
          <span className="text-[10px] text-muted-foreground mt-1">Top-level units</span>
        </div>

        <div className="p-4 rounded-xl bg-panel border border-border-subtle flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-rose-400 uppercase tracking-wider">
            At-Risk Projects
          </span>
          <div className="text-2xl font-bold font-mono text-rose-400 mt-2">
            {data?.summary.atRiskProjects ?? 0}
          </div>
          <span className="text-[10px] text-muted-foreground mt-1">Require triage</span>
        </div>

        <div className="p-4 rounded-xl bg-panel border border-border-subtle flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-rose-400 uppercase tracking-wider">
            Overdue Work
          </span>
          <div className="text-2xl font-bold font-mono text-rose-400 mt-2">
            {data?.summary.totalOverdue ?? 0}
          </div>
          <span className="text-[10px] text-muted-foreground mt-1">Past Asia/Kolkata date</span>
        </div>

        <div className="p-4 rounded-xl bg-panel border border-border-subtle flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">
            Unassigned Tasks
          </span>
          <div className="text-2xl font-bold font-mono text-amber-400 mt-2">
            {data?.summary.totalUnassigned ?? 0}
          </div>
          <span className="text-[10px] text-muted-foreground mt-1">Awaiting owner</span>
        </div>

        <div className="p-4 rounded-xl bg-panel border border-border-subtle flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-accent uppercase tracking-wider">
            Avg Completion
          </span>
          <div className="text-2xl font-bold font-mono text-accent mt-2">
            {data?.summary.averageCompletionPercentage ?? 0}%
          </div>
          <span className="text-[10px] text-muted-foreground mt-1">Across active projects</span>
        </div>
      </div>

      {/* 3. Filter Toolbar */}
      <div className="p-4 rounded-2xl bg-panel border border-border-subtle flex flex-col md:flex-row items-center justify-between gap-4">
        <form onSubmit={handleSearchSubmit} className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects by name or key..."
            className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-panel-inset border border-border-subtle text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </form>

        {/* Health Filter Chips */}
        <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto">
          {[
            { id: 'all', label: 'All Projects' },
            { id: 'at_risk', label: 'At Risk' },
            { id: 'needs_attention', label: 'Needs Attention' },
            { id: 'on_track', label: 'On Track' },
            { id: 'no_tasks', label: 'No Tasks' },
          ].map((chip) => (
            <button
              key={chip.id}
              onClick={() => setHealthFilter(chip.id)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                healthFilter === chip.id
                  ? 'bg-accent text-accent-foreground shadow-sm'
                  : 'bg-panel-inset text-muted-foreground hover:text-foreground border border-border-subtle'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4. Projects Health Status Overview Table */}
      <div className="rounded-2xl bg-panel border border-border-subtle overflow-hidden">
        <div className="p-4 border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderKanban className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
              Project Health Overview ({data?.projects.length ?? 0})
            </h2>
          </div>
          <span className="text-[11px] text-muted-foreground">Permission-Isolated</span>
        </div>

        {loading && !data ? (
          <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">
            Loading rollups...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-rose-400">{error}</div>
        ) : data?.projects.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground space-y-2">
            <HelpCircle className="w-6 h-6 mx-auto text-muted-foreground/60" />
            <p>No projects match the current filter selection.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-panel-inset/50 text-muted-foreground border-b border-border-subtle">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Project</th>
                  <th className="py-2.5 px-4 font-semibold">Team</th>
                  <th className="py-2.5 px-4 font-semibold">Health</th>
                  <th className="py-2.5 px-4 font-semibold">Completion</th>
                  <th className="py-2.5 px-4 font-semibold text-center">Tasks</th>
                  <th className="py-2.5 px-4 font-semibold text-center">Overdue</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {data?.projects.map((p) => (
                  <tr key={p.id} className="hover:bg-panel-elevated/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {p.keyPrefix && (
                          <Badge variant="neutral" className="font-mono text-[10px]">
                            {p.keyPrefix}
                          </Badge>
                        )}
                        <span className="font-semibold text-foreground">{p.name}</span>
                        {p.visibility === 'private' && (
                          <Shield className="w-3 h-3 text-muted-foreground" />
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {p.teamName || '—'}
                    </td>
                    <td className="py-3 px-4">{getHealthBadge(p.rollup.health)}</td>
                    <td className="py-3 px-4">
                      <div className="w-32 space-y-1">
                        <div className="flex justify-between text-[11px] font-mono">
                          <span>{p.rollup.completionPercentage}%</span>
                          <span className="text-muted-foreground">
                            {p.rollup.tasks.completed}/{p.rollup.tasks.total}
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-panel-inset overflow-hidden">
                          <div
                            className="h-full bg-accent transition-all duration-300"
                            style={{ width: `${p.rollup.completionPercentage}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-mono">
                      <span className="font-semibold text-foreground">{p.rollup.tasks.total}</span>
                      <span className="text-[10px] text-muted-foreground ml-1">
                        (+{p.rollup.subtasks.total} sub)
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center font-mono">
                      {p.rollup.overdueCount > 0 ? (
                        <span className="text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                          {p.rollup.overdueCount}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <Link
                          href={`/orgs/${orgId}/projects/${p.id}/dashboard`}
                          className="px-2.5 py-1 rounded bg-panel-elevated hover:bg-panel-inset border border-border-subtle text-[11px] font-semibold text-foreground transition-colors"
                        >
                          Dashboard
                        </Link>
                        <Link
                          href={`/orgs/${orgId}/projects/${p.id}/tasks`}
                          className="px-2.5 py-1 rounded bg-panel-elevated hover:bg-panel-inset border border-border-subtle text-[11px] font-semibold text-foreground transition-colors"
                        >
                          Tasks
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. At-Risk Work Drilldown (Overdue or Blocked tasks across permitted projects) */}
      <div className="rounded-2xl bg-panel border border-border-subtle overflow-hidden">
        <div className="p-4 border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
              At-Risk Work Drilldown ({data?.atRiskTasks.length ?? 0})
            </h2>
          </div>
          <span className="text-[11px] text-muted-foreground">Direct SQL Filter Parity</span>
        </div>

        {data?.atRiskTasks.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground space-y-2">
            <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-400/80" />
            <p>No overdue or blocked tasks in the authorized projects. All workflows healthy!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-panel-inset/50 text-muted-foreground border-b border-border-subtle">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Key</th>
                  <th className="py-2.5 px-4 font-semibold">Task</th>
                  <th className="py-2.5 px-4 font-semibold">Project</th>
                  <th className="py-2.5 px-4 font-semibold">Assignee</th>
                  <th className="py-2.5 px-4 font-semibold">Due Date</th>
                  <th className="py-2.5 px-4 font-semibold">Issue</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {data?.atRiskTasks.map((task) => (
                  <tr key={task.id} className="hover:bg-panel-elevated/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-accent">
                      {task.key}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-semibold text-foreground">{task.title}</span>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {task.projectName}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {task.assignee ? task.assignee.name || task.assignee.email : 'Unassigned'}
                    </td>
                    <td className="py-3 px-4 font-mono">
                      {task.dueDate ? (
                        <span className={task.isOverdue ? 'text-rose-400 font-bold' : 'text-muted-foreground'}>
                          {task.dueDate}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {task.isOverdue && (
                        <Badge variant="danger" className="text-[10px]">
                          Overdue
                        </Badge>
                      )}
                      {task.isBlocked && (
                        <Badge variant="warning" className="text-[10px] ml-1">
                          Blocked
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        href={`/orgs/${orgId}/projects/${task.projectId}/tasks`}
                        className="inline-flex items-center gap-1 text-[11px] text-accent font-semibold hover:underline"
                      >
                        <span>View</span>
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
