'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Search, Users, SearchX } from 'lucide-react';
import { MemberCard, MemberData } from '@/components/ui/member-card';
import { OrgRole } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, EmptyState, ErrorState, SkeletonCards } from '@/components/ui/states';
import { useShell } from '@/components/shell/shell-context';

const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };

export default function MembersPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const { user } = useShell();

  const [members, setMembers] = useState<MemberData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/members`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Members couldn't be loaded.");
      const list: MemberData[] = (data.members ?? []).map((m: { id: string; name: string | null; email: string; role: OrgRole }) => ({
        id: m.id,
        userId: m.id,
        name: m.name ?? '',
        email: m.email,
        role: m.role,
      }));
      list.sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || (a.name || a.email).localeCompare(b.name || b.email));
      setMembers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (orgId) load();
  }, [orgId, load]);

  const q = searchQuery.trim().toLowerCase();
  const filteredMembers = members.filter(
    (m) => (!q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)) && (roleFilter === 'all' || m.role === roleFilter)
  );
  const canManage = user?.role === 'owner' || user?.role === 'admin';

  return (
    <div className="space-y-6">
      <PageHeader
        title="People"
        description={loading ? 'Everyone in this organization.' : `${members.length} ${members.length === 1 ? 'person' : 'people'} in this organization.`}
      />

      {canManage && (
        <Alert tone="info">
          Inviting people and changing roles isn&apos;t available in the web app yet. Until it is, ask your workspace administrator.
        </Alert>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by name or email"
            aria-label="Filter people"
            className="field field-sm pl-9"
          />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Role" className="field field-sm w-auto">
          <option value="all">All roles</option>
          <option value="owner">Owners</option>
          <option value="admin">Admins</option>
          <option value="member">Members</option>
          <option value="viewer">Viewers</option>
        </select>
      </div>

      {loading && members.length === 0 ? (
        <SkeletonCards count={4} className="lg:grid-cols-2" />
      ) : error ? (
        <ErrorState title="Couldn't load people" message={error} onRetry={load} />
      ) : members.length === 0 ? (
        <EmptyState icon={Users} title="No one here yet" description="People who join this organization will be listed here." />
      ) : filteredMembers.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No one matches"
          description="Try another name, email or role."
          action={{
            label: 'Clear filters',
            onClick: () => {
              setSearchQuery('');
              setRoleFilter('all');
            },
          }}
          compact
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {filteredMembers.map((member) => (
            <li key={member.id}>
              <MemberCard member={member} currentUserRole={(user?.role as OrgRole) ?? 'member'} currentUserId={user?.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
