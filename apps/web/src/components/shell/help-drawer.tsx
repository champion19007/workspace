'use client';

import React, { useState } from 'react';
import { Drawer } from '../ui/drawer';
import { useShell } from './shell-context';
import { ChevronDown } from 'lucide-react';
import { isReadOnlyRole } from '@workspace/core';

// A two-minute tour of how the pieces fit, in the order a new workspace is usually set up.
const GUIDE: { title: string; text: string }[] = [
  {
    title: 'Set up teams and projects',
    text: 'An organization holds teams, and each team holds projects. Start in the General team, and add a team per client or department when you need one.',
  },
  {
    title: 'Plan the work as tasks',
    text: "Add tasks in a project's List with an owner, a priority and a due date. Break big tasks into subtasks.",
  },
  {
    title: 'Track progress on the board',
    text: 'Drag cards between To do, In progress and Done, or tick tasks off in the list. Mark a task Blocked when it is waiting on something.',
  },
  {
    title: 'Keep notes and files together',
    text: "Write briefs and plans in a project's Docs, where every save keeps a version you can restore. Put contracts, designs and other files in its Files tab or on a task.",
  },
  {
    title: 'Talk where the work is',
    text: "Comment on a task, a doc or a project's Discussion and type @ to mention someone. The bell at the top shows your notifications.",
  },
  {
    title: 'Watch what needs attention',
    text: "My tasks lists everything assigned to you, soonest first. Insights shows which projects are at risk and what's overdue.",
  },
];

// Executives and Clients follow the work without doing it.
const READ_ONLY_GUIDE: { title: string; text: string }[] = [
  {
    title: 'Progress shows your projects',
    text: "Each card says how far along a project is, whether it's on track, and in one sentence what's happening.",
  },
  {
    title: 'What the colours mean',
    text: 'On track: nothing is late. Needs attention: work is due in the next few days. At risk: something is past its due date.',
  },
  {
    title: 'Open a project for the details',
    text: 'Its Overview counts the tasks that are to do, in progress, stuck and done, and lists recent changes. Docs holds the briefs and plans the team wrote.',
  },
  {
    title: 'Ask or comment any time',
    text: "Ask AI answers questions like \"what's late?\" from your projects. To ask the team, write in a project's Discussion or on a doc.",
  },
  {
    title: 'You can look, not change',
    text: "Apart from comments, you can't change anything. The organization's Owner or Managers chose your access level: ask them if you need to see another project.",
  },
];

const FAQS: { question: string; answer: string }[] = [
  {
    question: 'What are the access levels?',
    answer:
      "Owner: everything. Manager: runs projects and people, and decides which projects each client sees. Developer: does the work on projects, tasks and docs. Executive: sees how every project is going on the Progress page and can't change anything. Client: sees only the projects chosen for them, also read-only. Executives and clients can still comment and use Ask AI. The Owner or a Manager sets each person's level on People.",
  },
  {
    question: 'How do meeting notes get into Workspace?',
    answer:
      'Once Zoom is connected in Settings and a host has opted in, each recorded meeting is matched to a project after it ends. Workspace writes a summary, the decisions taken and suggested action items, each linked to the line of the transcript it came from.',
  },
  {
    question: "Can I get notes from a meeting that wasn't on Zoom?",
    answer:
      'Yes. On Meetings, choose Notes from a transcript and paste the transcript or your rough notes (or open a .txt or .vtt file). AI writes the notes and suggests tasks; you tick the ones to create and can save the notes as a doc.',
  },
  {
    question: 'How do clients or other teams ask us for work?',
    answer:
      "Turn on the Request form on a project's Overview and share its link. People fill it in without an account, and each request lands in your Inbox under Requests, where you accept it as a task or decline it.",
  },
  {
    question: 'How do comments and notifications work?',
    answer:
      "Everyone who can see a task, doc or project can comment on it, and @mentions only offer people who can read the comment. Clients and executives can comment on projects and docs, but task comments stay inside the team. The bell at the top shows your notifications, such as new requests.",
  },
  {
    question: 'Why do I have to approve suggested action items?',
    answer:
      'Suggestions never change your tasks on their own. They wait in your Inbox until someone approves, edits or rejects them, so the task list only contains work a person signed off on.',
  },
  {
    question: 'Who can see a project?',
    answer:
      'Public projects are visible to everyone in the organization except clients. Private projects are visible to their members and to Owners and Managers. Clients only ever see the projects an Owner or Manager chose for them.',
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
  const { user, isHelpDrawerOpen, setIsHelpDrawerOpen, setIsShortcutsDialogOpen } = useShell();
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const readOnly = isReadOnlyRole(user?.role);

  return (
    <Drawer
      isOpen={isHelpDrawerOpen}
      onClose={() => setIsHelpDrawerOpen(false)}
      title="Help"
      description="A short guide to Workspace, and answers to common questions."
    >
      <section aria-labelledby="help-guide-title" className="space-y-3">
        <h3 id="help-guide-title" className="text-sm font-semibold text-fg">
          How Workspace fits together
        </h3>
        <ol className="space-y-3">
          {(readOnly ? READ_ONLY_GUIDE : GUIDE).map((item, i) => (
            <li key={item.title} className="flex gap-3">
              <span
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-xs font-semibold text-accent-text"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-fg">{item.title}</p>
                <p className="text-sm leading-relaxed text-fg-muted">{item.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {!readOnly && (
        <section aria-labelledby="help-tips-title" className="space-y-2 rounded-lg bg-surface-2 p-3">
          <h3 id="help-tips-title" className="text-sm font-semibold text-fg">
            Tips
          </h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-muted">
            <li>
              <span className="font-medium text-fg">Project managers:</span> open Insights before your weekly check-in. It lists
              overdue and blocked work across every project.
            </li>
            <li>
              <span className="font-medium text-fg">Freelancers:</span> make one team per client and one project per engagement, so
              each client&apos;s tasks and docs stay together.
            </li>
            <li>
              Invite teammates, executives and clients from People, and choose there which projects each client sees. You get a
              link to send them.
            </li>
            <li>Press Ctrl K (⌘K on a Mac) to jump to any project or page.</li>
          </ul>
        </section>
      )}

      <h3 className="text-sm font-semibold text-fg">Common questions</h3>
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
