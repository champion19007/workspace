'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ShellProvider } from '@/components/shell/shell-context';
import { Sidebar, OrgSummary } from '@/components/shell/sidebar';
import { TopBar } from '@/components/shell/top-bar';
import { SettingsDrawer } from '@/components/shell/settings-drawer';
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
  const orgId = params?.orgId as string;

  const [loading, setLoading] = useState(true);
  const [currentOrg, setCurrentOrg] = useState<OrgSummary>({
    id: orgId,
    name: 'Workspace Organization',
    slug: 'org',
    plan: 'starter',
    role: 'member',
  });
  const [availableOrgs, setAvailableOrgs] = useState<OrgSummary[]>([]);
  const [user, setUser] = useState<UserSessionInfo>({
    id: 'user-default',
    email: 'user@workspace-v1.local',
    name: 'Workspace Member',
    role: 'member',
  });

  useEffect(() => {
    async function initSessionAndOrg() {
      try {
        const sessionRes = await fetch('/api/auth/session');
        if (!sessionRes.ok) {
          router.push('/auth/login');
          return;
        }
        const sessionData = await sessionRes.json();
        if (!sessionData.authenticated || !sessionData.session) {
          router.push('/auth/login');
          return;
        }

        const sess = sessionData.session;
        setUser({
          id: sess.userId,
          email: sess.email,
          name: sess.email.split('@')[0],
          role: sess.role,
        });

        // Fetch user's organizations
        const orgRes = await fetch('/api/orgs');
        if (orgRes.ok) {
          const orgData = await orgRes.json();
          const orgList: OrgSummary[] = (orgData.organizations || []).map(
            (o: { orgId: string; orgName: string; orgSlug: string; plan?: string; role?: string }) => ({
              id: o.orgId,
            name: o.orgName,
            slug: o.orgSlug,
            plan: o.plan || 'starter',
            role: o.role || 'member',
          }));

          setAvailableOrgs(orgList);
          const found = orgList.find((o) => o.id === orgId);
          if (found) {
            setCurrentOrg(found);
          } else if (orgList.length > 0) {
            setCurrentOrg(orgList[0]);
          }
        }
      } catch (err) {
        console.error('Failed to initialize session/org context:', err);
      } finally {
        setLoading(false);
      }
    }

    if (orgId) {
      initSessionAndOrg();
    }
  }, [orgId, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas text-foreground flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <span className="text-xs text-muted-foreground font-mono">Loading Workspace...</span>
        </div>
      </div>
    );
  }

  return (
    <ShellProvider>
      <div className="min-h-screen bg-canvas text-foreground flex">
        {/* Desktop Sidebar & Mobile Drawer */}
        <Sidebar
          currentOrg={currentOrg}
          availableOrgs={availableOrgs}
          user={user}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-screen">
          <TopBar
            orgId={currentOrg.id}
            orgName={currentOrg.name}
            projectName="Core Workspace"
          />

          <main className="flex-1 p-4 lg:p-8 max-w-7xl w-full mx-auto">
            {children}
          </main>
        </div>

        {/* Global Drawers & Modals */}
        <SettingsDrawer />
        <HelpDrawer />
        <ShortcutsDialog />
        <CommandLauncher />
      </div>
    </ShellProvider>
  );
}
