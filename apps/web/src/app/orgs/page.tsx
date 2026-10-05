'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, ArrowRight } from 'lucide-react';
import { RoleBadge } from '@/components/ui/badge';

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

  useEffect(() => {
    async function loadOrgs() {
      try {
        const res = await fetch('/api/orgs');
        if (!res.ok) {
          if (res.status === 401) {
            router.push('/auth/login');
            return;
          }
          throw new Error('Failed to load organizations');
        }
        const data = await res.json();
        setOrgs(data.organizations || []);
        if (data.organizations && data.organizations.length === 0) {
          router.push('/onboarding');
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadOrgs();
  }, [router]);

  return (
    <div className="min-h-screen bg-canvas text-foreground flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-xl mx-auto w-full space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Your Workspaces</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Select an organization to access projects, tasks, and meeting notes.
            </p>
          </div>
          <Link
            href="/onboarding"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs shadow-md hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            <span>New Workspace</span>
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-20 rounded-2xl bg-panel border border-border-subtle animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {orgs.map((org) => (
              <Link
                key={org.orgId}
                href={`/orgs/${org.orgId}`}
                className="group flex items-center justify-between p-4 rounded-2xl bg-panel hover:bg-panel-elevated border border-border-subtle hover:border-accent/40 transition-all shadow-sm"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent font-bold">
                    {org.orgName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground group-hover:text-accent transition-colors">
                      {org.orgName}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                      app.workspace.dev/{org.orgSlug}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <RoleBadge role={org.role} />
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
