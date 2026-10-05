'use client';

import React, { useState, useEffect } from 'react';
import {
  UserPlus,
  Search,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';
import { MemberCard, MemberData } from '@/components/ui/member-card';
import { Dialog } from '@/components/ui/dialog';
import { OrgRole } from '@/components/ui/badge';

export default function MembersPage() {
  const [members, setMembers] = useState<MemberData[]>([
    {
      id: 'm-1',
      userId: '019318ef-0000-7000-8000-000000000001',
      name: 'Alex Mercer',
      email: 'alex@company.com',
      role: 'owner',
    },
    {
      id: 'm-2',
      userId: '019318ef-0000-7000-8000-000000000002',
      name: 'Priya Sharma',
      email: 'priya@company.com',
      role: 'admin',
    },
    {
      id: 'm-3',
      userId: '019318ef-0000-7000-8000-000000000003',
      name: 'Rohan Gupta',
      email: 'rohan@company.com',
      role: 'member',
    },
  ]);

  const [currentUserRole, setCurrentUserRole] = useState<OrgRole>('owner');
  const [currentUserId, setCurrentUserId] = useState<string>('019318ef-0000-7000-8000-000000000001');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  // Invite modal state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Load user session to get true role and user id
  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch('/api/auth/session');
        if (res.ok) {
          const data = await res.json();
          if (data.session) {
            setCurrentUserRole(data.session.role as OrgRole);
            setCurrentUserId(data.session.userId);
          }
        }
      } catch {
        // use defaults
      }
    }
    loadSession();
  }, []);

  const totalSeats = 10;
  const usedSeats = members.length;
  const seatPercentage = Math.round((usedSeats / totalSeats) * 100);

  const filteredMembers = members.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all' || m.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInviteToken(null);

    try {
      // In local dev/demo, create a deterministic token or call Fastify API
      const rawToken = `inv-${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;
      setInviteToken(rawToken);

      // Add to local list as pending/demo member
      const newMember: MemberData = {
        id: `m-${Date.now()}`,
        userId: `usr-${Date.now()}`,
        name: inviteEmail.split('@')[0],
        email: inviteEmail,
        role: inviteRole,
      };
      setMembers((prev) => [...prev, newMember]);
      setInviteEmail('');
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to generate invitation');
    } finally {
      setInviting(false);
    }
  };

  const copyInviteLink = () => {
    if (!inviteToken) return;
    const link = `${window.location.origin}/invitations/accept?token=${inviteToken}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUpdateRole = async (memberId: string, newRole: OrgRole) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
    );
  };

  const handleRemoveMember = async (memberId: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Command Center Hero Matching Screenshot 940 */}
      <div className="p-6 lg:p-8 rounded-2xl bg-panel border border-border-subtle shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-lg">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-accent/20 text-accent border border-accent/40 uppercase tracking-wider">
              Growth Plan
            </span>
            <span className="text-xs text-muted-foreground">• Active Organization</span>
          </div>

          <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
            Team Members Command Center
          </h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Manage organization collaborators, permissions, and single-use invitation tokens.
          </p>

          {/* Seat Progress Bar */}
          <div className="pt-2 max-w-sm space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Seats Allocated</span>
              <span className="font-mono font-semibold text-foreground">
                {usedSeats} / {totalSeats} seats used
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-panel-inset overflow-hidden border border-border-subtle">
              <div
                className="h-full bg-accent rounded-full transition-all duration-500"
                style={{ width: `${seatPercentage}%` }}
              />
            </div>
          </div>
        </div>

        {/* Invite Member Action */}
        {(currentUserRole === 'owner' || currentUserRole === 'admin') && (
          <button
            onClick={() => {
              setInviteToken(null);
              setIsInviteOpen(true);
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-accent-foreground font-bold text-xs tracking-wide shadow-md hover:opacity-90 transition-opacity self-start md:self-auto"
          >
            <UserPlus className="w-4 h-4" />
            <span>Invite Member</span>
          </button>
        )}
      </div>

      {/* Toolbar: Search & Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl bg-panel border border-border-subtle">
        <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-inset border border-border-subtle text-xs text-foreground">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search members by name or email..."
            className="w-full bg-transparent focus:outline-none placeholder:text-muted-foreground text-xs"
          />
        </div>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
          className="rounded-lg bg-panel-inset border border-border-subtle px-3 py-1.5 text-xs text-foreground focus:outline-none"
        >
          <option value="all">All Roles</option>
          <option value="owner">Owners</option>
          <option value="admin">Admins</option>
          <option value="member">Members</option>
          <option value="viewer">Viewers</option>
        </select>
      </div>

      {/* Member Cards Grid Matching Screenshot 940 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredMembers.map((member) => (
          <MemberCard
            key={member.id}
            member={member}
            currentUserRole={currentUserRole}
            currentUserId={currentUserId}
            onUpdateRole={handleUpdateRole}
            onRemoveMember={handleRemoveMember}
          />
        ))}
      </div>

      {/* Invite Member Dialog */}
      <Dialog
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        title="Invite New Colleague"
        description="Generate a secure single-use invitation token valid for 7 days."
      >
        <form onSubmit={handleSendInvite} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Role
            </label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as OrgRole)}
              className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle text-foreground text-xs focus:outline-none"
            >
              {currentUserRole === 'owner' && <option value="admin">Admin</option>}
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>

          {inviteError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{inviteError}</span>
            </div>
          )}

          {inviteToken && (
            <div className="p-4 rounded-xl bg-panel-inset border border-border-subtle text-xs space-y-2">
              <div className="font-semibold text-accent">Single-Use Link Ready:</div>
              <div className="flex items-center gap-2 bg-panel px-3 py-2 rounded-lg border border-border-subtle">
                <span className="font-mono text-muted-foreground truncate flex-1 text-[11px]">
                  {typeof window !== 'undefined'
                    ? `${window.location.origin}/invitations/accept?token=${inviteToken}`
                    : `/invitations/accept?token=${inviteToken}`}
                </span>
                <button
                  type="button"
                  onClick={copyInviteLink}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent text-accent-foreground font-bold shrink-0 text-xs"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsInviteOpen(false)}
              className="px-4 py-2 rounded-xl border border-border-subtle hover:bg-panel-elevated text-xs font-medium text-muted-foreground"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={inviting || !inviteEmail}
              className="px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {inviting ? 'Generating...' : 'Generate Invite Link'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
