'use client';

import React, { useRef, useState } from 'react';
import { MoreHorizontal, Trash2, Shield } from 'lucide-react';
import { canInviteOrAssignRole, canModifyMemberRole, canRemoveMember } from '@workspace/core';
import { RoleBadge, OrgRole } from './badge';
import { Avatar } from './avatar';
import { Dialog } from './dialog';
import { Alert } from './states';
import { useDismiss } from './use-dismiss';

export interface MemberData {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  joinedAt?: string;
}

/** Roles in the order they're offered, with what each one can do. */
export const ROLE_CHOICES: { role: OrgRole; label: string; hint: string }[] = [
  { role: 'owner', label: 'Owner', hint: 'Owners have full control, including managing admins and other owners.' },
  { role: 'admin', label: 'Admin', hint: 'Admins can invite people and manage members and viewers.' },
  { role: 'member', label: 'Member', hint: 'Members can work on projects, tasks and docs.' },
  { role: 'viewer', label: 'Viewer', hint: "Viewers can see projects, tasks and docs, but can't change them." },
];

interface MemberCardProps {
  member: MemberData;
  currentUserRole: OrgRole;
  currentUserId?: string;
  /** Rejects with a message to show when the change fails. */
  onUpdateRole?: (memberId: string, newRole: OrgRole) => Promise<void>;
  onRemoveMember?: (memberId: string) => Promise<void>;
}

export function MemberCard({
  member,
  currentUserRole,
  currentUserId,
  onUpdateRole,
  onRemoveMember,
}: MemberCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState<OrgRole | 'remove' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDismiss(menuOpen, () => setMenuOpen(false), menuRef);

  const isYou = member.userId === currentUserId;
  const displayName = member.name || member.email;
  // Only what the server allows; admins also can't hand out roles they couldn't invite someone as.
  const roleChoices =
    onUpdateRole && !isYou
      ? ROLE_CHOICES.filter(
          ({ role }) =>
            role !== member.role &&
            canModifyMemberRole(currentUserRole, member.role, role) &&
            canInviteOrAssignRole(currentUserRole, role)
        )
      : [];
  const canRemove = Boolean(onRemoveMember) && !isYou && canRemoveMember(currentUserRole, member.role, false);

  const ask = (action: OrgRole | 'remove') => {
    setMenuOpen(false);
    triggerRef.current?.focus(); // the dialog hands focus back to whatever had it when it opened
    setError(null);
    setPending(action);
  };

  const confirmPending = async () => {
    setBusy(true);
    setError(null);
    try {
      if (pending === 'remove') await onRemoveMember?.(member.id);
      else if (pending) await onUpdateRole?.(member.id, pending);
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const choice = ROLE_CHOICES.find((c) => c.role === pending);

  return (
    <div className="card flex items-center justify-between gap-3 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={displayName} size="lg" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium text-fg">{member.name || member.email.split('@')[0]}</h3>
            {isYou && <span className="badge badge-neutral h-5 px-1.5">You</span>}
          </div>
          <p className="truncate text-sm text-fg-muted">{member.email}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <RoleBadge role={member.role} />

        {(roleChoices.length > 0 || canRemove) && (
          <div ref={menuRef} className="relative">
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={`Options for ${displayName}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="btn btn-ghost btn-icon btn-sm"
            >
              <MoreHorizontal aria-hidden="true" />
            </button>

            {menuOpen && (
              <div role="menu" className="menu right-0 top-full mt-1 w-48">
                {roleChoices.length > 0 && <div className="menu-label">Change role</div>}
                {roleChoices.map(({ role, label }) => (
                  <button key={role} type="button" role="menuitem" onClick={() => ask(role)} className="menu-item">
                    <Shield aria-hidden="true" />
                    Make {label.toLowerCase()}
                  </button>
                ))}
                {roleChoices.length > 0 && canRemove && <div className="menu-sep" />}
                {canRemove && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => ask('remove')}
                    className="menu-item text-danger hover:bg-danger-subtle [&_svg]:text-danger"
                  >
                    <Trash2 aria-hidden="true" />
                    Remove from organization
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog
        isOpen={pending !== null}
        onClose={() => !busy && setPending(null)}
        title={
          choice
            ? `Make ${displayName} ${/^[aeiou]/i.test(choice.label) ? 'an' : 'a'} ${choice.label.toLowerCase()}?`
            : `Remove ${displayName}?`
        }
        description={
          choice ? choice.hint : "They'll lose access to this organization right away. You can invite them again later."
        }
        maxWidthClass="max-w-md"
      >
        {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setPending(null)} disabled={busy} className="btn btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmPending}
            disabled={busy}
            className={pending === 'remove' ? 'btn btn-danger' : 'btn btn-primary'}
          >
            {pending === 'remove' ? (busy ? 'Removing…' : 'Remove') : busy ? 'Saving…' : `Make ${choice?.label.toLowerCase() ?? ''}`}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
