'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useShell } from './shell-context';
import { useTheme } from '../theme-provider';
import { trapTabKey } from '../ui/dialog';
import {
  Search,
  Home,
  CircleCheck,
  Inbox,
  FolderKanban,
  ListTodo,
  FileText,
  Video,
  Users,
  UserRound,
  BarChart3,
  Settings,
  Sun,
  Moon,
  Monitor,
  Keyboard,
  CircleHelp,
  CornerDownLeft,
} from 'lucide-react';

interface CommandItem {
  id: string;
  title: string;
  group: 'Go to' | 'Projects' | 'Theme' | 'Help';
  icon: React.ReactNode;
  keywords?: string;
  action: () => void;
}

export function CommandLauncher() {
  const router = useRouter();
  const { orgId, projects, isCommandLauncherOpen, setIsCommandLauncherOpen, setIsShortcutsDialogOpen, setIsHelpDrawerOpen } =
    useShell();
  const { setTheme, setAccentColor, presets } = useTheme();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (isCommandLauncherOpen) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isCommandLauncherOpen]);

  const items = useMemo<CommandItem[]>(() => {
    const go = (path: string) => () => router.push(`/orgs/${orgId}${path}`);
    const icon = (Icon: typeof Home) => <Icon className="h-4 w-4" aria-hidden="true" />;
    return [
      { id: 'home', title: 'Home', group: 'Go to', icon: icon(Home), keywords: 'dashboard overview', action: go('') },
      { id: 'my-tasks', title: 'My tasks', group: 'Go to', icon: icon(CircleCheck), keywords: 'assigned due', action: go('/my-tasks') },
      { id: 'inbox', title: 'Inbox', group: 'Go to', icon: icon(Inbox), keywords: 'approvals suggestions', action: go('/inbox') },
      { id: 'projects', title: 'Projects', group: 'Go to', icon: icon(FolderKanban), action: go('/projects') },
      { id: 'tasks', title: 'All tasks', group: 'Go to', icon: icon(ListTodo), keywords: 'list', action: go('/tasks') },
      { id: 'docs', title: 'Docs', group: 'Go to', icon: icon(FileText), keywords: 'documents', action: go('/docs') },
      { id: 'meetings', title: 'Meetings', group: 'Go to', icon: icon(Video), keywords: 'zoom transcripts notes', action: go('/meetings') },
      { id: 'teams', title: 'Teams', group: 'Go to', icon: icon(Users), action: go('/teams') },
      { id: 'people', title: 'People', group: 'Go to', icon: icon(UserRound), keywords: 'members invite', action: go('/members') },
      { id: 'insights', title: 'Insights', group: 'Go to', icon: icon(BarChart3), keywords: 'leadership health risk', action: go('/leadership') },
      { id: 'settings', title: 'Settings', group: 'Go to', icon: icon(Settings), keywords: 'appearance integrations zoom', action: go('/settings') },
      ...(projects ?? []).map((p) => ({
        id: `project-${p.id}`,
        title: p.name,
        group: 'Projects' as const,
        icon: icon(FolderKanban),
        keywords: p.teamName ?? '',
        action: go(`/projects/${p.id}/dashboard`),
      })),
      { id: 'theme-light', title: 'Light theme', group: 'Theme', icon: icon(Sun), action: () => setTheme('light') },
      { id: 'theme-dark', title: 'Dark theme', group: 'Theme', icon: icon(Moon), action: () => setTheme('dark') },
      { id: 'theme-system', title: 'Match system theme', group: 'Theme', icon: icon(Monitor), action: () => setTheme('system') },
      ...presets.map((preset) => ({
        id: `accent-${preset.hex}`,
        title: `Accent colour: ${preset.name}`,
        group: 'Theme' as const,
        icon: <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: preset.hex }} aria-hidden="true" />,
        action: () => setAccentColor(preset.hex),
      })),
      { id: 'shortcuts', title: 'Keyboard shortcuts', group: 'Help', icon: icon(Keyboard), action: () => setIsShortcutsDialogOpen(true) },
      { id: 'help', title: 'Help', group: 'Help', icon: icon(CircleHelp), action: () => setIsHelpDrawerOpen(true) },
    ];
  }, [orgId, projects, presets, router, setTheme, setAccentColor, setIsShortcutsDialogOpen, setIsHelpDrawerOpen]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((item) => `${item.title} ${item.group} ${item.keywords ?? ''}`.toLowerCase().includes(q))
    : items;

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
      const item = filtered[selectedIndex];
      if (item) handleSelect(item);
    } else if (e.key === 'Tab') {
      trapTabKey(e.nativeEvent, panelRef.current);
    }
  };

  // Keep the highlighted option visible while arrowing through a long list.
  useEffect(() => {
    document.getElementById(`${listId}-${selectedIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, listId]);

  if (!isCommandLauncherOpen) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Command menu" className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="fixed inset-0 animate-fade-in bg-overlay/50" onClick={() => setIsCommandLauncherOpen(false)} aria-hidden="true" />

      <div ref={panelRef} className="relative z-10 w-full max-w-xl animate-pop-in overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={filtered.length ? `${listId}-${selectedIndex}` : undefined}
            aria-label="Search commands and pages"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, projects and commands"
            className="h-12 w-full bg-transparent text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none"
          />
          <kbd className="kbd shrink-0">Esc</kbd>
        </div>

        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[min(24rem,60vh)] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <li className="px-3 py-10 text-center text-sm text-fg-muted">No pages or commands match “{query}”.</li>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const showGroup = idx === 0 || filtered[idx - 1]!.group !== item.group;
              return (
                <React.Fragment key={item.id}>
                  {showGroup && (
                    <li role="presentation" className="px-2.5 pb-1 pt-2.5 text-xs font-medium text-fg-subtle">
                      {item.group}
                    </li>
                  )}
                  <li
                    id={`${listId}-${idx}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(item)}
                    onMouseMove={() => setSelectedIndex(idx)}
                    className={`flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm ${
                      isSelected ? 'bg-surface-2 text-fg' : 'text-fg-muted'
                    }`}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{item.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {isSelected && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />}
                  </li>
                </React.Fragment>
              );
            })
          )}
        </ul>

        <div className="hidden items-center gap-4 border-t border-border bg-surface-2 px-4 py-2 text-xs text-fg-muted sm:flex">
          <span className="flex items-center gap-1">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> to move
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">Enter</kbd> to open
          </span>
        </div>
      </div>
    </div>
  );
}
