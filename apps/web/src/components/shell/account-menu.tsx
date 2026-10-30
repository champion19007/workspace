'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { User, Settings, LogOut, ChevronsUpDown, Keyboard, Sun, Moon, Monitor, Check } from 'lucide-react';
import { useShell } from './shell-context';
import { useTheme, type ThemePreference } from '../theme-provider';
import { Avatar } from '../ui/avatar';
import { useDismiss } from '../ui/use-dismiss';

export interface UserSessionInfo {
  id: string;
  name?: string;
  email: string;
  role: string;
}

/** "maya.chen@x" -> "Maya Chen": the session carries only the email. */
export function displayNameFromEmail(email: string): string {
  return email
    .split('@')[0]!
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function AccountMenu({ user, orgId }: { user: UserSessionInfo | null; orgId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const { setIsShortcutsDialogOpen } = useShell();
  const { theme, setTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  useDismiss(isOpen, () => setIsOpen(false), containerRef);

  if (!user) {
    return (
      <div className="flex h-11 items-center gap-2.5 px-1.5" aria-hidden="true">
        <div className="skeleton h-8 w-8 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton h-2.5 w-32" />
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore: the session cookie is cleared server-side either way on next request
    } finally {
      router.push('/auth/login');
    }
  };

  const displayName = user.name || displayNameFromEmail(user.email);

  return (
    <div ref={containerRef} className="relative">
      {isOpen && (
        <div role="menu" aria-label="Account" className="menu bottom-full left-0 right-0 mb-1.5">
          <div className="border-b border-border px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium text-fg">{displayName}</p>
            <p className="truncate text-xs text-fg-muted">{user.email}</p>
          </div>
          <div className="py-1">
            <Link href={`/orgs/${orgId}/profile`} role="menuitem" onClick={() => setIsOpen(false)} className="menu-item">
              <User aria-hidden="true" />
              Profile
            </Link>
            <Link href={`/orgs/${orgId}/settings`} role="menuitem" onClick={() => setIsOpen(false)} className="menu-item">
              <Settings aria-hidden="true" />
              Settings
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                setIsShortcutsDialogOpen(true);
              }}
              className="menu-item"
            >
              <Keyboard aria-hidden="true" />
              Keyboard shortcuts
            </button>
          </div>
          <div className="menu-sep" />
          <div className="menu-label">Theme</div>
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === value}
              onClick={() => setTheme(value)}
              className="menu-item"
            >
              <Icon aria-hidden="true" />
              <span className="flex-1">{label}</span>
              {theme === value && <Check className="!text-accent-text" aria-hidden="true" />}
            </button>
          ))}
          <div className="menu-sep" />
          <button type="button" role="menuitem" onClick={handleLogout} className="menu-item">
            <LogOut aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-surface-2"
      >
        <Avatar name={displayName} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{displayName}</span>
          <span className="block truncate text-xs text-fg-muted">{user.email}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
      </button>
    </div>
  );
}
