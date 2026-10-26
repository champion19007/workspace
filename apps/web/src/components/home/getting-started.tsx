'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Check, X } from 'lucide-react';
import { useShell } from '@/components/shell/shell-context';

const hiddenKey = (orgId: string) => `workspace_getting_started_done:${orgId}`;

/**
 * First-run checklist on Home. Each step is ticked from real data, and the card goes away for good once
 * every step is done or the viewer hides it (remembered per organization in this browser).
 */
export function GettingStarted() {
  const { orgId, projects, setIsHelpDrawerOpen } = useShell();
  const [hidden, setHidden] = useState(true); // read after mount, so a finished checklist never flashes
  const [docCount, setDocCount] = useState<number | null>(null);

  useEffect(() => {
    let done = false;
    try {
      done = localStorage.getItem(hiddenKey(orgId)) === '1';
    } catch {
      // Storage unavailable: show the checklist.
    }
    setHidden(done);
  }, [orgId]);

  useEffect(() => {
    if (hidden) return;
    fetch(`/api/orgs/${orgId}/docs`)
      .then((res) => (res.ok ? res.json() : { docs: [] }))
      .then((data: { docs?: unknown[] }) => setDocCount(data.docs?.length ?? 0))
      .catch(() => setDocCount(0));
  }, [orgId, hidden]);

  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(hiddenKey(orgId), '1');
    } catch {
      // Hidden for this visit only.
    }
  };

  const base = `/orgs/${orgId}`;
  const first = projects?.[0];
  const steps = [
    {
      title: 'Create your first project',
      text: 'A project holds its own tasks, board and docs. Freelancers often make one per client.',
      done: (projects?.length ?? 0) > 0,
      href: `${base}/projects?new=1`,
      cta: 'New project',
    },
    {
      title: 'Add the first tasks',
      text: 'Give each task an owner, a priority and a due date so nothing slips.',
      done: (projects ?? []).some((p) => p.taskCount > 0),
      href: first ? `${base}/projects/${first.id}/tasks` : `${base}/tasks`,
      cta: 'Open the list',
    },
    {
      title: 'Move work forward',
      text: 'Drag a card to In progress or Done on the board, or tick it off in the list.',
      done: (projects ?? []).some((p) => p.startedCount > 0),
      href: first ? `${base}/projects/${first.id}/board` : `${base}/board`,
      cta: 'Open the board',
    },
    {
      title: 'Write a doc',
      text: 'Keep the brief, kickoff notes or a checklist next to the work.',
      done: (docCount ?? 0) > 0,
      href: `${base}/docs`,
      cta: 'Open docs',
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  // Once the data says every step is done, remember it so later visits skip the docs request.
  useEffect(() => {
    if (allDone && projects !== null && docCount !== null) hide();
  }, [allDone, projects, docCount]);

  if (hidden || projects === null || docCount === null || allDone) return null;
  const next = steps.find((s) => !s.done);

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="getting-started-title">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="getting-started-title" className="font-semibold text-fg">
            Get started
          </h2>
          <p className="text-sm text-fg-muted">
            {doneCount} of {steps.length} done.{' '}
            <button type="button" onClick={() => setIsHelpDrawerOpen(true)} className="link inline-flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              How Workspace fits together
            </button>
          </p>
        </div>
        <button type="button" onClick={hide} aria-label="Hide the getting-started checklist" className="btn btn-ghost btn-icon btn-sm -mr-1.5 -mt-1">
          <X aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map((step, i) => (
          <li key={step.title} className={`flex gap-3 rounded-lg border p-3 ${step === next ? 'border-accent bg-accent-subtle/50' : 'border-border'}`}>
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                step.done ? 'bg-success text-white' : 'border border-border-strong text-fg-muted'
              }`}
              aria-hidden="true"
            >
              {step.done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 space-y-1">
              <p className={`text-sm font-medium ${step.done ? 'text-fg-muted line-through' : 'text-fg'}`}>
                {step.title}
                <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
              </p>
              {!step.done && (
                <>
                  <p className="text-sm text-fg-muted">{step.text}</p>
                  <Link href={step.href} className={step === next ? 'btn btn-primary btn-sm mt-1' : 'link text-sm'}>
                    {step.cta}
                  </Link>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
