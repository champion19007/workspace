'use client';

import React from 'react';
import Link from 'next/link';
import { FolderGit2, CheckCircle2, Clock, ChevronRight } from 'lucide-react';

export interface ProjectCardData {
  id: string;
  name: string;
  key: string;
  description?: string;
  leadName?: string;
  leadEmail?: string;
  taskCount?: number;
  completedCount?: number;
  orgId: string;
}

export function ProjectCard({ project }: { project: ProjectCardData }) {
  const completionPercentage =
    project.taskCount && project.taskCount > 0
      ? Math.round(((project.completedCount || 0) / project.taskCount) * 100)
      : 0;

  return (
    <Link
      href={`/orgs/${project.orgId}/projects/${project.id}/dashboard`}
      className="group block p-5 rounded-xl bg-panel border border-border-subtle hover:border-accent/50 hover:bg-panel-elevated/70 transition-all duration-150 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-panel-inset border border-border-subtle flex items-center justify-center text-accent group-hover:scale-105 transition-transform">
            <FolderGit2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground group-hover:text-accent transition-colors flex items-center gap-1.5">
              <span>{project.name}</span>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </h3>
            <span className="inline-block text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-panel-inset border border-border-subtle text-muted-foreground uppercase">
              {project.key}
            </span>
          </div>
        </div>
      </div>

      {project.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-4 leading-relaxed">
          {project.description}
        </p>
      )}

      <div className="pt-3 border-t border-border-subtle flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="flex items-center gap-1 text-slate-300">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            {project.taskCount || 0} tasks
          </span>
          <span className="flex items-center gap-1 text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {project.completedCount || 0} done ({completionPercentage}%)
          </span>
        </div>

        <div className="flex items-center gap-2">
          {project.leadName && (
            <div className="flex items-center gap-1.5" title={`Lead: ${project.leadName}`}>
              <div className="w-5 h-5 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-[10px] font-bold text-accent uppercase">
                {project.leadName.charAt(0)}
              </div>
              <span className="text-[11px] text-muted-foreground hidden sm:inline">
                {project.leadName}
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
