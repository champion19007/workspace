'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useShell } from './shell-context';
import { useTheme } from '../theme-provider';
import {
  Search,
  LayoutDashboard,
  ListTodo,
  Kanban,
  CheckSquare,
  Users,
  FolderGit2,
  FileText,
  Video,
  UserCheck,
  Settings,
  Palette,
  Sparkles,
} from 'lucide-react';

interface CommandItem {
  id: string;
  title: string;
  category: 'Navigation' | 'Theme' | 'Actions';
  icon: React.ReactNode;
  action: () => void;
}

export function CommandLauncher() {
  const router = useRouter();
  const params = useParams();
  const orgId = (params?.orgId as string) || '';

  const { isCommandLauncherOpen, setIsCommandLauncherOpen, setIsSettingsDrawerOpen } = useShell();
  const { setAccentColor, presets, resetAccentColor } = useTheme();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCommandLauncherOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isCommandLauncherOpen]);

  const items: CommandItem[] = [
    {
      id: 'nav-dashboard',
      title: 'Go to Project Dashboard',
      category: 'Navigation',
      icon: <LayoutDashboard className="w-4 h-4 text-accent" />,
      action: () => router.push(`/orgs/${orgId}`),
    },
    {
      id: 'nav-tasks',
      title: 'Go to Task List',
      category: 'Navigation',
      icon: <ListTodo className="w-4 h-4 text-accent" />,
      action: () => router.push(`/orgs/${orgId}/tasks`),
    },
    {
      id: 'nav-board',
      title: 'Go to Kanban Board',
      category: 'Navigation',
      icon: <Kanban className="w-4 h-4 text-accent" />,
      action: () => router.push(`/orgs/${orgId}/board`),
    },
    {
      id: 'nav-my-tasks',
      title: 'Go to My Tasks',
      category: 'Navigation',
      icon: <CheckSquare className="w-4 h-4 text-accent" />,
      action: () => router.push(`/orgs/${orgId}/my-tasks`),
    },
    {
      id: 'nav-teams',
      title: 'Go to Teams Directory',
      category: 'Navigation',
      icon: <Users className="w-4 h-4 text-accent" />,
      action: () => router.push(`/orgs/${orgId}/teams`),
    },
    {
      id: 'nav-projects',
      title: 'Go to Projects Directory',
      category: 'Navigation',
      icon: <FolderGit2 className="w-4 h-4 text-accent" />,
      action: () => router.push(`/orgs/${orgId}/projects`),
    },
    {
      id: 'nav-docs',
      title: 'Go to Documents',
      category: 'Navigation',
      icon: <FileText className="w-4 h-4 text-accent" />,
      action: () => router.push(`/orgs/${orgId}/docs`),
    },
    {
      id: 'nav-meetings',
      title: 'Go to Meetings',
      category: 'Navigation',
      icon: <Video className="w-4 h-4 text-accent" />,
      action: () => router.push(`/orgs/${orgId}/meetings`),
    },
    {
      id: 'nav-members',
      title: 'Go to Members Directory',
      category: 'Navigation',
      icon: <UserCheck className="w-4 h-4 text-accent" />,
      action: () => router.push(`/orgs/${orgId}/members`),
    },
    {
      id: 'nav-ask-ai',
      title: 'Ask AI Assistant (P1 Preview)',
      category: 'Navigation',
      icon: <Sparkles className="w-4 h-4 text-accent" />,
      action: () => router.push(`/orgs/${orgId}/chat`),
    },
    {
      id: 'action-settings',
      title: 'Open Settings Drawer',
      category: 'Actions',
      icon: <Settings className="w-4 h-4 text-accent" />,
      action: () => setIsSettingsDrawerOpen(true),
    },
    ...presets.map((preset) => ({
      id: `theme-${preset.hex}`,
      title: `Set Theme Accent: ${preset.name}`,
      category: 'Theme' as const,
      icon: (
        <span
          className="w-3.5 h-3.5 rounded-full inline-block"
          style={{ backgroundColor: preset.hex }}
        />
      ),
      action: () => setAccentColor(preset.hex),
    })),
    {
      id: 'theme-reset',
      title: 'Reset Theme Accent to Default Orchid (#d86dfc)',
      category: 'Theme',
      icon: <Palette className="w-4 h-4 text-accent" />,
      action: () => resetAccentColor(),
    },
  ];

  const filtered = items.filter((item) =>
    item.title.toLowerCase().includes(query.toLowerCase()) ||
    item.category.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = (item: CommandItem) => {
    setIsCommandLauncherOpen(false);
    item.action();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex]);
      }
    }
  };

  if (!isCommandLauncherOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4"
    >
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => setIsCommandLauncherOpen(false)}
      />

      <div className="relative z-10 w-full max-w-xl bg-panel border border-border-subtle rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border-subtle bg-panel-inset">
          <Search className="w-4 h-4 text-accent shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or jump to page..."
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="px-1.5 py-0.5 rounded bg-panel-elevated border border-border-subtle text-[10px] font-mono text-muted-foreground shrink-0">
            Esc
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 divide-y divide-border-subtle/40">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No matching commands or destinations found.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-xs transition-colors ${
                    isSelected
                      ? 'bg-panel-elevated text-accent font-semibold'
                      : 'text-foreground hover:bg-panel-elevated/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="shrink-0">{item.icon}</span>
                    <span className="truncate">{item.title}</span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground uppercase px-1.5 py-0.5 rounded bg-panel-inset border border-border-subtle">
                    {item.category}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border-subtle bg-panel-inset flex items-center justify-between text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-mono text-foreground">↑</kbd> <kbd className="font-mono text-foreground">↓</kbd> to navigate
            </span>
            <span>
              <kbd className="font-mono text-foreground">↵</kbd> to select
            </span>
          </div>
          <span>Workspace v1 Command Palette</span>
        </div>
      </div>
    </div>
  );
}
