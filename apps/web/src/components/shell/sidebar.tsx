'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home,
  CheckSquare,
  Inbox,
  Users,
  FolderGit2,
  FileText,
  Video,
  UserCheck,
  Search,
  Sparkles,
  ChevronDown,
  Building2,
  Plus,
  Check,
  X,
  BarChart3,
} from 'lucide-react';
import { useShell } from './shell-context';
import { AccountMenu, UserSessionInfo } from './account-menu';

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: string;
}

interface SidebarProps {
  currentOrg: OrgSummary;
  availableOrgs?: OrgSummary[];
  user: UserSessionInfo;
}

export function Sidebar({ currentOrg, availableOrgs = [], user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    setIsCommandLauncherOpen,
    isMobileSidebarOpen,
    setIsMobileSidebarOpen,
  } = useShell();

  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);

  const isActive = (path: string, exact = false) => {
    if (exact) return pathname === path;
    return pathname.startsWith(path);
  };

  const handleOrgSwitch = async (targetOrgId: string) => {
    setOrgDropdownOpen(false);
    if (targetOrgId === currentOrg.id) return;
    try {
      const res = await fetch('/api/auth/switch-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: targetOrgId }),
      });
      if (res.ok) {
        router.push(`/orgs/${targetOrgId}`);
        router.refresh();
      }
    } catch {
      // fallback
      router.push(`/orgs/${targetOrgId}`);
    }
  };

  const navContent = (
    <div className="flex flex-col h-full justify-between">
      {/* Top Header & Org Switcher */}
      <div className="space-y-4">
        {/* Org Switcher Header */}
        <div className="relative">
          <button
            onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
            className="w-full flex items-center justify-between p-2 rounded-xl bg-panel hover:bg-panel-elevated border border-border-subtle hover:border-border-strong transition-all text-left"
            aria-expanded={orgDropdownOpen}
            aria-label="Switch organization"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center font-black text-sm text-accent shrink-0">
                {currentOrg.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-foreground truncate">
                  {currentOrg.name}
                </div>
                <div className="text-[10px] text-muted-foreground truncate font-mono">
                  {currentOrg.slug}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-panel-inset text-accent">
                {currentOrg.plan || 'Starter'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
          </button>

          {/* Org Switcher Dropdown */}
          {orgDropdownOpen && (
            <div
              className="absolute left-0 right-0 top-full mt-1.5 rounded-xl bg-panel-elevated border border-border-subtle shadow-2xl py-1.5 z-40 animate-in fade-in zoom-in-95"
              onMouseLeave={() => setOrgDropdownOpen(false)}
            >
              <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Your Organizations
              </div>

              {availableOrgs.map((org) => (
                <button
                  key={org.id}
                  onClick={() => handleOrgSwitch(org.id)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs text-foreground hover:bg-panel transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{org.name}</span>
                  </div>
                  {org.id === currentOrg.id && (
                    <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                  )}
                </button>
              ))}

              <div className="border-t border-border-subtle my-1" />

              <Link
                href="/onboarding"
                onClick={() => setOrgDropdownOpen(false)}
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-accent hover:bg-panel transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create New Organization</span>
              </Link>
            </div>
          )}
        </div>

        {/* Command Search Bar Trigger */}
        <button
          onClick={() => setIsCommandLauncherOpen(true)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle hover:border-accent/40 text-muted-foreground hover:text-foreground text-xs transition-all shadow-inner"
        >
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-accent" />
            <span>Search or jump to...</span>
          </div>
          <kbd className="px-1.5 py-0.5 rounded bg-panel-elevated border border-border-subtle text-[10px] font-mono text-muted-foreground">
            Ctrl+K
          </kbd>
        </button>

        {/* Navigation Sections */}
        <div className="space-y-4 pt-1">
          {/* Section: Personal */}
          <div>
            <div className="px-2 mb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Personal
            </div>
            <nav className="space-y-0.5">
              <Link
                href={`/orgs/${currentOrg.id}`}
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive(`/orgs/${currentOrg.id}`, true)
                    ? 'bg-accent text-accent-foreground font-bold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-panel'
                }`}
              >
                <Home className="w-4 h-4 shrink-0" />
                <span>Home</span>
              </Link>

              <Link
                href={`/orgs/${currentOrg.id}/my-tasks`}
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive(`/orgs/${currentOrg.id}/my-tasks`)
                    ? 'bg-accent text-accent-foreground font-bold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-panel'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <CheckSquare className="w-4 h-4 shrink-0" />
                  <span>My Tasks</span>
                </div>
              </Link>

              <Link
                href={`/orgs/${currentOrg.id}/inbox`}
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive(`/orgs/${currentOrg.id}/inbox`)
                    ? 'bg-accent text-accent-foreground font-bold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-panel'
                }`}
              >
                <Inbox className="w-4 h-4 shrink-0" />
                <span>Inbox</span>
              </Link>
            </nav>
          </div>

          {/* Section: Workspace / Company */}
          <div>
            <div className="px-2 mb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Workspace
            </div>
            <nav className="space-y-0.5">
              <Link
                href={`/orgs/${currentOrg.id}/teams`}
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive(`/orgs/${currentOrg.id}/teams`)
                    ? 'bg-accent text-accent-foreground font-bold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-panel'
                }`}
              >
                <Users className="w-4 h-4 shrink-0" />
                <span>Teams</span>
              </Link>

              <Link
                href={`/orgs/${currentOrg.id}/projects`}
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive(`/orgs/${currentOrg.id}/projects`)
                    ? 'bg-accent text-accent-foreground font-bold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-panel'
                }`}
              >
                <FolderGit2 className="w-4 h-4 shrink-0" />
                <span>Projects</span>
              </Link>

              <Link
                href={`/orgs/${currentOrg.id}/leadership`}
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive(`/orgs/${currentOrg.id}/leadership`)
                    ? 'bg-accent text-accent-foreground font-bold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-panel'
                }`}
              >
                <BarChart3 className="w-4 h-4 shrink-0" />
                <span>Leadership</span>
              </Link>

              <Link
                href={`/orgs/${currentOrg.id}/docs`}
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive(`/orgs/${currentOrg.id}/docs`)
                    ? 'bg-accent text-accent-foreground font-bold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-panel'
                }`}
              >
                <FileText className="w-4 h-4 shrink-0" />
                <span>Documents</span>
              </Link>

              <Link
                href={`/orgs/${currentOrg.id}/meetings`}
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive(`/orgs/${currentOrg.id}/meetings`)
                    ? 'bg-accent text-accent-foreground font-bold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-panel'
                }`}
              >
                <Video className="w-4 h-4 shrink-0" />
                <span>Meetings</span>
              </Link>

              <Link
                href={`/orgs/${currentOrg.id}/members`}
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive(`/orgs/${currentOrg.id}/members`)
                    ? 'bg-accent text-accent-foreground font-bold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-panel'
                }`}
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                <span>Members</span>
              </Link>
            </nav>
          </div>
        </div>
      </div>

      {/* Bottom Focus Card & User Pill */}
      <div className="space-y-3 pt-4 border-t border-border-subtle">
        {/* Daily Focus Reminder Card */}
        <div className="p-3 rounded-xl bg-panel border border-border-subtle flex items-start gap-2.5 text-xs shadow-inner">
          <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-foreground text-[11px]">
              Daily Focus
            </div>
            <p className="text-[10px] text-muted-foreground leading-normal mt-0.5">
              Review your tasks and meeting action approvals for today.
            </p>
          </div>
        </div>

        {/* User Account Menu Pill */}
        <AccountMenu user={user} orgId={currentOrg.id} />
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar (w-80 = 320px) */}
      <aside className="hidden lg:flex flex-col w-80 h-screen sticky top-0 bg-sidebar border-r border-border-subtle p-4 shrink-0 select-none">
        {navContent}
      </aside>

      {/* Mobile Drawer Navigation */}
      {isMobileSidebarOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigation drawer"
          className="fixed inset-0 z-50 lg:hidden flex"
        >
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
          <div className="relative z-10 w-80 max-w-[85vw] h-full bg-sidebar border-r border-border-subtle p-4 shadow-2xl flex flex-col justify-between">
            <button
              onClick={() => setIsMobileSidebarOpen(false)}
              className="absolute right-3 top-3 p-1.5 rounded-lg text-muted-foreground hover:text-foreground"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
            {navContent}
          </div>
        </div>
      )}
    </>
  );
}
