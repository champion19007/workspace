'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus } from 'lucide-react';
import { RoleBadge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { AuthFrame } from '@/components/ui/auth-frame';
import { Alert } from '@/components/ui/states';

interface OrgItem {
  orgId: string;
  orgSlug: string;
  orgName: string;
  plan: string;
  role: string;
  joinedAt: string;
}

export default function OrgsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/orgs');
      if (res.status === 401) {
        router.push('/auth/login?returnTo=/orgs');
        return;
      }
      if (!res.ok) throw new Error("Your organizations couldn't be loaded.");
      const data = await res.json();
      const list: OrgItem[] = data.organizations || [];
      if (list.length === 0) {
        router.push('/onboarding');
        return;
      }
      setOrgs(list);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadOrgs();
  }, [loadOrgs]);

  if (error) {
    return (
      <AuthFrame title="Choose an organization">
        <Alert
          tone="danger"
          title="Couldn't load your organizations"
          action={
            <button type="button" onClick={loadOrgs} className="btn btn-secondary btn-sm">
              Try again
            </button>
          }
        >
          {error}
        </Alert>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Choose an organization"
      description="Pick where you want to work."
      footer={
        <Link href="/onboarding" className="link inline-flex items-center gap-1">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create a new organization
        </Link>
      }
    >
      {loading ? (
        <div className="space-y-2" role="status" aria-busy="true">
          <span className="sr-only">Loading your organizations…</span>
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-14 w-full" />
          ))}
        </div>
      ) : (
        <ul className="-m-2 space-y-1">
          {orgs.map((org) => (
            <li key={org.orgId}>
              <Link
                href={`/orgs/${org.orgId}`}
                className="group flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-surface-2"
              >
                <Avatar name={org.orgName} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg">{org.orgName}</span>
                  <span className="block truncate font-mono text-xs text-fg-muted">{org.orgSlug}</span>
                </span>
                <RoleBadge role={org.role} />
                <ChevronRight className="h-4 w-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AuthFrame>
  );
}
