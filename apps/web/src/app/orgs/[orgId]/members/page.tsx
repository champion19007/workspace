'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Check, Copy, Search, SearchX, UserPlus, Users } from 'lucide-react';
import { INVITATION_EXPIRY_DAYS, canInviteOrAssignRole } from '@workspace/core';
import { MemberCard, MemberData, ROLE_CHOICES } from '@/components/ui/member-card';
import { OrgRole } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, EmptyState, ErrorState, SkeletonCards } from '@/components/ui/states';
import { useShell } from '@/components/shell/shell-context';

const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, member: 2, viewer: 3, client: 4 };

const byRoleThenName = (a: MemberData, b: MemberData) =>
  (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || (a.name || a.email).localeCompare(b.name || b.email);

/** Sends a change and returns the response body; rejects with a message to show the user. */
async function send<T = unknown>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data as T;
  // The page only offers allowed changes, so these mean someone else changed roles or people since it loaded.
  if (res.status === 403) throw new Error("You don't have permission to do that anymore. Reload the page to see everyone's current role.");
  if (res.status === 404) throw new Error('That person is no longer in this organization. Reload the page to see the current list.');
  throw new Error(data.message || "That didn't work. Try again.");
}

export default function MembersPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const { user, projects } = useShell();

  const [members, setMembers] = useState<MemberData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [inviteOpen, setInviteOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/members`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Members couldn't be loaded.");
      const list: MemberData[] = (data.members ?? []).map(
        (m: { id: string; name: string | null; email: string; role: OrgRole; projectIds?: string[] }) => ({
          id: m.id,
          userId: m.id,
          name: m.name ?? '',
          email: m.email,
          role: m.role,
          projectIds: m.projectIds ?? [],
        })
      );
      setMembers(list.sort(byRoleThenName));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (orgId) load();
  }, [orgId, load]);

  const updateRole = async (memberId: string, role: OrgRole) => {
    await send(`/api/orgs/${orgId}/members/${memberId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role } : m)).sort(byRoleThenName));
  };

  // A client sees exactly the projects they're a member of: add and remove the difference.
  const setClientProjects = async (memberId: string, projectIds: string[]) => {
    const before = members.find((m) => m.id === memberId)?.projectIds ?? [];
    try {
      for (const nodeId of projectIds.filter((id) => !before.includes(id))) {
        await send(`/api/orgs/${orgId}/nodes/${nodeId}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: memberId }),
        });
      }
      for (const nodeId of before.filter((id) => !projectIds.includes(id))) {
        await send(`/api/orgs/${orgId}/nodes/${nodeId}/members?userId=${encodeURIComponent(memberId)}`, { method: 'DELETE' });
      }
    } catch (err) {
      await load(); // some changes may have gone through: show what's saved
      throw err;
    }
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, projectIds } : m)));
  };

  const removeMember = async (memberId: string) => {
    await send(`/api/orgs/${orgId}/members/${memberId}`, { method: 'DELETE' });
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredMembers = members.filter(
    (m) => (!q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)) && (roleFilter === 'all' || m.role === roleFilter)
  );
  // Your role in this organization (the session's role is for whichever organization was active when it was issued).
  const myRole: OrgRole = members.find((m) => m.userId === user?.id)?.role ?? 'viewer';
  const canManage = myRole === 'owner' || myRole === 'admin';

  return (
    <div className="space-y-6">
      <PageHeader
        title="People"
        description={loading ? 'Everyone in this organization.' : `${members.length} ${members.length === 1 ? 'person' : 'people'} in this organization.`}
        actions={
          canManage && (
            <button type="button" onClick={() => setInviteOpen(true)} className="btn btn-primary">
              <UserPlus aria-hidden="true" />
              Invite people
            </button>
          )
        }
      />

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
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Access level" className="field field-sm w-auto">
          <option value="all">All levels</option>
          {ROLE_CHOICES.map((c) => (
            <option key={c.role} value={c.role}>
              {c.label}
            </option>
          ))}
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
          description="Try another name, email or level."
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
              <MemberCard
                member={member}
                currentUserRole={myRole}
                currentUserId={user?.id}
                onUpdateRole={updateRole}
                onRemoveMember={removeMember}
                projects={projects ?? []}
                onSetProjects={setClientProjects}
              />
            </li>
          ))}
        </ul>
      )}

      <InviteDialog isOpen={inviteOpen} onClose={() => setInviteOpen(false)} orgId={orgId} myRole={myRole} />
    </div>
  );
}

/** Creates an invitation, which is emailed when email is set up, and shows its link to pass on as well. */
function InviteDialog({
  isOpen,
  onClose,
  orgId,
  myRole,
}: {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  myRole: OrgRole;
}) {
  const ids = useId();
  const linkRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ email: string; link: string; emailSent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setEmail('');
    setRole('member');
    setError(null);
    setInvite(null);
    setCopied(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { invitation } = await send<{ invitation: { email: string; rawToken: string; emailSent: boolean } }>(`/api/orgs/${orgId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      setInvite({
        email: invitation.email,
        link: `${window.location.origin}/invitations/accept?token=${encodeURIComponent(invitation.rawToken)}`,
        emailSent: invitation.emailSent,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The invitation couldn't be created. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access (e.g. served over plain http): select the link so it can be copied by hand.
      linkRef.current?.select();
    }
  };

  const roleHint = ROLE_CHOICES.find((c) => c.role === role)?.hint;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title={invite ? (invite.emailSent ? 'Invitation sent' : 'Share the invitation link') : 'Invite people'}
      description={invite ? undefined : 'Add someone to this organization by email.'}
      maxWidthClass="max-w-md"
    >
      {invite ? (
        <div className="space-y-4">
          <Alert tone="success">
            {invite.emailSent ? `We've emailed an invitation to ${invite.email}.` : `Invitation created for ${invite.email}.`}
          </Alert>
          <div>
            <label htmlFor={`${ids}-link`} className="label">
              Invitation link
            </label>
            <div className="flex gap-2">
              <input
                id={`${ids}-link`}
                ref={linkRef}
                readOnly
                value={invite.link}
                onFocus={(e) => e.currentTarget.select()}
                className="field min-w-0 flex-1"
              />
              <button type="button" onClick={copy} className="btn btn-secondary shrink-0" autoFocus>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <span className="sr-only" aria-live="polite">
              {copied ? 'Link copied' : ''}
            </span>
            <p className="mt-1.5 text-sm text-fg-muted">
              {invite.emailSent ? "If the email doesn't arrive, send them this link yourself." : `Send it to ${invite.email} yourself.`} They
              sign in with that email address to join. The link works once and expires in {INVITATION_EXPIRY_DAYS} days.
            </p>
            {role === 'client' && (
              <p className="mt-1.5 text-sm text-fg-muted">
                Once they&apos;ve joined, choose the projects they can see with <strong className="font-medium text-fg">Choose projects</strong> on
                their card. Until then they see none.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={reset} className="btn btn-ghost">
              Invite someone else
            </button>
            <button type="button" onClick={close} className="btn btn-primary">
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div>
            <label htmlFor={`${ids}-email`} className="label">
              Email address
            </label>
            <input
              id={`${ids}-email`}
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="field"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor={`${ids}-role`} className="label">
              Access level
            </label>
            <select id={`${ids}-role`} value={role} onChange={(e) => setRole(e.target.value as OrgRole)} className="field">
              {ROLE_CHOICES.filter((c) => canInviteOrAssignRole(myRole, c.role)).map((c) => (
                <option key={c.role} value={c.role}>
                  {c.label}
                </option>
              ))}
            </select>
            {roleHint && <p className="mt-1.5 text-sm text-fg-muted">{roleHint}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={close} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn btn-primary">
              {submitting ? 'Creating…' : 'Create invitation'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
