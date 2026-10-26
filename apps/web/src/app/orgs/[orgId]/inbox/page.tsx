'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Inbox } from 'lucide-react';
import type { ActionItemDTO } from '@workspace/core';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ActionItemCard } from '@/components/approvals/ActionItemCard';

type Scope = 'mine' | 'all';

function CardsSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-3">
      <span className="sr-only">Loading suggestions…</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card space-y-3 p-4">
          <div className="skeleton h-3 w-48" />
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-3 w-1/2" />
          <div className="flex gap-2 pt-1">
            <div className="skeleton h-8 w-24" />
            <div className="skeleton h-8 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

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
        if (!res.ok) throw new Error(data.detail || "Suggestions couldn't be loaded.");
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbox"
        description="Action items suggested from your meetings. Nothing becomes a task until someone approves it."
      />

      <section aria-labelledby="approvals-heading" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="approvals-heading" className="text-sm font-semibold text-fg">
            To review{' '}
            {/* The list API returns no total: while more pages exist the loaded count is only a lower bound. */}
            {!loading && !error && <span className="font-normal text-fg-muted">{`${pending}${endCursor ? '+' : ''}`}</span>}
          </h2>
          <div role="group" aria-label="Which suggestions to show" className="segmented self-start">
            <button type="button" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>
              Suggested for me
            </button>
            <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
              All I can review
            </button>
          </div>
        </div>

        {error && items.length === 0 ? (
          <ErrorState title="Couldn't load suggestions" message={error} onRetry={() => void load(null)} />
        ) : loading && items.length === 0 ? (
          <CardsSkeleton />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={scope === 'mine' ? "You're all caught up" : 'Nothing to review'}
            description={
              scope === 'mine'
                ? 'No open suggestions name you as the owner. Others may still need a reviewer.'
                : 'There are no open meeting suggestions in projects you can access.'
            }
            action={scope === 'mine' ? { label: 'Show all I can review', onClick: () => setScope('all') } : undefined}
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
              <button type="button" onClick={() => void load(endCursor)} disabled={loading} className="btn btn-secondary w-full">
                {loading ? 'Loading…' : 'Load more suggestions'}
              </button>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
        )}
      </section>

      <p className="text-xs text-fg-muted">Mentions, assignments and due-date reminders will also arrive here in a later release.</p>
    </div>
  );
}
