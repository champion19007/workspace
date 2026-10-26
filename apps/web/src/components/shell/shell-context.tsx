'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { HealthStatus } from '@workspace/core';

export interface ShellProject {
  id: string;
  name: string;
  description: string | null;
  teamName: string | null;
  visibility: 'public' | 'private';
  health: HealthStatus | null;
  completionPercentage: number | null;
  overdueCount: number;
}

export interface ShellUser {
  id: string;
  email: string;
  role: string;
  name?: string;
}

interface ShellContextType {
  orgId: string;
  /** Signed-in user; null until the session check finishes. */
  user: ShellUser | null;
  isHelpDrawerOpen: boolean;
  setIsHelpDrawerOpen: (open: boolean) => void;
  isShortcutsDialogOpen: boolean;
  setIsShortcutsDialogOpen: (open: boolean) => void;
  isCommandLauncherOpen: boolean;
  setIsCommandLauncherOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  isMobileSidebarOpen: boolean;
  setIsMobileSidebarOpen: (open: boolean) => void;
  /** Projects the user can see, for the sidebar, breadcrumbs and project header. null while loading. */
  projects: ShellProject[] | null;
  refreshProjects: () => void;
  /** Open meeting suggestions that name the user ("25+" when more pages exist). null while loading. */
  inboxCount: string | null;
}

const ShellContext = createContext<ShellContextType | null>(null);

interface ProjectApiRow {
  id: string;
  name: string;
  description: string | null;
  teamName: string | null;
  visibility: 'public' | 'private';
  rollup?: { health?: HealthStatus; completionPercentage?: number; overdueCount?: number } | null;
}

export function ShellProvider({
  orgId,
  user,
  children,
}: {
  orgId: string;
  user: ShellUser | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [isHelpDrawerOpen, setIsHelpDrawerOpen] = useState(false);
  const [isShortcutsDialogOpen, setIsShortcutsDialogOpen] = useState(false);
  const [isCommandLauncherOpen, setIsCommandLauncherOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [projects, setProjects] = useState<ShellProject[] | null>(null);
  const [inboxCount, setInboxCount] = useState<string | null>(null);

  const refreshProjects = useCallback(() => {
    fetch(`/api/orgs/${orgId}/projects?limit=100`)
      .then((res) => (res.ok ? res.json() : { projects: [] }))
      .then((data: { projects?: ProjectApiRow[] }) =>
        setProjects(
          (data.projects ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            teamName: p.teamName,
            visibility: p.visibility,
            health: p.rollup?.health ?? null,
            completionPercentage: p.rollup?.completionPercentage ?? null,
            overdueCount: p.rollup?.overdueCount ?? 0,
          }))
        )
      )
      .catch(() => setProjects([]));
  }, [orgId]);

  useEffect(() => {
    if (orgId) refreshProjects();
  }, [orgId, refreshProjects]);

  // Re-count on navigation so approving suggestions elsewhere updates the sidebar badge.
  useEffect(() => {
    if (!orgId) return;
    const qs = new URLSearchParams({ state: 'suggested', assignee: 'me', limit: '25' });
    fetch(`/api/orgs/${orgId}/action-items?${qs}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const n = (data.items ?? []).length;
        setInboxCount(data.pageInfo?.hasNextPage ? `${n}+` : String(n));
      })
      .catch(() => undefined);
  }, [orgId, pathname]);

  // Close the mobile navigation after any route change.
  useEffect(() => {
    setIsMobileSidebarOpen(false);
  }, [pathname]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      if (e.key === 'Escape') {
        if (isCommandLauncherOpen) return setIsCommandLauncherOpen(false);
        if (isShortcutsDialogOpen) return setIsShortcutsDialogOpen(false);
        if (isHelpDrawerOpen) return setIsHelpDrawerOpen(false);
        if (isMobileSidebarOpen) return setIsMobileSidebarOpen(false);
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandLauncherOpen((prev) => !prev);
        return;
      }

      // Single-key navigation never fires while typing.
      if (isInput || !orgId) return;

      if (e.shiftKey && e.key === '?') {
        e.preventDefault();
        setIsShortcutsDialogOpen(true);
        return;
      }

      const go = (path: string) => {
        e.preventDefault();
        router.push(`/orgs/${orgId}${path}`);
      };
      const key = e.key.toLowerCase();
      if (e.altKey && e.shiftKey && key === 't') return go('/teams');
      if (e.altKey && !e.shiftKey && key === 'm') return go('/my-tasks');
      if (e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        if (key === 'd') return go('');
        if (key === 'l') return go('/tasks');
        if (key === 'b') return go('/board');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [orgId, router, isCommandLauncherOpen, isShortcutsDialogOpen, isHelpDrawerOpen, isMobileSidebarOpen]);

  return (
    <ShellContext.Provider
      value={{
        orgId,
        user,
        isHelpDrawerOpen,
        setIsHelpDrawerOpen,
        isShortcutsDialogOpen,
        setIsShortcutsDialogOpen,
        isCommandLauncherOpen,
        setIsCommandLauncherOpen,
        isMobileSidebarOpen,
        setIsMobileSidebarOpen,
        projects,
        refreshProjects,
        inboxCount,
      }}
    >
      {children}
    </ShellContext.Provider>
  );
}

export function useShell() {
  const context = useContext(ShellContext);
  if (!context) {
    throw new Error('useShell must be used within a ShellProvider');
  }
  return context;
}
