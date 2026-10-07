import { eq, and, sql } from 'drizzle-orm';
import type { DatabaseInstance } from './client.js';
import { orgs, users, memberships, nodeMembers, invitations } from './schema/index.js';
import {
  generateUuidV7,
  type OrgRole,
  canInviteOrAssignRole,
  canModifyMemberRole,
  canRemoveMember,
  ConflictError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  UnauthorizedError,
  isValidUuid,
} from '@workspace/core';

export interface CreateOrgInput {
  name: string;
  slug: string;
  userId: string;
  plan?: string;
  retentionDays?: number;
}

export interface InviteUserInput {
  orgId: string;
  actorUserId: string;
  email: string;
  role: OrgRole;
  tokenHash: string;
  expiresAt: Date;
}

export interface AcceptInviteInput {
  tokenHash: string;
  userId: string;
  userEmail: string;
}

/**
 * Finds or creates a global user record by verified email.
 * Ensures domain users are stable UUIDv7 IDs independent of external provider IDs.
 */
export async function findOrCreateUserByEmail(
  db: DatabaseInstance,
  input: {
    email: string;
    name?: string;
    supabaseUid?: string;
    cognitoSub?: string;
  }
) {
  const normalizedEmail = input.email.toLowerCase().trim();

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    const user = existing[0];
    // Link provider IDs if not yet linked
    const updates: Partial<typeof users.$inferInsert> = {};
    if (input.supabaseUid && !user.supabaseUid) {
      updates.supabaseUid = input.supabaseUid;
    }
    if (input.cognitoSub && !user.cognitoSub) {
      updates.cognitoSub = input.cognitoSub;
    }
    if (input.name && !user.name) {
      updates.name = input.name;
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(users).set(updates).where(eq(users.id, user.id));
      return { ...user, ...updates };
    }
    return user;
  }

  // Create new user
  const newUserId = generateUuidV7();
  const [created] = await db
    .insert(users)
    .values({
      id: newUserId,
      email: normalizedEmail,
      name: input.name ?? null,
      supabaseUid: input.supabaseUid ?? null,
      cognitoSub: input.cognitoSub ?? null,
    })
    .returning();

  if (!created) {
    throw new Error('Failed to create user record');
  }

  return created;
}

/**
 * Atomically provisions a new organization and assigns the caller as initial Owner.
 * Executes in a single database transaction.
 */
export async function createOrganizationWithOwner(db: DatabaseInstance, input: CreateOrgInput) {
  const normalizedSlug = input.slug.toLowerCase().trim();

  // Check unique slug first
  const existingOrg = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.slug, normalizedSlug))
    .limit(1);

  if (existingOrg.length > 0) {
    throw new ConflictError(`Organization slug "${normalizedSlug}" is already taken`);
  }

  return db.transaction(async (tx) => {
    const orgId = generateUuidV7();
    const [createdOrg] = await tx
      .insert(orgs)
      .values({
        id: orgId,
        slug: normalizedSlug,
        name: input.name.trim(),
        plan: input.plan ?? 'starter',
        retentionDays: input.retentionDays ?? 180,
      })
      .returning();

    if (!createdOrg) {
      throw new Error('Failed to create organization record');
    }

    const [createdMembership] = await tx
      .insert(memberships)
      .values({
        orgId: createdOrg.id,
        userId: input.userId,
        role: 'owner',
        sessionEpoch: 1,
      })
      .returning();

    if (!createdMembership) {
      throw new Error('Failed to assign initial owner membership');
    }

    return {
      org: createdOrg,
      membership: createdMembership,
    };
  });
}

/**
 * Fetches all organizations a user belongs to.
 */
export async function getUserOrganizations(db: DatabaseInstance, userId: string) {
  const rows = await db
    .select({
      orgId: orgs.id,
      orgSlug: orgs.slug,
      orgName: orgs.name,
      plan: orgs.plan,
      role: memberships.role,
      sessionEpoch: memberships.sessionEpoch,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(orgs, eq(memberships.orgId, orgs.id))
    .where(eq(memberships.userId, userId));

  return rows;
}

/**
 * Fetches user membership context in a specific organization.
 */
export async function getMembershipContext(
  db: DatabaseInstance,
  orgId: string,
  userId: string
) {
  const [membership] = await db
    .select({
      orgId: memberships.orgId,
      userId: memberships.userId,
      role: memberships.role,
      sessionEpoch: memberships.sessionEpoch,
    })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);

  return membership ?? null;
}

/**
 * Lists all members of an organization with profile info.
 */
export async function getOrganizationMembers(db: DatabaseInstance, orgId: string) {
  return db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
      sessionEpoch: memberships.sessionEpoch,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.orgId, orgId));
}

/**
 * Creates an invitation for a new member.
 * Enforces role assignment barriers (Admins cannot invite Owners).
 */
export async function createMemberInvitation(db: DatabaseInstance, input: InviteUserInput) {
  const normalizedEmail = input.email.toLowerCase().trim();

  // 1. Check actor role
  const actorMembership = await getMembershipContext(db, input.orgId, input.actorUserId);
  if (!actorMembership) {
    throw new ForbiddenError('You are not a member of this organization');
  }

  const actorRole = actorMembership.role as OrgRole;
  if (!canInviteOrAssignRole(actorRole, input.role)) {
    throw new ForbiddenError(
      `Role "${actorRole}" is not authorized to invite role "${input.role}"`
    );
  }

  // 2. Check if user is already an active member
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (existingUser.length > 0 && existingUser[0]) {
    const existingMembership = await getMembershipContext(db, input.orgId, existingUser[0].id);
    if (existingMembership) {
      throw new ConflictError(`User ${normalizedEmail} is already a member of this organization`);
    }
  }

  // 3. Create or replace pending invitation
  const inviteId = generateUuidV7();
  const [invite] = await db
    .insert(invitations)
    .values({
      id: inviteId,
      orgId: input.orgId,
      email: normalizedEmail,
      role: input.role,
      token: input.tokenHash,
      invitedBy: input.actorUserId,
      expiresAt: input.expiresAt,
    })
    .returning();

  if (!invite) {
    throw new Error('Failed to create invitation record');
  }

  return invite;
}

/**
 * Accepts an invitation and grants organization membership.
 * Atomic verification: token validity, single-use check, expiration, and email match.
 */
export async function acceptMemberInvitation(db: DatabaseInstance, input: AcceptInviteInput) {
  const normalizedEmail = input.userEmail.toLowerCase().trim();

  return db.transaction(async (tx) => {
    // 1. Fetch invitation with lock
    const [invite] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.token, input.tokenHash))
      .for('update');

    if (!invite) {
      throw new NotFoundError('Invitation not found or invalid token');
    }

    if (invite.acceptedAt) {
      throw new ConflictError('Invitation has already been accepted');
    }

    if (new Date() > invite.expiresAt) {
      throw new ValidationError('Invitation has expired');
    }

    if (invite.email.toLowerCase() !== normalizedEmail) {
      throw new UnauthorizedError(
        `This invitation was issued for ${invite.email}, but you are signed in as ${normalizedEmail}`
      );
    }

    // 2. Fetch org details
    const [org] = await tx
      .select()
      .from(orgs)
      .where(eq(orgs.id, invite.orgId))
      .limit(1);

    if (!org) {
      throw new NotFoundError('Organization associated with this invitation does not exist');
    }

    // 3. Insert or update membership
    const [existingMembership] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, invite.orgId), eq(memberships.userId, input.userId)))
      .limit(1);

    let membership = existingMembership;
    if (!membership) {
      const [newMembership] = await tx
        .insert(memberships)
        .values({
          orgId: invite.orgId,
          userId: input.userId,
          role: invite.role,
          sessionEpoch: 1,
        })
        .returning();
      membership = newMembership;
    }

    if (!membership) {
      throw new Error('Failed to create or retrieve membership');
    }

    // 4. Mark invitation as accepted
    await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, invite.id));

    return {
      org,
      membership,
    };
  });
}

/**
 * Updates a member's role and immediately invalidates active sessions by bumping session_epoch.
 */
export async function updateOrganizationMemberRole(
  db: DatabaseInstance,
  input: {
    orgId: string;
    actorUserId: string;
    targetUserId: string;
    newRole: OrgRole;
  }
) {
  // 1. Fetch actor and target roles
  const actorMembership = await getMembershipContext(db, input.orgId, input.actorUserId);
  if (!actorMembership) {
    throw new ForbiddenError('You are not a member of this organization');
  }

  const targetMembership = await getMembershipContext(db, input.orgId, input.targetUserId);
  if (!targetMembership) {
    throw new NotFoundError('Target user is not a member of this organization');
  }

  const actorRole = actorMembership.role as OrgRole;
  const currentTargetRole = targetMembership.role as OrgRole;

  if (!canModifyMemberRole(actorRole, currentTargetRole, input.newRole)) {
    throw new ForbiddenError(
      `Role "${actorRole}" is not authorized to change role from "${currentTargetRole}" to "${input.newRole}"`
    );
  }

  // If demoting an owner, ensure at least one other owner remains
  if (currentTargetRole === 'owner' && input.newRole !== 'owner') {
    const ownerCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.orgId, input.orgId), eq(memberships.role, 'owner')));

    const ownerCount = ownerCountResult[0]?.count ?? 0;
    if (ownerCount <= 1) {
      throw new ValidationError('Cannot demote the final Owner of an organization');
    }
  }

  // Update role and bump session_epoch to revoke active JWT/session immediately
  const [updated] = await db
    .update(memberships)
    .set({
      role: input.newRole,
      sessionEpoch: sql`${memberships.sessionEpoch} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(memberships.orgId, input.orgId), eq(memberships.userId, input.targetUserId)))
    .returning();

  if (!updated) {
    throw new Error('Failed to update membership');
  }

  return updated;
}

/**
 * Removes a member from the organization.
 * Enforces removal invariants (cannot remove last owner, admin cannot remove owner/admin).
 * Also cleans up private node memberships.
 */
export async function removeOrganizationMember(
  db: DatabaseInstance,
  input: {
    orgId: string;
    actorUserId: string;
    targetUserId: string;
  }
) {
  const isSelf = input.actorUserId === input.targetUserId;

  const actorMembership = await getMembershipContext(db, input.orgId, input.actorUserId);
  if (!actorMembership) {
    throw new ForbiddenError('You are not a member of this organization');
  }

  const targetMembership = await getMembershipContext(db, input.orgId, input.targetUserId);
  if (!targetMembership) {
    throw new NotFoundError('Target user is not a member of this organization');
  }

  const actorRole = actorMembership.role as OrgRole;
  const targetRole = targetMembership.role as OrgRole;

  if (!canRemoveMember(actorRole, targetRole, isSelf)) {
    throw new ForbiddenError(
      `Role "${actorRole}" is not authorized to remove user with role "${targetRole}"`
    );
  }

  // Invariant: Cannot remove final Owner
  if (targetRole === 'owner') {
    const ownerCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.orgId, input.orgId), eq(memberships.role, 'owner')));

    const ownerCount = ownerCountResult[0]?.count ?? 0;
    if (ownerCount <= 1) {
      throw new ValidationError('Cannot remove the final Owner of an organization');
    }
  }

  return db.transaction(async (tx) => {
    // 1. Delete node memberships in this org
    await tx
      .delete(nodeMembers)
      .where(and(eq(nodeMembers.orgId, input.orgId), eq(nodeMembers.userId, input.targetUserId)));

    // 2. Delete membership
    const [deleted] = await tx
      .delete(memberships)
      .where(and(eq(memberships.orgId, input.orgId), eq(memberships.userId, input.targetUserId)))
      .returning();

    return deleted;
  });
}

/**
 * Fetches an organization by its primary key ID.
 */
export async function getOrganizationById(db: DatabaseInstance, id: string) {
  const [org] = await db
    .select()
    .from(orgs)
    .where(eq(orgs.id, id))
    .limit(1);
  return org ?? null;
}

/**
 * Fetches an organization by either UUID or slug identifier.
 */
export async function getOrganizationByIdOrSlug(db: DatabaseInstance, identifier: string) {
  const isId = isValidUuid(identifier);
  const [org] = await db
    .select({ id: orgs.id, slug: orgs.slug, name: orgs.name })
    .from(orgs)
    .where(isId ? eq(orgs.id, identifier) : eq(orgs.slug, identifier))
    .limit(1);
  return org ?? null;
}
