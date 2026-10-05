'use client';

import React from 'react';
import { Dialog } from '../ui/dialog';
import { useShell } from './shell-context';
import { Compass, Layout, Zap } from 'lucide-react';

interface ShortcutGroup {
  name: string;
  icon: React.ReactNode;
  shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    name: 'Global & System',
    icon: <Zap className="w-4 h-4 text-accent" />,
    shortcuts: [
      { keys: ['Ctrl', 'K'], description: 'Open Command Palette / Search' },
      { keys: ['Shift', '?'], description: 'Show Keyboard Shortcuts' },
      { keys: ['Esc'], description: 'Close active drawer, modal, or popover' },
    ],
  },
  {
    name: 'Views & Navigation',
    icon: <Compass className="w-4 h-4 text-indigo-400" />,
    shortcuts: [
      { keys: ['Shift', 'D'], description: 'Jump to Project Dashboard' },
      { keys: ['Shift', 'L'], description: 'Jump to Project Task List' },
      { keys: ['Shift', 'B'], description: 'Jump to Project Kanban Board' },
      { keys: ['Alt', 'M'], description: 'Jump to My Tasks' },
      { keys: ['Alt', 'Shift', 'T'], description: 'Jump to Teams Directory' },
    ],
  },
  {
    name: 'Interface Actions',
    icon: <Layout className="w-4 h-4 text-emerald-400" />,
    shortcuts: [
      { keys: ['Tab'], description: 'Cycle through focusable elements' },
      { keys: ['Enter'], description: 'Select / Execute active item' },
    ],
  },
];

export function ShortcutsDialog() {
  const { isShortcutsDialogOpen, setIsShortcutsDialogOpen } = useShell();

  return (
    <Dialog
      isOpen={isShortcutsDialogOpen}
      onClose={() => setIsShortcutsDialogOpen(false)}
      title="Keyboard Shortcuts"
      description="Navigate rapidly across Workspace v1 without using your mouse."
      maxWidthClass="max-w-lg"
    >
      <div className="space-y-5">
        {SHORTCUT_GROUPS.map((group, idx) => (
          <div key={idx} className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider">
              {group.icon}
              <span>{group.name}</span>
            </div>

            <div className="rounded-xl border border-border-subtle bg-panel-inset divide-y divide-border-subtle overflow-hidden">
              {group.shortcuts.map((sc, sIdx) => (
                <div
                  key={sIdx}
                  className="flex items-center justify-between p-2.5 text-xs"
                >
                  <span className="text-muted-foreground">{sc.description}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {sc.keys.map((k, kIdx) => (
                      <kbd
                        key={kIdx}
                        className="px-2 py-0.5 rounded-md bg-panel-elevated border border-border-subtle text-[11px] font-mono font-semibold text-foreground shadow-sm"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 text-center text-[11px] text-muted-foreground">
        Shortcuts are automatically disabled when typing in form fields or search inputs.
      </div>
    </Dialog>
  );
}
