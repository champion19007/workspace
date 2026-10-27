'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Search, Sun, Moon, Keyboard, CircleHelp, ChevronRight } from 'lucide-react';
import { isReadOnlyRole } from '@workspace/core';
import { useShell } from './shell-context';
import { useTheme } from '../theme-provider';

const SECTION_LABELS: Record<string, string> = {
  'my-tasks': 'My tasks',
  inbox: 'Inbox',
  projects: 'Projects',
  tasks: 'All tasks',
  board: 'Board',
  docs: 'Docs',
  meetings: 'Meetings',
  teams: 'Teams',
  members: 'People',
  leadership: 'Insights',
  settings: 'Settings',
  profile: 'Profile',
  chat: 'Ask AI',
  progress: 'Progress',
};

interface Crumb {
  label: string;
  href?: string;
}

/** Breadcrumb trail for the current route; project ids resolve to names from the shell's project list. */
function useCrumbs(): Crumb[] {
  const pathname = usePathname();
  const { orgId, projects, user } = useShell();
  const base = `/orgs/${orgId}`;
  const parts = pathname.slice(base.length).split('/').filter(Boolean);

  if (parts.length === 0) return [{ label: 'Home' }];
  const [section, id] = parts as [string, string | undefined];
  const sectionLabel = SECTION_LABELS[section] ?? section;
  if (!id) return [{ label: sectionLabel }];

  if (section === 'projects') {
    const name = projects?.find((p) => p.id === id)?.name ?? (projects ? 'Project' : '…');
    // Executives and Clients reach projects from Progress (they have no Projects page).
    const parent = isReadOnlyRole(user?.role) ? { label: 'Progress', href: `${base}/progress` } : { label: 'Projects', href: `${base}/projects` };
    return [parent, { label: name }];
  }
  if (section === 'docs') return [{ label: 'Docs', href: `${base}/docs` }, { label: 'Document' }];
  if (section === 'settings') return [{ label: 'Settings', href: `${base}/settings` }, { label: 'Integrations' }];
  return [{ label: sectionLabel }];
}

export function TopBar() {
  const { setIsHelpDrawerOpen, setIsShortcutsDialogOpen, setIsMobileSidebarOpen, setIsCommandLauncherOpen } = useShell();
  const { resolvedTheme, setTheme } = useTheme();
  const crumbs = useCrumbs();
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-canvas/85 px-3 backdrop-blur-md sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={() => setIsMobileSidebarOpen(true)}
        aria-label="Open navigation"
        className="btn btn-ghost btn-icon -ml-1 lg:hidden"
      >
        <Menu aria-hidden="true" />
      </button>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1 text-sm">
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={i} className={`flex min-w-0 items-center gap-1 ${last ? '' : 'hidden shrink-0 sm:flex'}`}>
                {crumb.href && !last ? (
                  <Link href={crumb.href} className="truncate text-fg-muted transition-colors hover:text-fg">
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current={last ? 'page' : undefined} className={`truncate ${last ? 'font-medium text-fg' : 'text-fg-muted'}`}>
                    {crumb.label}
                  </span>
                )}
                {!last && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setIsCommandLauncherOpen(true)}
          aria-label="Search"
          className="btn btn-ghost btn-icon lg:hidden"
        >
          <Search aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setTheme(nextTheme)}
          aria-label={`Switch to ${nextTheme} theme`}
          title={`Switch to ${nextTheme} theme`}
          className="btn btn-ghost btn-icon"
        >
          {resolvedTheme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => setIsShortcutsDialogOpen(true)}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (Shift+?)"
          className="btn btn-ghost btn-icon hidden sm:inline-flex"
        >
          <Keyboard aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setIsHelpDrawerOpen(true)}
          aria-label="Help"
          title="Help"
          className="btn btn-ghost btn-icon"
        >
          <CircleHelp aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
