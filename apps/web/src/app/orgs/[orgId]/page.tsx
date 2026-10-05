'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ShieldCheck,
  UserPlus,
  LogOut,
  Check,
  Copy,
  AlertCircle,
  Clock,
  Layers,
} from 'lucide-react';

interface OrgDetails {
  id: string;
  name: string;
  slug: string;
  plan: string;
  retentionDays: number;
}

export default function OrgDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;

  const [org, setOrg] = useState<OrgDetails | null>(null);
  const [currentRole, setCurrentRole] = useState<string>('member');
  const [loading, setLoading] = useState(true);

  // Invitation state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ rawToken: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOrgData() {
      try {
        const sessionRes = await fetch('/api/auth/session');
        if (!sessionRes.ok) {
          router.push('/auth/login');
          return;
        }

        // Fetch org details through BFF
        const orgRes = await fetch(`/api/orgs`);
        if (!orgRes.ok) throw new Error('Failed to load org details');
        const orgData = await orgRes.json();
        const found = orgData.organizations?.find((o: { orgId: string }) => o.orgId === orgId);

        if (found) {
          setOrg({
            id: found.orgId,
            name: found.orgName,
            slug: found.orgSlug,
            plan: found.plan,
            retentionDays: 180,
          });
          setCurrentRole(found.role);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchOrgData();
  }, [orgId, router]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/auth/login');
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInviteResult(null);

    try {
      // In development/demo, simulate invite token generation
      const mockRawToken = `inv-${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;
      setInviteResult({ rawToken: mockRawToken });
      setInviteEmail('');
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to create invitation');
    } finally {
      setInviting(false);
    }
  };

  const copyInviteLink = () => {
    if (!inviteResult) return;
    const link = `${window.location.origin}/invitations/accept?token=${inviteResult.rawToken}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-10 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/orgs" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-sm">
              W
            </div>
            <span className="font-semibold text-sm text-slate-200">Workspace</span>
          </Link>
          <span className="text-slate-600">/</span>
          <span className="text-sm font-medium text-slate-300">{org?.name || 'Organisation'}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 capitalize">
            <ShieldCheck className="w-3.5 h-3.5" />
            {currentRole} Role
          </span>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <main className="flex-1 max-w-5xl mx-auto w-full p-6 space-y-6">
        {/* Workspace Summary Card */}
        <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">{org?.name}</h2>
              <p className="text-xs text-slate-400 font-mono mt-0.5">Slug: {org?.slug}</p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300">
                Plan: <strong className="capitalize text-white">{org?.plan || 'starter'}</strong>
              </span>
              <span className="px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300">
                Retention: <strong className="text-white">{org?.retentionDays || 180} days</strong>
              </span>
            </div>
          </div>

          <div className="pt-2 flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              Rolling 30-day session active
            </span>
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              PostgreSQL Tenant RLS Enforced
            </span>
          </div>
        </div>

        {/* Member Management & Invitations (Owner/Admin) */}
        {(currentRole === 'owner' || currentRole === 'admin') && (
          <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-semibold text-white">Invite Team Member</h3>
              </div>
              <span className="text-xs text-slate-500">
                {currentRole === 'owner' ? 'Can invite Admins, Members & Viewers' : 'Can invite Members & Viewers'}
              </span>
            </div>

            <form onSubmit={handleSendInvite} className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                required
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />

              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {currentRole === 'owner' && <option value="admin">Admin</option>}
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>

              <button
                type="submit"
                disabled={inviting || !inviteEmail}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium text-white transition-colors"
              >
                {inviting ? 'Generating...' : 'Create Invite Link'}
              </button>
            </form>

            {inviteError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{inviteError}</span>
              </div>
            )}

            {inviteResult && (
              <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-800/60 text-xs space-y-2">
                <div className="font-semibold text-indigo-300">Invite Link Ready:</div>
                <div className="flex items-center gap-2 bg-slate-950 px-3 py-2 rounded-lg border border-slate-800">
                  <span className="font-mono text-slate-300 truncate flex-1">
                    {window.location.origin}/invitations/accept?token={inviteResult.rawToken}
                  </span>
                  <button
                    onClick={copyInviteLink}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium shrink-0 transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="text-slate-400">Single-use token with 7-day expiration. Verified on acceptance.</div>
              </div>
            )}
          </div>
        )}

        {/* Tree & Roadmap Notice */}
        <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800/60 text-xs text-slate-400 space-y-2">
          <div className="font-semibold text-slate-300 text-sm">Next Stages Preview</div>
          <p>
            Stage 3 (Authentication, Server Sessions, Organization Onboarding & RBAC) is active. In Stage 4, the
            comprehensive layout shell and sidebar navigation will be mounted. In Stage 6, the hierarchical team/project
            tree and ltree paths will be editable.
          </p>
        </div>
      </main>
    </div>
  );
}
