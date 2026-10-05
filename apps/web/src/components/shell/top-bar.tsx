'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Menu,
  HelpCircle,
  Command,
  Settings,
  Sparkles,
  LayoutDashboard,
  ListTodo,
  Kanban,
  FileText,
  Video,
} from 'lucide-react';
import { useShell } from './shell-context';

interface TopBarProps {
  orgId: string;
  orgName?: string;
  projectName?: string;
}

export function TopBar({ orgId, orgName = 'Organisation', projectName = 'Core Workspace' }: TopBarProps) {
  const pathname = usePathname();
  const {
    setIsSettingsDrawerOpen,
    setIsHelpDrawerOpen,
    setIsShortcutsDialogOpen,
    setIsMobileSidebarOpen,
  } = useShell();

  // Determine active project tab
  const isDashboard =
    pathname === `/orgs/${orgId}` ||
    pathname.includes('/dashboard');
  const isList = pathname.includes('/tasks') && !pathname.includes('/my-tasks');
  const isBoard = pathname.includes('/board');
  const isDocs = pathname.includes('/docs');
  const isMeetings = pathname.includes('/meetings');

  return (
    <header className="sticky top-0 z-30 h-16 bg-panel/80 backdrop-blur-md border-b border-border-subtle px-4 lg:px-6 flex items-center justify-between gap-4">
      {/* Left: Mobile Toggle & Project Context */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={() => setIsMobileSidebarOpen(true)}
          aria-label="Open sidebar menu"
          className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-elevated"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-xs truncate">
          <span className="font-semibold text-foreground truncate">{orgName}</span>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium text-muted-foreground truncate">{projectName}</span>
        </div>
      </div>

      {/* Center: Horizontal View Switcher Pills (Matching Screenshots 927 & 928) */}
      <nav aria-label="Project views" className="hidden sm:flex items-center gap-1 bg-panel-inset p-1 rounded-xl border border-border-subtle">
        <Link
          href={`/orgs/${orgId}`}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            isDashboard
              ? 'bg-accent text-accent-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-panel-elevated'
          }`}
        >
          <LayoutDashboard className="w-3.5 h-3.5" />
          <span>Dashboard</span>
        </Link>

        <Link
          href={`/orgs/${orgId}/tasks`}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            isList
              ? 'bg-accent text-accent-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-panel-elevated'
          }`}
        >
          <ListTodo className="w-3.5 h-3.5" />
          <span>List</span>
        </Link>

        <Link
          href={`/orgs/${orgId}/board`}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            isBoard
              ? 'bg-accent text-accent-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-panel-elevated'
          }`}
        >
          <Kanban className="w-3.5 h-3.5" />
          <span>Board</span>
        </Link>

        <Link
          href={`/orgs/${orgId}/docs`}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            isDocs
              ? 'bg-accent text-accent-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-panel-elevated'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Documents</span>
        </Link>

        <Link
          href={`/orgs/${orgId}/meetings`}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            isMeetings
              ? 'bg-accent text-accent-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-panel-elevated'
          }`}
        >
          <Video className="w-3.5 h-3.5" />
          <span>Meetings</span>
        </Link>
      </nav>

      {/* Right: Utility Actions */}
      <div className="flex items-center gap-2">
        {/* Ask AI Pill (Flagged P1) */}
        <Link
          href={`/orgs/${orgId}/chat`}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-panel-elevated border border-border-subtle hover:border-accent/50 text-xs font-medium text-foreground transition-all"
        >
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          <span className="hidden md:inline">Ask AI</span>
          <span className="text-[10px] font-mono font-bold px-1 py-0.2 rounded bg-accent/20 text-accent">
            P1
          </span>
        </Link>

        {/* Keyboard Shortcuts Trigger */}
        <button
          onClick={() => setIsShortcutsDialogOpen(true)}
          aria-label="Keyboard Shortcuts"
          title="Keyboard Shortcuts (Shift+?)"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-elevated transition-colors"
        >
          <Command className="w-4 h-4" />
        </button>

        {/* Help Drawer Trigger */}
        <button
          onClick={() => setIsHelpDrawerOpen(true)}
          aria-label="Help and Documentation"
          title="Help & FAQ"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-elevated transition-colors"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        {/* Settings Drawer Trigger */}
        <button
          onClick={() => setIsSettingsDrawerOpen(true)}
          aria-label="Settings and Preferences"
          title="Appearance & Settings"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-elevated transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
