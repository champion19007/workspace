'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { User, Settings, LogOut, MoreVertical, Shield } from 'lucide-react';
import { useShell } from './shell-context';

export interface UserSessionInfo {
  id: string;
  name?: string;
  email: string;
  role: string;
}

export function AccountMenu({
  user,
  orgId,
}: {
  user: UserSessionInfo;
  orgId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const { setIsSettingsDrawerOpen } = useShell();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }
  }, [isOpen]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    } finally {
      router.push('/auth/login');
    }
  };

  const displayName = user.name || user.email.split('@')[0];
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div ref={containerRef} className="relative">
      {/* Popover Menu Anchored Above the Pill */}
      {isOpen && (
        <div
          role="menu"
          aria-label="User Account Menu"
          className="absolute bottom-full left-0 mb-2 w-64 rounded-xl bg-panel-elevated border border-border-subtle shadow-2xl py-2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-border-subtle">
            <div className="text-xs font-bold text-foreground truncate">
              {displayName}
            </div>
            <div className="text-[11px] text-muted-foreground truncate font-mono">
              {user.email}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-panel-inset text-accent border border-border-subtle">
                <Shield className="w-3 h-3" />
                {user.role}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="py-1">
            <Link
              href={`/orgs/${orgId}/profile`}
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-foreground hover:bg-panel hover:text-accent transition-colors"
            >
              <User className="w-4 h-4 text-muted-foreground" />
              <span>Profile Settings</span>
            </Link>

            <button
              onClick={() => {
                setIsOpen(false);
                setIsSettingsDrawerOpen(true);
              }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-foreground hover:bg-panel hover:text-accent transition-colors text-left"
            >
              <Settings className="w-4 h-4 text-muted-foreground" />
              <span>Preferences & Theme</span>
            </button>
          </div>

          <div className="border-t border-border-subtle my-1" />

          {/* Sign out */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition-colors text-left"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      )}

      {/* User Pill Button (Bottom of Sidebar) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between p-2.5 rounded-xl bg-panel hover:bg-panel-elevated border border-border-subtle hover:border-border-strong transition-all text-left group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center font-bold text-xs text-accent shrink-0">
            {initial}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground truncate group-hover:text-accent transition-colors">
              {displayName}
            </div>
            <div className="text-[11px] text-muted-foreground truncate font-mono">
              {user.email}
            </div>
          </div>
        </div>

        <MoreVertical className="w-4 h-4 text-muted-foreground group-hover:text-foreground shrink-0 transition-colors" />
      </button>
    </div>
  );
}
