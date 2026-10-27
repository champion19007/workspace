'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { ProgressSummaryDTO } from '@workspace/core';
import { Alert } from '@/components/ui/states';
import { formatRelativeTime } from '@/lib/format';

/** A short written update on the projects below, for people who'd rather read than read numbers. */
export function ProgressSummaryCard({ orgId }: { orgId: string }) {
  // undefined while loading; null when nothing has been written for these projects yet.
  const [summary, setSummary] = useState<ProgressSummaryDTO | null | undefined>(undefined);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/orgs/${orgId}/ai/progress-summary`;

  const load = useCallback(async () => {
    const res = await fetch(url).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setSummary(res?.ok ? body.summary : null);
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  const write = async () => {
    setWriting(true);
    setError(null);
    try {
      const res = await fetch(url, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || "The summary couldn't be written.");
      setSummary(body.summary);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWriting(false);
    }
  };

  if (summary === undefined) return <div className="skeleton h-24 w-full" />;

  return (
    <section aria-labelledby="ai-summary-heading" className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ai-summary-heading" className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Sparkles className="h-4 w-4 text-accent-text" aria-hidden="true" />
          In plain words
        </h2>
        {summary && summary.demo && <span className="text-xs font-medium text-warning">Demo: no AI key is set</span>}
      </div>

      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

      {summary ? (
        <div className="space-y-2" aria-live="polite">
          <p className="font-medium text-fg">{summary.headline}</p>
          {summary.paragraphs.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-fg">
              {p}
            </p>
          ))}
          {summary.watch.length > 0 && (
            <div className="pt-1">
              <p className="text-sm font-medium text-fg">Worth asking the team about</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-fg">
                {summary.watch.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-fg-muted">
            Written by AI {formatRelativeTime(summary.createdAt)} from the numbers on this page. Check anything important with the team.{' '}
            <button type="button" onClick={write} disabled={writing} className="font-medium text-accent-text hover:underline disabled:opacity-60">
              {writing ? 'Writing…' : 'Write a new one'}
            </button>
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fg-muted">Get a short written update on how your projects are going, from the numbers below.</p>
          <button type="button" onClick={write} disabled={writing} className="btn btn-secondary btn-sm">
            {writing ? 'Writing…' : 'Write a summary'}
          </button>
        </div>
      )}
    </section>
  );
}
