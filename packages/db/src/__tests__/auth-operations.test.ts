import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import * as schema from '../schema/index.js';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  getUserOrganizations,
  getMembershipContext,
  createMemberInvitation,
  acceptMemberInvitation,
  updateOrganizationMemberRole,
  removeOrganizationMember,
} from '../auth-operations.js';
import {
  generateUuidV7,
  generateInvitationToken,
  ConflictError,
  ForbiddenError,
  ValidationError,
  UnauthorizedError,
} from '@workspace/core';

describe('Database Authentication & Membership Operations (Real PostgreSQL)', () => {
  const directUrl =
    process.env.DATABASE_DIRECT_URL ||
    'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev?sslmode=disable';

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    sql = postgres(directUrl, { max: 5 });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  describe('User Synchronization & Idempotency', () => {
    it('creates a stable application user with UUIDv7 and case-insensitive email', async () => {
      const email = `test-user-${Date.now()}@workspace.dev`;
      const supabaseUid = `supabase-uid-${Date.now()}`;
      const created = await findOrCreateUserByEmail(db, {
        email: email.toUpperCase(),
        name: 'Test Engineer',
        supabaseUid,
      });

      expect(created.id).toBeDefined();
      expect(created.email).toBe(email.toLowerCase());
      expect(created.supabaseUid).toBe(supabaseUid);

      // Idempotent fetch by different casing
      const fetched = await findOrCreateUserByEmail(db, {
        email: email.toLowerCase(),
      });

      expect(fetched.id).toBe(created.id);
      expect(fetched.email).toBe(created.email);
    });

    it('links new external provider credentials without mutating primary user UUID', async () => {
      const email = `link-user-${Date.now()}@workspace.dev`;
      const initial = await findOrCreateUserByEmail(db, {
        email,
        name: 'Link User',
      });

      expect(initial.supabaseUid).toBeNull();

      const newSupabaseId = `new-supabase-${Date.now()}`;
      const newCognitoSub = `new-cognito-${Date.now()}`;
      const linked = await findOrCreateUserByEmail(db, {
        email,
        supabaseUid: newSupabaseId,
        cognitoSub: newCognitoSub,
      });

      expect(linked.id).toBe(initial.id);
      expect(linked.supabaseUid).toBe(newSupabaseId);
      expect(linked.cognitoSub).toBe(newCognitoSub);
    });
  });

  describe('Atomic Organization Onboarding', () => {
    it('atomically creates an organization and assigns caller as Owner in a single transaction', async () => {
      const user = await findOrCreateUserByEmail(db, {
        email: `founder-${Date.now()}@workspace.dev`,
        name: 'Startup Founder',
      });

      const slug = `startup-${Date.now()}`;
      const { org, membership } = await createOrganizationWithOwner(db, {
        name: 'Startup Corp',
        slug,
        userId: user.id,
      });

      expect(org.id).toBeDefined();
      expect(org.slug).toBe(slug);
      expect(membership.orgId).toBe(org.id);
      expect(membership.userId).toBe(user.id);
      expect(membership.role).toBe('owner');
      expect(membership.sessionEpoch).toBe(1);

      // Verify org listing
      const userOrgs = await getUserOrganizations(db, user.id);
      expect(userOrgs.some((o) => o.orgId === org.id && o.role === 'owner')).toBe(true);
    });

    it('rejects duplicate organization slugs with ConflictError', async () => {
      const user = await findOrCreateUserByEmail(db, {
        email: `slug-user-${Date.now()}@workspace.dev`,
      });

      const slug = `unique-slug-${Date.now()}`;
      await createOrganizationWithOwner(db, {
        name: 'Org A',
        slug,
        userId: user.id,
      });

      await expect(
        createOrganizationWithOwner(db, {
          name: 'Org B',
          slug,
          userId: user.id,
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('Invitations & Role Enforcement', () => {
    it('allows Owner to invite Admin, Member, and Viewer, but rejects duplicate active members', async () => {
      const owner = await findOrCreateUserByEmail(db, { email: `owner-${Date.now()}@workspace.dev` });
      const { org } = await createOrganizationWithOwner(db, {
        name: 'Invite Test Org',
        slug: `invite-org-${Date.now()}`,
        userId: owner.id,
      });

      const token1 = generateInvitationToken();
      const inviteeEmail = `invitee-${Date.now()}@workspace.dev`;

      const invite = await createMemberInvitation(db, {
        orgId: org.id,
        actorUserId: owner.id,
        email: inviteeEmail,
        role: 'admin',
        tokenHash: token1.tokenHash,
        expiresAt: token1.expiresAt,
      });

      expect(invite.id).toBeDefined();
      expect(invite.email).toBe(inviteeEmail);
      expect(invite.role).toBe('admin');

      // Cannot invite someone who is already an active member
      await expect(
        createMemberInvitation(db, {
          orgId: org.id,
          actorUserId: owner.id,
          email: owner.email,
          role: 'member',
          tokenHash: generateInvitationToken().tokenHash,
          expiresAt: token1.expiresAt,
        })
      ).rejects.toThrow(ConflictError);
    });

    it('prevents Admins from inviting or promoting anyone to Owner', async () => {
      const owner = await findOrCreateUserByEmail(db, { email: `owner2-${Date.now()}@workspace.dev` });
      const admin = await findOrCreateUserByEmail(db, { email: `admin-${Date.now()}@workspace.dev` });

      const { org } = await createOrganizationWithOwner(db, {
        name: 'RBAC Test Org',
        slug: `rbac-org-${Date.now()}`,
        userId: owner.id,
      });

      // Add admin directly
      await db.insert(schema.memberships).values({
        orgId: org.id,
        userId: admin.id,
        role: 'admin',
        sessionEpoch: 1,
      });

      // Admin CANNOT invite Owner
      const token = generateInvitationToken();
      await expect(
        createMemberInvitation(db, {
          orgId: org.id,
          actorUserId: admin.id,
          email: `newowner-${Date.now()}@workspace.dev`,
          role: 'owner',
          tokenHash: token.tokenHash,
          expiresAt: token.expiresAt,
        })
      ).rejects.toThrow(ForbiddenError);

      // Admin CAN invite Member
      const validInvite = await createMemberInvitation(db, {
        orgId: org.id,
        actorUserId: admin.id,
        email: `newmember-${Date.now()}@workspace.dev`,
        role: 'member',
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
      });
      expect(validInvite.id).toBeDefined();
    });

    it('accepts valid invitation, enforces email matching, and rejects replay attacks', async () => {
      const owner = await findOrCreateUserByEmail(db, { email: `owner3-${Date.now()}@workspace.dev` });
      const { org } = await createOrganizationWithOwner(db, {
        name: 'Accept Test Org',
        slug: `accept-org-${Date.now()}`,
        userId: owner.id,
      });

      const inviteeEmail = `alice-${Date.now()}@workspace.dev`;
      const token = generateInvitationToken();

      await createMemberInvitation(db, {
        orgId: org.id,
        actorUserId: owner.id,
        email: inviteeEmail,
        role: 'member',
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
      });

      const invitee = await findOrCreateUserByEmail(db, { email: inviteeEmail });

      // Attempt accept with different email fails
      await expect(
        acceptMemberInvitation(db, {
          tokenHash: token.tokenHash,
          userId: invitee.id,
          userEmail: 'eve-impostor@workspace.dev',
        })
      ).rejects.toThrow(UnauthorizedError);

      // Accept with matching email succeeds
      const { membership } = await acceptMemberInvitation(db, {
        tokenHash: token.tokenHash,
        userId: invitee.id,
        userEmail: inviteeEmail,
      });

      expect(membership).toBeDefined();
      expect(membership!.orgId).toBe(org.id);
      expect(membership!.userId).toBe(invitee.id);
      expect(membership!.role).toBe('member');

      // Replay attack: accepting a second time fails
      await expect(
        acceptMemberInvitation(db, {
          tokenHash: token.tokenHash,
          userId: invitee.id,
          userEmail: inviteeEmail,
        })
      ).rejects.toThrow(ConflictError);
    });

    it('rejects expired invitations', async () => {
      const owner = await findOrCreateUserByEmail(db, { email: `owner4-${Date.now()}@workspace.dev` });
      const { org } = await createOrganizationWithOwner(db, {
        name: 'Expire Test Org',
        slug: `expire-org-${Date.now()}`,
        userId: owner.id,
      });

      const inviteeEmail = `expired-invitee-${Date.now()}@workspace.dev`;
      const token = generateInvitationToken();
      // Expired in past
      const pastDate = new Date(Date.now() - 1000);

      await createMemberInvitation(db, {
        orgId: org.id,
        actorUserId: owner.id,
        email: inviteeEmail,
        role: 'member',
        tokenHash: token.tokenHash,
        expiresAt: pastDate,
      });

      const invitee = await findOrCreateUserByEmail(db, { email: inviteeEmail });

      await expect(
        acceptMemberInvitation(db, {
          tokenHash: token.tokenHash,
          userId: invitee.id,
          userEmail: inviteeEmail,
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('Role Modification, Demotion & Session Epoch Invalidation', () => {
    it('increments session_epoch when updating a member role', async () => {
      const owner = await findOrCreateUserByEmail(db, { email: `owner5-${Date.now()}@workspace.dev` });
      const member = await findOrCreateUserByEmail(db, { email: `member5-${Date.now()}@workspace.dev` });

      const { org } = await createOrganizationWithOwner(db, {
        name: 'Epoch Test Org',
        slug: `epoch-org-${Date.now()}`,
        userId: owner.id,
      });

      await db.insert(schema.memberships).values({
        orgId: org.id,
        userId: member.id,
        role: 'member',
        sessionEpoch: 1,
      });

      const initialContext = await getMembershipContext(db, org.id, member.id);
      expect(initialContext?.sessionEpoch).toBe(1);

      // Owner promotes member to admin
      const updated = await updateOrganizationMemberRole(db, {
        orgId: org.id,
        actorUserId: owner.id,
        targetUserId: member.id,
        newRole: 'admin',
      });

      expect(updated).toBeDefined();
      expect(updated!.role).toBe('admin');
      expect(updated!.sessionEpoch).toBe(2); // session_epoch incremented!
    });

    it('prevents demoting the final Owner of an organization', async () => {
      const singleOwner = await findOrCreateUserByEmail(db, { email: `sole-owner-${Date.now()}@workspace.dev` });
      const { org } = await createOrganizationWithOwner(db, {
        name: 'Sole Owner Org',
        slug: `sole-owner-org-${Date.now()}`,
        userId: singleOwner.id,
      });

      await expect(
        updateOrganizationMemberRole(db, {
          orgId: org.id,
          actorUserId: singleOwner.id,
          targetUserId: singleOwner.id,
          newRole: 'admin',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('prevents removing the final Owner of an organization', async () => {
      const singleOwner = await findOrCreateUserByEmail(db, { email: `sole-owner-del-${Date.now()}@workspace.dev` });
      const { org } = await createOrganizationWithOwner(db, {
        name: 'Sole Owner Del Org',
        slug: `sole-owner-del-org-${Date.now()}`,
        userId: singleOwner.id,
      });

      await expect(
        removeOrganizationMember(db, {
          orgId: org.id,
          actorUserId: singleOwner.id,
          targetUserId: singleOwner.id,
        })
      ).rejects.toThrow(ValidationError);
    });

    it('removes member and cleans up private node memberships', async () => {
      const owner = await findOrCreateUserByEmail(db, { email: `owner6-${Date.now()}@workspace.dev` });
      const member = await findOrCreateUserByEmail(db, { email: `member6-${Date.now()}@workspace.dev` });

      const { org } = await createOrganizationWithOwner(db, {
        name: 'Cleanup Org',
        slug: `cleanup-org-${Date.now()}`,
        userId: owner.id,
      });

      await db.insert(schema.memberships).values({
        orgId: org.id,
        userId: member.id,
        role: 'member',
        sessionEpoch: 1,
      });

      // Create a private node and add member
      const nodeId = generateUuidV7();
      await db.insert(schema.nodes).values({
        id: nodeId,
        orgId: org.id,
        kind: 'project',
        name: 'Confidential Alpha',
        path: 'root.alpha',
        visibility: 'private',
      });

      await db.insert(schema.nodeMembers).values({
        orgId: org.id,
        nodeId,
        userId: member.id,
      });

      // Remove member
      await removeOrganizationMember(db, {
        orgId: org.id,
        actorUserId: owner.id,
        targetUserId: member.id,
      });

      // Membership is gone
      const context = await getMembershipContext(db, org.id, member.id);
      expect(context).toBeNull();

      // Node membership is also cleaned up
      const nodeMemRows = await db
        .select()
        .from(schema.nodeMembers)
        .where(and(eq(schema.nodeMembers.orgId, org.id), eq(schema.nodeMembers.userId, member.id)));
      expect(nodeMemRows.length).toBe(0);
    });
  });
});
