'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Bell, Inbox, RotateCw } from 'lucide-react';
import type { ActionItemDTO } from '@workspace/core';
import { EmptyState } from '@/components/ui/table-shell';
import { ActionItemCard } from '@/components/approvals/ActionItemCard';

type Scope = 'mine' | 'all';

export default function InboxPage() {
  const params = useParams();
  const orgId = params.orgId as string;

  const [scope, setScope] = useState<Scope>('mine');
  const [items, setItems] = useState<ActionItemDTO[]>([]);
  const [endCursor, setEndCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ state: 'suggested', limit: '25' });
        if (scope === 'mine') qs.set('assignee', 'me');
        if (cursor) qs.set('cursor', cursor);
        const res = await fetch(`/api/orgs/${orgId}/action-items?${qs}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load suggestions');
        setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
        setEndCursor(data.pageInfo?.hasNextPage ? data.pageInfo.endCursor : null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [orgId, scope]
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const pending = items.filter((i) => i.state === 'suggested').length;
  const scopeButton = (value: Scope, label: string) => (
    <button
      type="button"
      aria-pressed={scope === value}
      onClick={() => setScope(value)}
      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
        scope === value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">Inbox</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          AI suggestions from meetings become or change tasks only after a person approves them.
        </p>
      </div>

      <section aria-labelledby="approvals-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 id="approvals-heading" className="text-sm font-bold text-foreground">
            Approvals{' '}
            {/* The list API returns no total: while more pages exist the loaded count is only a lower bound. */}
            {!loading && !error && (
              <span className="text-muted-foreground font-medium">({`${pending}${endCursor ? '+' : ''}`} awaiting decision)</span>
            )}
          </h2>
          <div role="group" aria-label="Which suggestions to show" className="inline-flex p-0.5 rounded-lg bg-panel border border-border-subtle self-start">
            {scopeButton('mine', 'Suggested for me')}
            {scopeButton('all', 'All I can review')}
          </div>
        </div>

        {error ? (
          <div role="alert" className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-200">
            {error}
          </div>
        ) : loading && items.length === 0 ? (
          <p role="status" className="p-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <RotateCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading suggestions…
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Nothing to review"
            description={
              scope === 'mine'
                ? 'No open meeting suggestions name you as the owner. Switch to "All I can review" to see the rest.'
                : 'There are no open meeting suggestions in projects you can access.'
            }
          />
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <ActionItemCard
                key={item.id}
                item={item}
                orgId={orgId}
                showMeeting
                onItemChange={(updated) => setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))}
              />
            ))}
            {endCursor && (
              <button
                type="button"
                onClick={() => void load(endCursor)}
                disabled={loading}
                className="w-full px-4 py-2 rounded-lg border border-border-subtle text-xs text-foreground hover:bg-panel-elevated disabled:opacity-50"
              >
                {loading ? 'Loading…' : 'Load more suggestions'}
              </button>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="notifications-heading" className="space-y-3">
        <h2 id="notifications-heading" className="text-sm font-bold text-foreground">
          Notifications
        </h2>
        <EmptyState
          icon={Bell}
          title="Notifications are not available yet"
          description="Mentions, assignments and due-date reminders will appear here once notifications are built (roadmap Stage 19)."
        />
      </section>
    </div>
  );
}
