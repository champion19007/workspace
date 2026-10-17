import { eq, and, sql } from 'drizzle-orm';
import { loginSql, withTenantContext, type DatabaseInstance, type TenantTransaction } from './client.js';
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

type UserRecord = typeof users.$inferSelect;

/**
 * Finds or creates a global user record by verified email, linking provider ids that are not yet set.
 * Ensures domain users are stable UUIDv7 IDs independent of external provider IDs.
 * Sign-in happens before any tenant is known: runs through the sys_auth_upsert_user entry point.
 */
export async function findOrCreateUserByEmail(
  db: DatabaseInstance,
  input: {
    email: string;
    name?: string;
    supabaseUid?: string;
    cognitoSub?: string;
  }
): Promise<UserRecord> {
  const normalizedEmail = input.email.toLowerCase().trim();
  const [row] = await loginSql(db)<Array<Record<string, string | null>>>`
    SELECT * FROM sys_auth_upsert_user(
      ${normalizedEmail}, ${input.name ?? null}, ${input.supabaseUid ?? null}, ${input.cognitoSub ?? null}
    )
  `;
  if (!row) {
    throw new Error('Failed to create user record');
  }
  return {
    id: row['id']!,
    email: row['email']!,
    name: row['name'] ?? null,
    cognitoSub: row['cognito_sub'] ?? null,
    supabaseUid: row['supabase_uid'] ?? null,
    createdAt: new Date(row['created_at']!),
    updatedAt: new Date(row['updated_at']!),
  };
}

/**
 * Atomically provisions a new organization and assigns the caller as initial Owner.
 * Runs as the new organization's own tenant transaction (its id is generated up front), so RLS admits
 * exactly the org row and its first membership; a taken slug surfaces as the unique violation.
 */
export async function createOrganizationWithOwner(db: DatabaseInstance, input: CreateOrgInput) {
  const normalizedSlug = input.slug.toLowerCase().trim();
  const orgId = generateUuidV7();

  try {
    return await withTenantContext(db, { orgId, userId: input.userId, role: 'owner' }, async (tx) => {
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
  } catch (err) {
    const pgError = err as { code?: string; constraint_name?: string };
    if (pgError.code === '23505' && pgError.constraint_name === 'orgs_slug_key') {
      throw new ConflictError(`Organization slug "${normalizedSlug}" is already taken`);
    }
    throw err;
  }
}

/**
 * Fetches all organizations a user belongs to (organization switcher; sys_auth_user_orgs entry point).
 */
export async function getUserOrganizations(db: DatabaseInstance, userId: string) {
  const rows = await loginSql(db)<
    Array<{ orgId: string; orgSlug: string; orgName: string; plan: string; role: string; sessionEpoch: number; joinedAt: string }>
  >`
    SELECT org_id AS "orgId", org_slug AS "orgSlug", org_name AS "orgName", plan, role,
           session_epoch AS "sessionEpoch", joined_at AS "joinedAt"
    FROM sys_auth_user_orgs(${userId})
  `;
  return rows.map((r) => ({ ...r, joinedAt: new Date(r.joinedAt) }));
}

export interface OrgMembershipResolution {
  orgId: string;
  orgSlug: string;
  /** Null when the user is not a member. */
  membership: { orgName: string; role: OrgRole; sessionEpoch: number } | null;
}

/**
 * Request bootstrap: resolves an organization by UUID or slug for a user (sys_auth_org_membership entry
 * point). Null when no such organization exists; `membership` is null when the user is not a member.
 */
export async function resolveOrgMembership(
  db: DatabaseInstance,
  orgIdentifier: string,
  userId: string
): Promise<OrgMembershipResolution | null> {
  const [row] = await loginSql(db)<
    Array<{ org_id: string; org_slug: string; org_name: string | null; role: string | null; session_epoch: number | null }>
  >`
    SELECT * FROM sys_auth_org_membership(${orgIdentifier}, ${userId})
  `;
  if (!row) return null;
  return {
    orgId: row.org_id,
    orgSlug: row.org_slug,
    membership: row.role
      ? { orgName: row.org_name!, role: row.role as OrgRole, sessionEpoch: row.session_epoch! }
      : null,
  };
}

type Db = DatabaseInstance | TenantTransaction;

/**
 * Fetches a user's membership context in a specific organization (any member may look up any membership
 * of their organization, so no acting user is needed; nested calls keep their caller's binding).
 */
export async function getMembershipContext(db: Db, orgId: string, userId: string) {
  const [membership] = await withTenantContext(db, { orgId }, (tx) =>
    tx
      .select({
        orgId: memberships.orgId,
        userId: memberships.userId,
        role: memberships.role,
        sessionEpoch: memberships.sessionEpoch,
      })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
      .limit(1)
  );

  return membership ?? null;
}

/**
 * Lists all members of an organization with profile info, as seen by `actorUserId` (a member).
 */
export async function getOrganizationMembers(db: Db, orgId: string, actorUserId: string) {
  return withTenantContext(db, { orgId, userId: actorUserId }, (tx) =>
    tx
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
      .where(eq(memberships.orgId, orgId))
  );
}

/**
 * Creates an invitation for a new member.
 * Enforces role assignment barriers (Admins cannot invite Owners).
 */
export async function createMemberInvitation(db: Db, input: InviteUserInput) {
  const normalizedEmail = input.email.toLowerCase().trim();

  return withTenantContext(db, { orgId: input.orgId, userId: input.actorUserId }, async (tx) => {
    // 1. Check actor role
    const actorMembership = await getMembershipContext(tx, input.orgId, input.actorUserId);
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
    const existingUser = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existingUser.length > 0 && existingUser[0]) {
      const existingMembership = await getMembershipContext(tx, input.orgId, existingUser[0].id);
      if (existingMembership) {
        throw new ConflictError(`User ${normalizedEmail} is already a member of this organization`);
      }
    }

    // 3. Create or replace pending invitation
    const inviteId = generateUuidV7();
    const [invite] = await tx
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
  });
}

/**
 * Accepts an invitation and grants organization membership.
 * Atomic verification: token validity, single-use check, expiration, and email match.
 */
export async function acceptMemberInvitation(db: DatabaseInstance, input: AcceptInviteInput) {
  const normalizedEmail = input.userEmail.toLowerCase().trim();

  // The invitee is not a member yet: the token (hashed, unguessable) resolves the organization, and the
  // acceptance then runs as that organization's tenant transaction.
  const [target] = await loginSql(db)<Array<{ org_id: string | null }>>`
    SELECT sys_auth_invitation_org(${input.tokenHash}) AS org_id
  `;
  if (!target?.org_id) {
    throw new NotFoundError('Invitation not found or invalid token');
  }

  return withTenantContext(db, { orgId: target.org_id, userId: input.userId }, async (tx) => {
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
  db: Db,
  input: {
    orgId: string;
    actorUserId: string;
    targetUserId: string;
    newRole: OrgRole;
  }
) {
  return withTenantContext(db, { orgId: input.orgId, userId: input.actorUserId }, async (tx) => {
    // 1. Fetch actor and target roles
    const actorMembership = await getMembershipContext(tx, input.orgId, input.actorUserId);
    if (!actorMembership) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    const targetMembership = await getMembershipContext(tx, input.orgId, input.targetUserId);
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
      const ownerCountResult = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(memberships)
        .where(and(eq(memberships.orgId, input.orgId), eq(memberships.role, 'owner')));

      const ownerCount = ownerCountResult[0]?.count ?? 0;
      if (ownerCount <= 1) {
        throw new ValidationError('Cannot demote the final Owner of an organization');
      }
    }

    // Update role and bump session_epoch to revoke active JWT/session immediately
    const [updated] = await tx
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
  });
}

/**
 * Removes a member from the organization.
 * Enforces removal invariants (cannot remove last owner, admin cannot remove owner/admin).
 * Also cleans up private node memberships.
 */
export async function removeOrganizationMember(
  db: Db,
  input: {
    orgId: string;
    actorUserId: string;
    targetUserId: string;
  }
) {
  return withTenantContext(db, { orgId: input.orgId, userId: input.actorUserId }, async (tx) => {
    const isSelf = input.actorUserId === input.targetUserId;

    const actorMembership = await getMembershipContext(tx, input.orgId, input.actorUserId);
    if (!actorMembership) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    const targetMembership = await getMembershipContext(tx, input.orgId, input.targetUserId);
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
      const ownerCountResult = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(memberships)
        .where(and(eq(memberships.orgId, input.orgId), eq(memberships.role, 'owner')));

      const ownerCount = ownerCountResult[0]?.count ?? 0;
      if (ownerCount <= 1) {
        throw new ValidationError('Cannot remove the final Owner of an organization');
      }
    }

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
 * Fetches an organization by its primary key ID (inside that organization's tenant context).
 */
export async function getOrganizationById(db: Db, id: string) {
  const [org] = await withTenantContext(db, { orgId: id }, (tx) =>
    tx.select().from(orgs).where(eq(orgs.id, id)).limit(1)
  );
  return org ?? null;
}
