'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home,
  CircleCheck,
  Inbox,
  ListTodo,
  FileText,
  Video,
  Users,
  UserRound,
  BarChart3,
  Settings,
  CircleHelp,
  Search,
  ChevronsUpDown,
  Check,
  Plus,
  X,
  Gauge,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { isReadOnlyRole } from '@workspace/core';
import { useShell } from './shell-context';
import { AccountMenu, UserSessionInfo } from './account-menu';
import { HEALTH_META } from '../ui/badge';
import { trapTabKey } from '../ui/dialog';
import { useDismiss } from '../ui/use-dismiss';

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: string;
}

interface SidebarProps {
  currentOrg: OrgSummary | null;
  availableOrgs?: OrgSummary[];
  user: UserSessionInfo | null;
}

const PROJECTS_SHOWN = 8;

function NavItem({
  href,
  icon: Icon,
  label,
  active,
  trailing,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className="nav-item">
      <Icon aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </Link>
  );
}

function OrgSwitcher({ currentOrg, availableOrgs }: { currentOrg: OrgSummary | null; availableOrgs: OrgSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);

  const switchTo = async (targetOrgId: string) => {
    setOpen(false);
    if (!currentOrg || targetOrgId === currentOrg.id) return;
    try {
      const res = await fetch('/api/auth/switch-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: targetOrgId }),
      });
      if (res.ok) router.refresh();
    } finally {
      router.push(`/orgs/${targetOrgId}`);
    }
  };

  if (!currentOrg) {
    return (
      <div className="flex h-10 items-center gap-2.5 px-1.5" aria-hidden="true">
        <div className="skeleton h-7 w-7" />
        <div className="skeleton h-3.5 w-28" />
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Organization: ${currentOrg.name}. Switch organization`}
        className="flex h-10 w-full items-center gap-2.5 rounded-md px-1.5 text-left transition-colors hover:bg-surface-2"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-semibold text-accent-fg">
          {currentOrg.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg">{currentOrg.name}</span>
          <span className="block truncate text-xs capitalize text-fg-muted">{currentOrg.plan} plan</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
      </button>

      {open && (
        <div role="menu" className="menu left-0 right-0 top-full mt-1">
          <div className="menu-label">Organizations</div>
          {availableOrgs.map((org) => (
            <button key={org.id} type="button" role="menuitem" onClick={() => switchTo(org.id)} className="menu-item">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-3 text-[11px] font-semibold text-fg-muted">
                {org.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{org.name}</span>
              {org.id === currentOrg.id && <Check className="!text-accent-text" aria-label="Current organization" />}
            </button>
          ))}
          <div className="menu-sep" />
          <Link href="/onboarding" role="menuitem" onClick={() => setOpen(false)} className="menu-item">
            <Plus aria-hidden="true" />
            New organization
          </Link>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ currentOrg, availableOrgs = [], user }: SidebarProps) {
  const pathname = usePathname();
  const {
    orgId,
    user: shellUser,
    projects,
    projectsError,
    refreshProjects,
    inboxCount,
    setIsCommandLauncherOpen,
    setIsHelpDrawerOpen,
    isMobileSidebarOpen,
    setIsMobileSidebarOpen,
  } = useShell();
  const [showAllProjects, setShowAllProjects] = useState(false);
  const mobilePanelRef = useRef<HTMLDivElement>(null);

  // Mobile navigation is a modal: focus moves in on open and Tab stays inside until it closes.
  useEffect(() => {
    if (!isMobileSidebarOpen) return;
    const panel = mobilePanelRef.current;
    panel?.querySelector<HTMLElement>('a[href], button')?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') trapTabKey(e, panel);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobileSidebarOpen]);

  const base = `/orgs/${orgId}`;
  // Executives and Clients get the Progress view only (see isProgressViewPath).
  const readOnly = isReadOnlyRole(shellUser?.role);
  const isActive = (path: string, exact = false) =>
    exact ? pathname === `${base}${path}` : pathname === `${base}${path}` || pathname.startsWith(`${base}${path}/`);

  const visibleProjects = projects
    ? showAllProjects
      ? projects
      : projects.slice(0, PROJECTS_SHOWN)
    : null;

  const navContent = (
    <div className="flex h-full flex-col">
      <div className="space-y-2 p-3">
        <OrgSwitcher currentOrg={currentOrg} availableOrgs={availableOrgs} />
        <button
          type="button"
          onClick={() => setIsCommandLauncherOpen(true)}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-canvas px-2.5 text-sm text-fg-subtle transition-colors hover:border-border-strong hover:text-fg-muted"
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 truncate text-left">Search…</span>
          <kbd className="kbd">Ctrl K</kbd>
        </button>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {readOnly ? (
          <div className="space-y-0.5">
            <NavItem href={`${base}/progress`} icon={Gauge} label="Progress" active={isActive('/progress')} />
            <NavItem href={`${base}/chat`} icon={Sparkles} label="Ask AI" active={isActive('/chat')} />
          </div>
        ) : (
          <div className="space-y-0.5">
            <NavItem href={base} icon={Home} label="Home" active={isActive('', true)} />
            <NavItem href={`${base}/my-tasks`} icon={CircleCheck} label="My tasks" active={isActive('/my-tasks')} />
            <NavItem
              href={`${base}/inbox`}
              icon={Inbox}
              label="Inbox"
              active={isActive('/inbox')}
              trailing={
                inboxCount && inboxCount !== '0' ? (
                  <span className="count bg-accent-subtle text-accent-text">
                    {inboxCount}
                    <span className="sr-only"> suggestions to review</span>
                  </span>
                ) : null
              }
            />
            <NavItem href={`${base}/chat`} icon={Sparkles} label="Ask AI" active={isActive('/chat')} />
          </div>
        )}

        <div className="space-y-0.5">
          <div className="flex items-center justify-between px-2.5 pb-1">
            {readOnly ? (
              <span className="text-xs font-medium text-fg-subtle">Projects</span>
            ) : (
              <>
                <Link href={`${base}/projects`} className="text-xs font-medium text-fg-subtle hover:text-fg" aria-current={isActive('/projects', true) ? 'page' : undefined}>
                  Projects
                </Link>
                <Link
                  href={`${base}/projects?new=1`}
                  aria-label="New project"
                  className="rounded p-0.5 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </>
            )}
          </div>
          {visibleProjects === null && projectsError ? (
            <p className="flex items-center justify-between gap-2 px-2.5 py-1 text-xs text-fg-muted">
              Couldn&apos;t load projects
              <button type="button" onClick={refreshProjects} className="link">
                Retry
              </button>
            </p>
          ) : visibleProjects === null ? (
            <div className="space-y-2 px-2.5 py-1" aria-hidden="true">
              <div className="skeleton h-3.5 w-36" />
              <div className="skeleton h-3.5 w-28" />
              <div className="skeleton h-3.5 w-32" />
            </div>
          ) : visibleProjects.length === 0 && readOnly ? (
            <p className="px-2.5 py-1 text-xs text-fg-muted">No projects shared with you yet.</p>
          ) : visibleProjects.length === 0 ? (
            <Link href={`${base}/projects?new=1`} className="nav-item text-fg-subtle">
              <Plus aria-hidden="true" />
              Create a project
            </Link>
          ) : (
            <>
              {visibleProjects.map((project) => {
                const health = project.health ? HEALTH_META[project.health] : null;
                return (
                  <Link
                    key={project.id}
                    href={`${base}/projects/${project.id}/dashboard`}
                    aria-current={isActive(`/projects/${project.id}`) ? 'page' : undefined}
                    className="nav-item"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                      <span className={`h-2 w-2 rounded-full ${health?.dot ?? 'bg-fg-subtle'}`} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    {health && <span className="sr-only">, {health.label}</span>}
                  </Link>
                );
              })}
              {projects && projects.length > PROJECTS_SHOWN && (
                <button
                  type="button"
                  onClick={() => setShowAllProjects(!showAllProjects)}
                  className="nav-item w-full text-fg-subtle"
                >
                  <span className="h-4 w-4" aria-hidden="true" />
                  {showAllProjects ? 'Show fewer' : `Show all ${projects.length}`}
                </button>
              )}
            </>
          )}
        </div>

        {!readOnly && (
          <div className="space-y-0.5">
            <div className="px-2.5 pb-1 text-xs font-medium text-fg-subtle">Workspace</div>
            <NavItem href={`${base}/tasks`} icon={ListTodo} label="All tasks" active={isActive('/tasks')} />
            <NavItem href={`${base}/docs`} icon={FileText} label="Docs" active={isActive('/docs')} />
            <NavItem href={`${base}/meetings`} icon={Video} label="Meetings" active={isActive('/meetings')} />
            <NavItem href={`${base}/teams`} icon={Users} label="Teams" active={isActive('/teams')} />
            <NavItem href={`${base}/members`} icon={UserRound} label="People" active={isActive('/members')} />
            <NavItem href={`${base}/leadership`} icon={BarChart3} label="Insights" active={isActive('/leadership')} />
          </div>
        )}
      </nav>

      <div className="space-y-0.5 border-t border-border p-3">
        {!readOnly && <NavItem href={`${base}/settings`} icon={Settings} label="Settings" active={isActive('/settings')} />}
        <button type="button" onClick={() => setIsHelpDrawerOpen(true)} className="nav-item w-full">
          <CircleHelp aria-hidden="true" />
          Help
        </button>
        <div className="pt-1.5">
          <AccountMenu user={user} orgId={orgId} />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border bg-surface lg:block">
        {navContent}
      </aside>

      {isMobileSidebarOpen && (
        <div role="dialog" aria-modal="true" aria-label="Navigation" className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 animate-fade-in bg-overlay/50"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={mobilePanelRef}
            className="relative z-10 h-full w-72 max-w-[85vw] animate-slide-in-left border-r border-border bg-surface shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(false)}
              className="btn btn-ghost btn-icon btn-sm absolute -right-11 top-3 bg-surface"
              aria-label="Close navigation"
            >
              <X aria-hidden="true" />
            </button>
            {navContent}
          </div>
        </div>
      )}
    </>
  );
}
