'use client';

import React, { useState } from 'react';
import { Drawer } from '../ui/drawer';
import { useShell } from './shell-context';
import { ChevronDown, Sparkles, ShieldCheck, Keyboard, HelpCircle } from 'lucide-react';

interface FaqItem {
  question: string;
  answer: string;
  icon: React.ReactNode;
}

const FAQS: FaqItem[] = [
  {
    question: 'How does Workspace v1 process Zoom meetings?',
    answer:
      'When your Zoom meeting concludes, the webhook intake engine ingests the cloud recording transcript. The pipeline normalizes dialogue segments and utilizes LLM prompts with evidence grounding to extract meeting summaries and prospective action items.',
    icon: <Sparkles className="w-4 h-4 text-accent" />,
  },
  {
    question: 'How does human approval protect my tasks?',
    answer:
      'AI cannot create or modify project tasks autonomously. All extracted action items land in your suggestions inbox. An explicit human decision (Approve, Edit, or Reject) is mandatory before any task is written to the database.',
    icon: <ShieldCheck className="w-4 h-4 text-emerald-400" />,
  },
  {
    question: 'What keyboard shortcuts are available?',
    answer:
      'Use Ctrl+K to open the Command Launcher. Press Shift+? anywhere to view the full shortcut dialog. Quick view jumps include Shift+D for Dashboard, Shift+L for Task List, and Shift+B for Kanban Board.',
    icon: <Keyboard className="w-4 h-4 text-indigo-400" />,
  },
  {
    question: 'How is organization data isolated?',
    answer:
      'Workspace v1 enforces PostgreSQL Row-Level Security (RLS) on all tenant tables with an unprivileged database role. Compound foreign keys guarantee cross-tenant boundaries cannot be breached.',
    icon: <ShieldCheck className="w-4 h-4 text-accent" />,
  },
  {
    question: 'How do I change the interface accent color?',
    answer:
      'Click the Settings gear icon in the top right or open Settings from the user menu. Choose from presets or enter any hex color. High-contrast foregrounds are calculated automatically.',
    icon: <HelpCircle className="w-4 h-4 text-amber-400" />,
  },
];

export function HelpDrawer() {
  const { isHelpDrawerOpen, setIsHelpDrawerOpen } = useShell();
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <Drawer
      isOpen={isHelpDrawerOpen}
      onClose={() => setIsHelpDrawerOpen(false)}
      title="Help & Documentation"
      description="Learn how Workspace v1 organizes teams, tasks, and meeting intelligence."
    >
      <div className="space-y-3">
        {FAQS.map((faq, idx) => {
          const isOpen = openIndex === idx;
          return (
            <div
              key={idx}
              className="rounded-xl border border-border-subtle bg-panel overflow-hidden transition-all"
            >
              <button
                onClick={() => toggle(idx)}
                aria-expanded={isOpen}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-panel-elevated transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <span className="shrink-0">{faq.icon}</span>
                  <span className="text-xs font-semibold text-foreground truncate">
                    {faq.question}
                  </span>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${
                    isOpen ? 'transform rotate-180 text-accent' : ''
                  }`}
                />
              </button>

              {isOpen && (
                <div className="px-4 pb-4 pt-1 text-xs text-muted-foreground leading-relaxed border-t border-border-subtle/50 bg-panel-inset">
                  {faq.answer}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 p-4 rounded-xl bg-panel-inset border border-border-subtle text-center">
        <p className="text-xs text-muted-foreground mb-2">Need additional assistance?</p>
        <span className="text-xs font-mono font-semibold text-accent">
          support@workspace-v1.local
        </span>
      </div>
    </Drawer>
  );
}
