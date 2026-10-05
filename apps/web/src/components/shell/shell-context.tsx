'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

interface ShellContextType {
  isSettingsDrawerOpen: boolean;
  setIsSettingsDrawerOpen: (open: boolean) => void;
  isHelpDrawerOpen: boolean;
  setIsHelpDrawerOpen: (open: boolean) => void;
  isShortcutsDialogOpen: boolean;
  setIsShortcutsDialogOpen: (open: boolean) => void;
  isCommandLauncherOpen: boolean;
  setIsCommandLauncherOpen: (open: boolean) => void;
  isMobileSidebarOpen: boolean;
  setIsMobileSidebarOpen: (open: boolean) => void;
  activeProjectScope: string;
  setActiveProjectScope: (id: string) => void;
}

const ShellContext = createContext<ShellContextType | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams();
  const orgId = params?.orgId as string | undefined;

  const [isSettingsDrawerOpen, setIsSettingsDrawerOpen] = useState(false);
  const [isHelpDrawerOpen, setIsHelpDrawerOpen] = useState(false);
  const [isShortcutsDialogOpen, setIsShortcutsDialogOpen] = useState(false);
  const [isCommandLauncherOpen, setIsCommandLauncherOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeProjectScope, setActiveProjectScope] = useState<string>('core-app');

  // Global keyboard shortcuts listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if user is typing in an input, textarea, or contentEditable element
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      // Escape always closes the topmost modal/drawer
      if (e.key === 'Escape') {
        if (isCommandLauncherOpen) {
          setIsCommandLauncherOpen(false);
          return;
        }
        if (isShortcutsDialogOpen) {
          setIsShortcutsDialogOpen(false);
          return;
        }
        if (isSettingsDrawerOpen) {
          setIsSettingsDrawerOpen(false);
          return;
        }
        if (isHelpDrawerOpen) {
          setIsHelpDrawerOpen(false);
          return;
        }
        if (isMobileSidebarOpen) {
          setIsMobileSidebarOpen(false);
          return;
        }
      }

      // Command launcher: Ctrl+K or Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandLauncherOpen((prev) => !prev);
        return;
      }

      // Ignore navigation shortcuts when inside form inputs
      if (isInput) return;

      // Shift+? opens keyboard shortcuts modal
      if (e.shiftKey && e.key === '?') {
        e.preventDefault();
        setIsShortcutsDialogOpen(true);
        return;
      }

      if (!orgId) return;

      // Navigation shortcuts
      if (e.shiftKey && e.key.toUpperCase() === 'D') {
        e.preventDefault();
        router.push(`/orgs/${orgId}`);
        return;
      }

      if (e.shiftKey && e.key.toUpperCase() === 'L') {
        e.preventDefault();
        router.push(`/orgs/${orgId}/tasks`);
        return;
      }

      if (e.shiftKey && e.key.toUpperCase() === 'B') {
        e.preventDefault();
        router.push(`/orgs/${orgId}/board`);
        return;
      }

      if (e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        router.push(`/orgs/${orgId}/my-tasks`);
        return;
      }

      if (e.altKey && e.shiftKey && e.key.toUpperCase() === 'T') {
        e.preventDefault();
        router.push(`/orgs/${orgId}/teams`);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    orgId,
    router,
    isCommandLauncherOpen,
    isShortcutsDialogOpen,
    isSettingsDrawerOpen,
    isHelpDrawerOpen,
    isMobileSidebarOpen,
  ]);

  return (
    <ShellContext.Provider
      value={{
        isSettingsDrawerOpen,
        setIsSettingsDrawerOpen,
        isHelpDrawerOpen,
        setIsHelpDrawerOpen,
        isShortcutsDialogOpen,
        setIsShortcutsDialogOpen,
        isCommandLauncherOpen,
        setIsCommandLauncherOpen,
        isMobileSidebarOpen,
        setIsMobileSidebarOpen,
        activeProjectScope,
        setActiveProjectScope,
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
