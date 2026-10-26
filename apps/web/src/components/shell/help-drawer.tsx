'use client';

import React, { useState } from 'react';
import { Drawer } from '../ui/drawer';
import { useShell } from './shell-context';
import { ChevronDown } from 'lucide-react';

const FAQS: { question: string; answer: string }[] = [
  {
    question: 'How do meeting notes get into Workspace?',
    answer:
      'Once Zoom is connected in Settings and a host has opted in, each recorded meeting is matched to a project after it ends. Workspace writes a summary, the decisions taken and suggested action items, each linked to the line of the transcript it came from.',
  },
  {
    question: 'Why do I have to approve suggested action items?',
    answer:
      'Suggestions never change your tasks on their own. They wait in your Inbox until someone approves, edits or rejects them, so the task list only contains work a person signed off on.',
  },
  {
    question: 'Who can see a project?',
    answer:
      'Public projects are visible to everyone in the organization. Private projects are visible to their members and to organization owners and admins.',
  },
  {
    question: 'Can I use the keyboard?',
    answer:
      'Press Ctrl K (⌘K on a Mac) to search and jump anywhere, and Shift + ? to see every shortcut. All controls can be reached with Tab and show a visible focus ring.',
  },
  {
    question: 'How do I switch to the light or dark theme?',
    answer:
      'Use the sun/moon button in the top bar, or choose Light, Dark or System in your account menu. Settings › Appearance also lets you pick an accent colour; Workspace keeps text in that colour readable in both themes.',
  },
];

export function HelpDrawer() {
  const { isHelpDrawerOpen, setIsHelpDrawerOpen, setIsShortcutsDialogOpen } = useShell();
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <Drawer
      isOpen={isHelpDrawerOpen}
      onClose={() => setIsHelpDrawerOpen(false)}
      title="Help"
      description="Answers to common questions about Workspace."
    >
      <div className="card divide-y divide-border overflow-hidden">
        {FAQS.map((faq, idx) => {
          const isOpen = openIndex === idx;
          const panelId = `help-answer-${idx}`;
          return (
            <div key={faq.question}>
              <h3>
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : idx)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-medium text-fg transition-colors hover:bg-surface-2"
                >
                  {faq.question}
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-fg-subtle transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              </h3>
              {isOpen && (
                <p id={panelId} className="px-4 pb-4 text-sm leading-relaxed text-fg-muted">
                  {faq.answer}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => {
          setIsHelpDrawerOpen(false);
          setIsShortcutsDialogOpen(true);
        }}
        className="btn btn-secondary w-full"
      >
        Show keyboard shortcuts
      </button>
    </Drawer>
  );
}
