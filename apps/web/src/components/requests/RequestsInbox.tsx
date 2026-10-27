'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import type { RequestDTO, RequestStatus } from '@workspace/core';
import { EmptyState, ErrorState, Alert } from '@/components/ui/states';
import { formatRelativeTime } from '@/lib/format';

const STATUSES: { value: RequestStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
];

/** Requests sent through projects' public request forms: accept one to make it a task. */
export function RequestsInbox({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<RequestStatus>('new');
  const [requests, setRequests] = useState<RequestDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<RequestDTO | null>(null);

  const load = useCallback(async () => {
    setRequests(null);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/requests?status=${status}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || "Requests couldn't be loaded.");
      setRequests(body.requests);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [orgId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (r: RequestDTO, decision: 'accept' | 'decline') => {
    setBusyId(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/requests/${r.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || "The request couldn't be updated.");
      setRequests((prev) => prev?.filter((x) => x.id !== r.id) ?? null);
      setDone(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="requests-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="requests-heading" className="text-sm font-semibold text-fg">
          Requests {requests && <span className="font-normal text-fg-muted">{requests.length}</span>}
        </h2>
        <div role="group" aria-label="Which requests to show" className="segmented self-start">
          {STATUSES.map((s) => (
            <button key={s.value} type="button" aria-pressed={status === s.value} onClick={() => setStatus(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {done && (
        <Alert tone="success" onDismiss={() => setDone(null)}>
          {done.status === 'accepted' && done.taskId ? (
            <>
              “{done.title}” is now{' '}
              <Link href={`/orgs/${orgId}/projects/${done.nodeId}/tasks?task=${done.taskId}`} className="font-medium underline">
                {done.taskKey}
              </Link>{' '}
              in {done.projectName}.
            </>
          ) : (
            <>“{done.title}” was declined.</>
          )}{' '}
          Let {done.requesterName} know at{' '}
          <a href={`mailto:${done.requesterEmail}`} className="font-medium underline">
            {done.requesterEmail}
          </a>
          .
        </Alert>
      )}

      {error && requests === null ? (
        <ErrorState title="Couldn't load requests" message={error} onRetry={load} />
      ) : requests === null ? (
        <div className="skeleton h-28 w-full" />
      ) : requests.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={status === 'new' ? 'No new requests' : `No ${status} requests`}
          description="Turn on a project's request form on its Overview page and share the link with clients or other teams. What they send arrives here."
        />
      ) : (
        <ul className="space-y-3">
          {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
          {requests.map((r) => (
            <li key={r.id} className="card space-y-2 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="font-medium text-fg">{r.title}</h3>
                <span className="text-xs text-fg-subtle">{formatRelativeTime(r.createdAt)}</span>
              </div>
              <p className="text-xs text-fg-muted">
                From {r.requesterName} ·{' '}
                <a href={`mailto:${r.requesterEmail}`} className="hover:underline">
                  {r.requesterEmail}
                </a>{' '}
                · {r.projectName}
              </p>
              {r.details && <p className="whitespace-pre-wrap break-words text-sm text-fg">{r.details}</p>}
              {r.status === 'new' ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" onClick={() => decide(r, 'accept')} disabled={busyId === r.id} className="btn btn-primary btn-sm">
                    Accept as a task
                  </button>
                  <button type="button" onClick={() => decide(r, 'decline')} disabled={busyId === r.id} className="btn btn-ghost btn-sm">
                    Decline
                  </button>
                </div>
              ) : (
                r.taskId && (
                  <Link href={`/orgs/${orgId}/projects/${r.nodeId}/tasks?task=${r.taskId}`} className="text-sm font-medium text-accent-text hover:underline">
                    Open {r.taskKey}
                  </Link>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
