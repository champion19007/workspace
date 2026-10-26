'use client';

import React from 'react';
import { Dialog } from '../ui/dialog';
import { useShell } from './shell-context';

const SHORTCUT_GROUPS: { name: string; shortcuts: { keys: string[]; description: string }[] }[] = [
  {
    name: 'Anywhere',
    shortcuts: [
      { keys: ['Ctrl', 'K'], description: 'Search and jump to a page' },
      { keys: ['Shift', '?'], description: 'Show keyboard shortcuts' },
      { keys: ['Esc'], description: 'Close the open panel or menu' },
    ],
  },
  {
    name: 'Go to',
    shortcuts: [
      { keys: ['Shift', 'D'], description: 'Home' },
      { keys: ['Alt', 'M'], description: 'My tasks' },
      { keys: ['Shift', 'L'], description: 'All tasks' },
      { keys: ['Shift', 'B'], description: 'Board' },
      { keys: ['Alt', 'Shift', 'T'], description: 'Teams' },
    ],
  },
];

export function ShortcutsDialog() {
  const { isShortcutsDialogOpen, setIsShortcutsDialogOpen } = useShell();

  return (
    <Dialog
      isOpen={isShortcutsDialogOpen}
      onClose={() => setIsShortcutsDialogOpen(false)}
      title="Keyboard shortcuts"
      description="Single-key shortcuts are paused while you type in a field."
      maxWidthClass="max-w-md"
    >
      <div className="space-y-5">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.name} className="space-y-2">
            <h3 className="text-xs font-medium text-fg-subtle">{group.name}</h3>
            <dl className="card divide-y divide-border overflow-hidden">
              {group.shortcuts.map((sc) => (
                <div key={sc.description} className="flex items-center justify-between gap-4 px-3.5 py-2.5 text-sm">
                  <dt className="text-fg">{sc.description}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {sc.keys.map((k) => (
                      <kbd key={k} className="kbd">
                        {k}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
