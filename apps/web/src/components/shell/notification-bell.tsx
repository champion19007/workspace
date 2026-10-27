'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import type { NotificationDTO, NotificationListDTO } from '@workspace/core';
import { useShell } from './shell-context';
import { useDismiss } from '../ui/use-dismiss';
import { formatRelativeTime } from '@/lib/format';

/** The bell in the top bar: mentions, comments on your work, new requests and meeting notes. */
export function NotificationBell() {
  const { orgId } = useShell();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationListDTO | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);

  const load = useCallback(() => {
    if (!orgId) return;
    fetch(`/api/orgs/${orgId}/notifications`)
      .then((res) => (res.ok ? res.json() : null))
      .then((list) => list && setData(list))
      .catch(() => {});
  }, [orgId]);

  // ponytail: polls every minute and on tab focus; switch to push when live updates (Stage 20) land.
  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  const markRead = async (ids?: string[]) => {
    await fetch(`/api/orgs/${orgId}/notifications`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids ? { ids } : {}),
    }).catch(() => {});
    load();
  };

  const openItem = (n: NotificationDTO) => {
    setOpen(false);
    if (!n.readAt) markRead([n.id]);
    router.push(n.href);
  };

  const unread = data?.unreadCount ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!open) load();
          setOpen(!open);
        }}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="btn btn-ghost btn-icon relative"
      >
        <Bell aria-hidden="true" />
        {unread > 0 && (
          <span
            className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-fg"
            aria-hidden="true"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className="menu right-0 top-full mt-1.5 w-[min(22rem,calc(100vw-1.5rem))] p-0">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <p className="text-sm font-semibold text-fg">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={() => markRead()} className="text-xs font-medium text-accent-text hover:underline">
                Mark all as read
              </button>
            )}
          </div>
          {!data ? (
            <div className="p-3">
              <div className="skeleton h-12 w-full" />
            </div>
          ) : data.notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-fg-muted">
              Nothing yet. You&apos;ll see it here when someone mentions you or comments on your work.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {data.notifications.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => openItem(n)} className="flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? '' : 'bg-accent'}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${n.readAt ? 'text-fg-muted' : 'font-medium text-fg'}`}>
                        {n.title}
                        {!n.readAt && <span className="sr-only"> (unread)</span>}
                      </span>
                      {n.body && <span className="mt-0.5 block truncate text-xs text-fg-muted">{n.body}</span>}
                      <span className="mt-0.5 block text-xs text-fg-subtle">{formatRelativeTime(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
