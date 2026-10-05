'use client';

import React, { useState } from 'react';
import { MoreHorizontal, Trash2, Shield, Mail } from 'lucide-react';
import { RoleBadge, OrgRole } from './badge';

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

  const canManage =
    (currentUserRole === 'owner' || currentUserRole === 'admin') &&
    member.userId !== currentUserId;

  const initials = member.name
    ? member.name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : member.email.substring(0, 2).toUpperCase();

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
    if (confirm(`Are you sure you want to remove ${member.name || member.email}?`)) {
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
    <div className="relative p-4 rounded-xl bg-panel border border-border-subtle hover:border-border-strong transition-all flex items-center justify-between gap-4">
      {/* User Info */}
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="w-10 h-10 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center font-bold text-xs text-accent shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-foreground truncate">
              {member.name || 'Workspace Member'}
            </h4>
            {member.userId === currentUserId && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-panel-inset text-muted-foreground">
                You
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5 truncate">
            <Mail className="w-3 h-3 shrink-0" />
            <span className="truncate">{member.email}</span>
          </div>
        </div>
      </div>

      {/* Role & Actions */}
      <div className="flex items-center gap-3 shrink-0">
        <RoleBadge role={member.role} />

        {canManage && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              disabled={updating}
              aria-label="Member options"
              aria-expanded={menuOpen}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-elevated transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-44 rounded-xl bg-panel-elevated border border-border-subtle shadow-xl py-1 z-30 animate-in fade-in zoom-in-95"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Change Role
                </div>
                {currentUserRole === 'owner' && (
                  <button
                    onClick={() => handleRoleChange('admin')}
                    className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-panel flex items-center gap-2"
                  >
                    <Shield className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Make Admin</span>
                  </button>
                )}
                <button
                  onClick={() => handleRoleChange('member')}
                  className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-panel flex items-center gap-2"
                >
                  <Shield className="w-3.5 h-3.5 text-slate-400" />
                  <span>Make Member</span>
                </button>
                <button
                  onClick={() => handleRoleChange('viewer')}
                  className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-panel flex items-center gap-2"
                >
                  <Shield className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Make Viewer</span>
                </button>

                <div className="my-1 border-t border-border-subtle" />

                <button
                  onClick={handleRemove}
                  className="w-full text-left px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10 flex items-center gap-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove Member</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
