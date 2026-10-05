'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, ArrowRight, ShieldCheck, UserCheck, Eye } from 'lucide-react';

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

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'owner':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <ShieldCheck className="w-3 h-3" />
            Owner
          </span>
        );
      case 'admin':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <UserCheck className="w-3 h-3" />
            Admin
          </span>
        );
      case 'viewer':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
            <Eye className="w-3 h-3" />
            Viewer
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Member
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Your Workspaces</h1>
            <p className="text-xs text-slate-400 mt-1">Select an organisation to view projects and tasks</p>
          </div>
          <Link
            href="/onboarding"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Workspace</span>
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {orgs.map((org) => (
              <Link
                key={org.orgId}
                href={`/orgs/${org.orgId}`}
                className="group flex items-center justify-between p-4 rounded-xl bg-slate-900/70 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all shadow-sm"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-lg bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold">
                    {org.orgName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-100 group-hover:text-indigo-400 transition-colors">
                      {org.orgName}
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5">app.workspace.dev/{org.orgSlug}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {getRoleBadge(org.role)}
                  <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-slate-300 group-hover:translate-x-0.5 transition-all" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
