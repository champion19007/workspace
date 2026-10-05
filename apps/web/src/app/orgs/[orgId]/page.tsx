'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CompletionRing } from '@/components/ui/completion-ring';
import { MetricStrip, MetricItem } from '@/components/ui/metric-strip';
import {
  Sparkles,
  ArrowRight,
  TrendingUp,
  Activity,
  CheckCircle2,
  Clock,
  Layers,
  ShieldCheck,
} from 'lucide-react';

export default function ProjectDashboardPage() {
  const params = useParams();
  const orgId = params?.orgId as string;

  // Initial dashboard metrics matching Screenshot 927
  const metrics: MetricItem[] = [
    {
      id: 'total-tasks',
      label: 'Total Tasks',
      value: 12,
      dotColor: 'accent',
      subtext: 'Across all active projects',
      change: '+3 new',
    },
    {
      id: 'in-progress',
      label: 'In Progress',
      value: 4,
      dotColor: 'amber',
      subtext: 'Assigned to active sprints',
    },
    {
      id: 'in-review',
      label: 'In Review',
      value: 2,
      dotColor: 'indigo',
      subtext: 'Awaiting human sign-off',
    },
    {
      id: 'completed',
      label: 'Completed',
      value: 6,
      dotColor: 'emerald',
      subtext: 'Verified this sprint',
      change: '50% rate',
    },
  ];

  const recentMovement = [
    {
      id: 'act-1',
      title: 'Tenant isolation & RLS policies verified',
      category: 'Security',
      timestamp: '10m ago',
      icon: <ShieldCheck className="w-4 h-4 text-emerald-400" />,
    },
    {
      id: 'act-2',
      title: 'Hierarchical node tree structure initialized',
      category: 'Projects',
      timestamp: '1h ago',
      icon: <Layers className="w-4 h-4 text-accent" />,
    },
    {
      id: 'act-3',
      title: 'Passwordless auth & BFF session rotation active',
      category: 'Authentication',
      timestamp: '2h ago',
      icon: <CheckCircle2 className="w-4 h-4 text-indigo-400" />,
    },
    {
      id: 'act-4',
      title: 'Zoom meeting webhook receiver ready for Stage 12',
      category: 'Ingestion',
      timestamp: '1d ago',
      icon: <Clock className="w-4 h-4 text-amber-400" />,
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Summary Hero Card with Left Accent Border (Screenshot 927) */}
      <div className="p-6 lg:p-8 rounded-2xl bg-panel border border-border-subtle border-l-4 border-l-accent shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2 max-w-xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-accent/15 text-accent border border-accent/30">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Workspace v1 Beta Ready</span>
          </div>

          <h1 className="text-2xl lg:text-3xl font-extrabold text-foreground tracking-tight">
            Execution is key to shipping Workspace v1.
          </h1>

          <p className="text-xs lg:text-sm text-muted-foreground leading-relaxed">
            Organize teams, projects, documents, and meeting action items with strict multi-tenant
            isolation and human-in-the-loop approvals.
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <Link
              href={`/orgs/${orgId}/tasks`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs tracking-wide shadow-md hover:opacity-90 transition-opacity"
            >
              <span>View Task List</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>

            <Link
              href={`/orgs/${orgId}/board`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-panel-elevated border border-border-subtle hover:border-border-strong text-foreground font-semibold text-xs transition-colors"
            >
              <span>Kanban Board</span>
            </Link>
          </div>
        </div>

        {/* Circular Completion Ring (Screenshot 927) */}
        <div className="shrink-0 p-4 rounded-2xl bg-panel-inset border border-border-subtle/80 flex flex-col items-center">
          <CompletionRing percentage={50} label="COMPLETE" />
          <span className="text-[11px] font-mono text-muted-foreground mt-2">
            6 of 12 Tasks Done
          </span>
        </div>
      </div>

      {/* 4-Item Metric Strip (Screenshot 927) */}
      <MetricStrip items={metrics} />

      {/* Split Cards: Project Progress & Recent Movement */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Project Progress & Focus Card */}
        <div className="p-6 rounded-2xl bg-panel border border-border-subtle flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                  Project Focus & Velocity
                </h3>
              </div>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                On Track
              </span>
            </div>

            <div className="p-4 rounded-xl bg-panel-inset border border-border-subtle text-xs text-muted-foreground italic leading-relaxed mb-4">
              &ldquo;Break down deliverables into discrete action items, assign accountable owners, and
              require explicit approval for AI notes before committing tasks.&rdquo;
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Sprint Completion</span>
                  <span className="font-mono font-semibold text-foreground">50%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-panel-inset overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-500"
                    style={{ width: '50%' }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Tenant Isolation & Guardrails</span>
                  <span className="font-mono font-semibold text-emerald-400">100%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-panel-inset overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 rounded-full transition-all duration-500"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border-subtle flex items-center justify-between text-xs text-muted-foreground">
            <span>Next milestone: Stage 5 API Contracts</span>
            <Link
              href={`/orgs/${orgId}/projects`}
              className="text-accent font-semibold hover:underline"
            >
              Browse all projects &rarr;
            </Link>
          </div>
        </div>

        {/* Recent Movement Activity Card */}
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

            <div className="space-y-3">
              {recentMovement.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-panel-inset border border-border-subtle/80 hover:border-border-strong transition-all text-xs"
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <span className="shrink-0">{item.icon}</span>
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground truncate">
                        {item.title}
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {item.category}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    {item.timestamp}
                  </span>
                </div>
              ))}
            </div>
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
