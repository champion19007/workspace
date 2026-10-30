import { z } from 'zod';
import { AuthorizationError } from '../errors/index.js';

/**
 * Organization roles. The app presents them as access levels: owner = Owner, admin = Manager,
 * member = Developer, viewer = Executive (reads every project), client = Client (reads only the
 * projects they were added to; enforced by row-level security from migration 0016).
 */
export const OrgRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer', 'client']);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

export const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
  client: 0,
};

/** Executives (viewer) and clients can look but never change anything. */
export function isReadOnlyRole(role: string | null | undefined): boolean {
  return role === 'viewer' || role === 'client';
}

/**
 * Checks if the actor has equal or greater authority than the required role.
 */
export function hasMinimumRole(actorRole: OrgRole, requiredRole: OrgRole): boolean {
  return ROLE_HIERARCHY[actorRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Only Owner and Admin can manage members or send invitations.
 */
export function canManageMembers(actorRole: OrgRole): boolean {
  return actorRole === 'owner' || actorRole === 'admin';
}

/**
 * Role assignment & invitation permission rules:
 * - Owners can invite/assign: admin, member, viewer.
 * - Admins can invite/assign: member, viewer (CANNOT invite or assign owner).
 * - Members and Viewers cannot invite anyone.
 */
export function canInviteOrAssignRole(actorRole: OrgRole, targetRole: OrgRole): boolean {
  if (actorRole === 'owner') {
    return true; // Owner can invite any role
  }
  if (actorRole === 'admin') {
    return targetRole === 'member' || targetRole === 'viewer' || targetRole === 'client';
  }
  return false;
}

/**
 * Membership modification rules:
 * - An admin cannot modify an owner or another admin.
 * - An admin cannot elevate anyone to owner.
 * - Only an owner can modify or remove another admin/owner.
 */
export function canModifyMemberRole(
  actorRole: OrgRole,
  currentTargetRole: OrgRole,
  newTargetRole: OrgRole
): boolean {
  if (actorRole !== 'owner' && actorRole !== 'admin') {
    return false;
  }
  // No one except owner can touch an owner or create an owner
  if (currentTargetRole === 'owner' || newTargetRole === 'owner') {
    return actorRole === 'owner';
  }
  // Admin cannot modify another admin
  if (actorRole === 'admin' && currentTargetRole === 'admin') {
    return false;
  }
  return true;
}

/**
 * Membership removal rules:
 * - A user can remove themselves unless they are the last owner.
 * - An owner can remove any user.
 * - An admin can remove members and viewers, but not owners or other admins.
 */
export function canRemoveMember(
  actorRole: OrgRole,
  targetUserRole: OrgRole,
  isSelf: boolean
): boolean {
  if (isSelf) {
    return true; // checked separately against last-owner invariant
  }
  if (actorRole === 'owner') {
    return true;
  }
  if (actorRole === 'admin') {
    return targetUserRole === 'member' || targetUserRole === 'viewer' || targetUserRole === 'client';
  }
  return false;
}

/**
 * Only an owner can delete the organization or transfer ownership.
 */
export function canDeleteOrg(actorRole: OrgRole): boolean {
  return actorRole === 'owner';
}

export function assertCanManageMembers(actorRole: OrgRole): void {
  if (!canManageMembers(actorRole)) {
    throw new AuthorizationError('Insufficient permissions to manage organization members');
  }
}

export function assertCanAssignRole(actorRole: OrgRole, targetRole: OrgRole): void {
  if (!canInviteOrAssignRole(actorRole, targetRole)) {
    throw new AuthorizationError(
      `Role "${actorRole}" is not permitted to assign or invite role "${targetRole}"`
    );
  }
}
