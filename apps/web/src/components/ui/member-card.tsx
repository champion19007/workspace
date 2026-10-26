'use client';

import React, { useRef, useState } from 'react';
import { MoreHorizontal, Trash2, Shield } from 'lucide-react';
import { RoleBadge, OrgRole } from './badge';
import { Avatar } from './avatar';
import { useDismiss } from './use-dismiss';

export interface MemberData {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  joinedAt?: string;
}

interface MemberCardProps {
  member: MemberData;
  currentUserRole: OrgRole;
  currentUserId?: string;
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
  const [updating, setUpdating] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuOpen, () => setMenuOpen(false), menuRef);

  const isYou = member.userId === currentUserId;
  const canManage =
    (currentUserRole === 'owner' || currentUserRole === 'admin') && !isYou && Boolean(onUpdateRole || onRemoveMember);

  const handleRoleChange = async (role: OrgRole) => {
    if (!onUpdateRole) return;
    setUpdating(true);
    try {
      await onUpdateRole(member.id, role);
    } finally {
      setUpdating(false);
      setMenuOpen(false);
    }
  };

  const handleRemove = async () => {
    if (!onRemoveMember) return;
    if (confirm(`Remove ${member.name || member.email} from this organization?`)) {
      setUpdating(true);
      try {
        await onRemoveMember(member.id);
      } finally {
        setUpdating(false);
        setMenuOpen(false);
      }
    }
  };

  return (
    <div className="card flex items-center justify-between gap-3 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={member.name || member.email} size="lg" />
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

        {canManage && (
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              disabled={updating}
              aria-label={`Options for ${member.name || member.email}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="btn btn-ghost btn-icon btn-sm"
            >
              <MoreHorizontal aria-hidden="true" />
            </button>

            {menuOpen && (
              <div role="menu" className="menu right-0 top-full mt-1 w-48">
                <div className="menu-label">Change role</div>
                {currentUserRole === 'owner' && (
                  <button type="button" role="menuitem" onClick={() => handleRoleChange('admin')} className="menu-item">
                    <Shield aria-hidden="true" />
                    Make admin
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => handleRoleChange('member')} className="menu-item">
                  <Shield aria-hidden="true" />
                  Make member
                </button>
                <button type="button" role="menuitem" onClick={() => handleRoleChange('viewer')} className="menu-item">
                  <Shield aria-hidden="true" />
                  Make viewer
                </button>
                <div className="menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleRemove}
                  className="menu-item text-danger hover:bg-danger-subtle [&_svg]:text-danger"
                >
                  <Trash2 aria-hidden="true" />
                  Remove from organization
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
