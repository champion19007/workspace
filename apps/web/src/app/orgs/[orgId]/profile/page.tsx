'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Palette, Video } from 'lucide-react';
import { isReadOnlyRole } from '@workspace/core';
import { useShell } from '@/components/shell/shell-context';
import { displayNameFromEmail } from '@/components/shell/account-menu';
import { Avatar } from '@/components/ui/avatar';
import { RoleBadge } from '@/components/ui/badge';
import { ROLE_CHOICES } from '@/components/ui/member-card';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/states';

const EMAIL_CHOICES = [
  { kind: 'mentions', title: 'When someone mentions me', text: 'Sent right away.', team: false },
  { kind: 'requests', title: 'New requests from forms', text: 'Sent right away, to the people who look after them.', team: true },
  { kind: 'digest', title: 'Daily summary', text: "Once a day, anything you haven't seen yet.", team: false },
] as const;

type EmailKind = (typeof EMAIL_CHOICES)[number]['kind'];

function EmailSettings({ orgId, readOnly }: { orgId: string; readOnly: boolean }) {
  const url = `/api/orgs/${orgId}/me/notification-settings`;
  const [prefs, setPrefs] = useState<Record<EmailKind, boolean> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data) => !cancelled && setPrefs(data))
      .catch(() => !cancelled && setError("Your email settings couldn't be loaded. Refresh to try again."));
    return () => {
      cancelled = true;
    };
  }, [url]);

  const change = async (kind: EmailKind, enabled: boolean) => {
    setError(null);
    setPrefs((p) => p && { ...p, [kind]: enabled });
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, enabled }),
    }).catch(() => null);
    if (!res?.ok) {
      setPrefs((p) => p && { ...p, [kind]: !enabled });
      setError("That change wasn't saved. Try again.");
    }
  };

  return (
    <section aria-labelledby="email-heading" className="space-y-3">
      <h2 id="email-heading" className="text-sm font-semibold text-fg">
        Email notifications
      </h2>
      {error && <Alert>{error}</Alert>}
      <ul className="card divide-y divide-border overflow-hidden">
        {/* Requests only ever go to the team, so Executives and Clients aren't offered them. */}
        {EMAIL_CHOICES.filter((c) => !(c.team && readOnly)).map(({ kind, title, text }) => (
          <li key={kind}>
            <label className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-fg">{title}</span>
                <span className="block text-sm text-fg-muted">{text}</span>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0"
                checked={prefs?.[kind] ?? true}
                disabled={!prefs}
                onChange={(e) => change(kind, e.target.checked)}
              />
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ProfilePage() {
  const { orgId, user } = useShell();

  const links = [
    { href: `/orgs/${orgId}/settings?tab=appearance`, icon: Palette, title: 'Appearance', text: 'Light or dark theme and accent colour' },
    { href: `/orgs/${orgId}/settings?tab=integrations`, icon: Video, title: 'Zoom meetings you host', text: 'Choose whether they are imported' },
  ];

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Profile" description="Your account in this organization." />

      <section className="card p-5">
        {user ? (
          <div className="flex items-center gap-4">
            <Avatar name={user.name || user.email} size="lg" />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-fg">{user.name || displayNameFromEmail(user.email)}</h2>
                <RoleBadge role={user.role} />
              </div>
              <p className="truncate text-sm text-fg-muted">{user.email}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4" role="status" aria-busy="true">
            <span className="sr-only">Loading your profile…</span>
            <div className="skeleton h-12 w-12 rounded-full" />
            <div className="space-y-2">
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-3 w-56" />
            </div>
          </div>
        )}

        <dl className="mt-5 grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-fg-muted">Signing in</dt>
            <dd className="text-fg">With this email address, by one-time link or Google. There&apos;s no password to manage.</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-muted">Your access level</dt>
            <dd className="text-fg">
              {user ? ROLE_CHOICES.find((c) => c.role === user.role)?.hint ?? user.role : '…'} Your organization&apos;s
              Owner or Managers set it.
            </dd>
          </div>
        </dl>
      </section>

      {/* Both live in Settings, which Executives and Clients don't have; the top bar switches the theme. */}
      {!isReadOnlyRole(user?.role) && (
        <section aria-labelledby="prefs-heading" className="space-y-3">
          <h2 id="prefs-heading" className="text-sm font-semibold text-fg">
            Preferences
          </h2>
          <ul className="card divide-y divide-border overflow-hidden">
            {links.map(({ href, icon: Icon, title, text }) => (
              <li key={href}>
                <Link href={href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                  <Icon className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-fg">{title}</span>
                    <span className="block text-sm text-fg-muted">{text}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EmailSettings orgId={orgId} readOnly={isReadOnlyRole(user?.role)} />

      <Alert tone="info">Changing your name or time zone isn&apos;t available yet.</Alert>
    </div>
  );
}
