'use client';

import React, { useRef, useState } from 'react';
import { MoreHorizontal, Trash2, Shield } from 'lucide-react';
import { canInviteOrAssignRole, canManageMembers, canModifyMemberRole, canRemoveMember } from '@workspace/core';
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
  /** For a client: the projects they were added to, the only ones they see. */
  projectIds?: string[];
}

/** Access levels in the order they're offered, with what each one can do. */
export const ROLE_CHOICES: { role: OrgRole; label: string; hint: string }[] = [
  { role: 'owner', label: 'Owner', hint: 'Full control of the organization, including who is a Manager or Owner.' },
  { role: 'admin', label: 'Manager', hint: 'Runs projects and people: invites teammates and clients, and chooses what each client sees.' },
  { role: 'member', label: 'Developer', hint: 'Does the work: creates and updates projects, tasks and docs.' },
  { role: 'viewer', label: 'Executive', hint: "Sees how every project is going on a simple Progress page. Can't change anything." },
  { role: 'client', label: 'Client', hint: "Sees progress on only the projects you choose. Can't change anything or see your other clients." },
];

interface MemberCardProps {
  member: MemberData;
  currentUserRole: OrgRole;
  currentUserId?: string;
  /** Rejects with a message to show when the change fails. */
  onUpdateRole?: (memberId: string, newRole: OrgRole) => Promise<void>;
  onRemoveMember?: (memberId: string) => Promise<void>;
  /** Every project, to choose which ones a client sees. */
  projects?: { id: string; name: string }[];
  onSetProjects?: (memberId: string, projectIds: string[]) => Promise<void>;
}

export function MemberCard({
  member,
  currentUserRole,
  currentUserId,
  onUpdateRole,
  onRemoveMember,
  projects = [],
  onSetProjects,
}: MemberCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [choosingProjects, setChoosingProjects] = useState(false);
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
  const isClient = member.role === 'client';
  const canChooseProjects = isClient && Boolean(onSetProjects) && canManageMembers(currentUserRole);
  const clientProjects = projects.filter((p) => member.projectIds?.includes(p.id)).map((p) => p.name);

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
          {isClient && (
            <p className="mt-0.5 text-xs text-fg-muted">
              {clientProjects.length ? `Sees ${clientProjects.join(', ')}` : 'Sees no projects yet'}
              {canChooseProjects && (
                <>
                  {' · '}
                  <button type="button" onClick={() => setChoosingProjects(true)} className="link">
                    Choose projects
                  </button>
                </>
              )}
            </p>
          )}
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
                {roleChoices.length > 0 && <div className="menu-label">Change access level</div>}
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

      {choosingProjects && (
        <ClientProjectsDialog
          name={displayName}
          projects={projects}
          initial={member.projectIds ?? []}
          onClose={() => setChoosingProjects(false)}
          onSave={(ids) => onSetProjects!(member.id, ids)}
        />
      )}
    </div>
  );
}

/** Ticks the projects a client can see. Mounted only while open, so it starts from their current access. */
function ClientProjectsDialog({
  name,
  projects,
  initial,
  onClose,
  onSave,
}: {
  name: string;
  projects: { id: string; name: string }[];
  initial: string[];
  onClose: () => void;
  onSave: (projectIds: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(selected);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen
      onClose={() => !busy && onClose()}
      title={`Projects ${name} can see`}
      description="They see each project's progress and docs, and nothing else. They can't change anything."
      maxWidthClass="max-w-md"
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {projects.length === 0 ? (
        <p className="text-sm text-fg-muted">There are no projects yet. Create one first.</p>
      ) : (
        <fieldset className="max-h-72 space-y-0.5 overflow-y-auto">
          <legend className="sr-only">Projects</legend>
          {projects.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-fg hover:bg-surface-2">
              <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4" />
              <span className="min-w-0 truncate">{p.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" onClick={onClose} disabled={busy} className="btn btn-ghost">
          Cancel
        </button>
        <button type="button" onClick={save} disabled={busy || projects.length === 0} className="btn btn-primary">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}
