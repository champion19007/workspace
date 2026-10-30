'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { LayoutDashboard, ListTodo, Kanban, CalendarDays, GanttChart, FileText, Paperclip, Lock } from 'lucide-react';
import { isReadOnlyRole } from '@workspace/core';
import { useShell } from '@/components/shell/shell-context';
import { Badge, HealthBadge } from '@/components/ui/badge';

/** Project header and view tabs, shared by every project view (LTD-style project scope). */
export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const orgId = params?.orgId as string;
  const projectId = params?.projectId as string;
  const { projects, projectsError, user } = useShell();
  const project = projects?.find((p) => p.id === projectId);

  const base = `/orgs/${orgId}/projects/${projectId}`;
  const tabs = [
    { href: `${base}/dashboard`, label: 'Overview', icon: LayoutDashboard },
    { href: `${base}/tasks`, label: 'List', icon: ListTodo },
    { href: `${base}/board`, label: 'Board', icon: Kanban },
    { href: `${base}/calendar`, label: 'Calendar', icon: CalendarDays },
    { href: `${base}/timeline`, label: 'Timeline', icon: GanttChart },
    { href: `${base}/docs`, label: 'Docs', icon: FileText },
    { href: `${base}/files`, label: 'Files', icon: Paperclip },
  ].filter((t) => !isReadOnlyRole(user?.role) || ['Overview', 'Docs', 'Files'].includes(t.label));
  const activeTab = tabs.find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`));

  useEffect(() => {
    if (project) document.title = `${activeTab?.label ?? 'Project'} · ${project.name} · Workspace`;
  }, [project, activeTab]);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <header className="min-w-0 space-y-1">
          {project ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-balance text-xl font-semibold tracking-tight text-fg">{project.name}</h1>
                {project.health && <HealthBadge health={project.health} />}
                {project.visibility === 'private' && <Badge icon={Lock}>Private</Badge>}
              </div>
              {(project.teamName || project.description) && (
                <p className="max-w-3xl text-sm text-fg-muted">
                  {project.teamName && <span className="font-medium text-fg">{project.teamName}</span>}
                  {project.teamName && project.description && <span aria-hidden="true"> · </span>}
                  {project.description}
                </p>
              )}
            </>
          ) : projects === null && !projectsError ? (
            <div className="space-y-2 py-1" aria-hidden="true">
              <div className="skeleton h-6 w-56" />
              <div className="skeleton h-4 w-80 max-w-full" />
            </div>
          ) : (
            <h1 className="text-xl font-semibold tracking-tight text-fg">Project</h1>
          )}
        </header>

        <nav aria-label="Project views" className="tabs">
          {tabs.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="tab" aria-current={activeTab?.href === href ? 'page' : undefined}>
              <Icon aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
      </div>

      {children}
    </div>
  );
}
