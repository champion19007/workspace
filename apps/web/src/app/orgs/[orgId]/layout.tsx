'use client';

import React, { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { isReadOnlyRole } from '@workspace/core';
import { ShellProvider, isProgressViewPath } from '@/components/shell/shell-context';
import { Sidebar, OrgSummary } from '@/components/shell/sidebar';
import { TopBar } from '@/components/shell/top-bar';
import { HelpDrawer } from '@/components/shell/help-drawer';
import { ShortcutsDialog } from '@/components/shell/shortcuts-dialog';
import { CommandLauncher } from '@/components/shell/command-launcher';
import { UserSessionInfo } from '@/components/shell/account-menu';

export default function OrgLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const orgId = params?.orgId as string;

  const [currentOrg, setCurrentOrg] = useState<OrgSummary | null>(null);
  const [availableOrgs, setAvailableOrgs] = useState<OrgSummary[]>([]);
  const [user, setUser] = useState<UserSessionInfo | null>(null);

  // The shell renders straight away (pages fetch in parallel); the sidebar shows placeholders
  // until the session and organizations arrive, and an expired session goes back to sign-in.
  useEffect(() => {
    async function initSessionAndOrg() {
      try {
        const [sessionRes, orgRes] = await Promise.all([fetch('/api/auth/session'), fetch('/api/orgs')]);
        const sessionData = sessionRes.ok ? await sessionRes.json() : null;
        if (!sessionData?.authenticated || !sessionData.user) {
          router.push(`/auth/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
          return;
        }

        // Shape returned by GET /api/auth/session: { authenticated, user: { id, email }, role, ... }. The session's
        // role is for the organization active when it was issued; this organization's own role wins below.
        let role: string = sessionData.role;
        if (orgRes.ok) {
          const orgData = await orgRes.json();
          const orgList: OrgSummary[] = (orgData.organizations || []).map(
            (o: { orgId: string; orgName: string; orgSlug: string; plan?: string; role?: string }) => ({
              id: o.orgId,
              name: o.orgName,
              slug: o.orgSlug,
              plan: o.plan || 'starter',
              role: o.role || 'member',
            })
          );
          setAvailableOrgs(orgList);
          const current = orgList.find((o) => o.id === orgId);
          setCurrentOrg(current ?? orgList[0] ?? null);
          if (current) role = current.role;
        }
        setUser({ id: sessionData.user.id, email: sessionData.user.email, role });
      } catch (err) {
        console.error('Failed to initialize session/org context:', err);
      }
    }

    if (orgId) {
      initSessionAndOrg();
    }
  }, [orgId, router]);

  // Executives and Clients stay on the Progress view their Owner gave them.
  const lockedOut = Boolean(user && isReadOnlyRole(user.role) && !isProgressViewPath(pathname, orgId));
  useEffect(() => {
    if (lockedOut) router.replace(`/orgs/${orgId}/progress`);
  }, [lockedOut, orgId, router]);

  return (
    <ShellProvider orgId={orgId} user={user}>
      <a
        href="#main"
        className="sr-only z-[60] rounded-md bg-surface px-3 py-2 text-sm font-medium text-fg shadow-lg focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <div className="flex min-h-screen">
        <Sidebar currentOrg={currentOrg} availableOrgs={availableOrgs} user={user} />

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8">
            {lockedOut ? null : children}
          </main>
        </div>
      </div>

      <HelpDrawer />
      <ShortcutsDialog />
      <CommandLauncher />
    </ShellProvider>
  );
}
