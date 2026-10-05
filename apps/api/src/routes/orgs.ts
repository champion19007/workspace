import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  type DatabaseInstance,
  createOrganizationWithOwner,
  getUserOrganizations,
  getOrganizationMembers,
  createMemberInvitation,
  acceptMemberInvitation,
  updateOrganizationMemberRole,
  removeOrganizationMember,
  orgs,
} from '@workspace/db';
import {
  OrgRoleSchema,
  type OrgRole,
  ValidationError,
  generateInvitationToken,
  hashToken,
} from '@workspace/core';
import { eq } from 'drizzle-orm';

const CreateOrgBodySchema = z.object({
  name: z.string().min(2).max(255),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/, 'Slug must be alphanumeric lowercase with dashes'),
  plan: z.string().optional(),
  retentionDays: z.number().int().min(30).max(365).optional(),
});

const InviteMemberBodySchema = z.object({
  email: z.string().email(),
  role: OrgRoleSchema.default('member'),
});

const AcceptInviteBodySchema = z.object({
  token: z.string().min(16),
});

const UpdateRoleBodySchema = z.object({
  role: OrgRoleSchema,
});

export const orgRoutes: FastifyPluginAsync<{ db: DatabaseInstance }> = async (app, { db }) => {
  // 1. Create organization (atomic onboarding with caller as owner)
  app.post(
    '/api/v1/orgs',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const parsed = CreateOrgBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid organization input', parsed.error.format());
      }

      const result = await createOrganizationWithOwner(db, {
        name: parsed.data.name,
        slug: parsed.data.slug,
        userId: request.user!.id,
        plan: parsed.data.plan,
        retentionDays: parsed.data.retentionDays,
      });

      return reply.status(201).send(result);
    }
  );

  // 2. List organizations caller belongs to
  app.get(
    '/api/v1/user/orgs',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const organizations = await getUserOrganizations(db, request.user!.id);
      return reply.status(200).send({ organizations });
    }
  );

  // 3. Organization overview
  app.get(
    '/api/v1/orgs/:orgId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const [org] = await db
        .select()
        .from(orgs)
        .where(eq(orgs.id, request.tenant!.orgId))
        .limit(1);

      return reply.status(200).send({
        org,
        currentRole: request.tenant!.role,
      });
    }
  );

  // 4. List members of organization
  app.get(
    '/api/v1/orgs/:orgId/members',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const members = await getOrganizationMembers(db, request.tenant!.orgId);
      return reply.status(200).send({ members });
    }
  );

  // 5. Create member invitation (Owner/Admin only)
  app.post(
    '/api/v1/orgs/:orgId/invitations',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const parsed = InviteMemberBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid invitation parameters', parsed.error.format());
      }

      const tokenData = generateInvitationToken();
      const invite = await createMemberInvitation(db, {
        orgId: request.tenant!.orgId,
        actorUserId: request.user!.id,
        email: parsed.data.email,
        role: parsed.data.role as OrgRole,
        tokenHash: tokenData.tokenHash,
        expiresAt: tokenData.expiresAt,
      });

      return reply.status(201).send({
        invitation: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expiresAt,
          rawToken: tokenData.rawToken,
        },
      });
    }
  );

  // 6. Accept member invitation
  app.post(
    '/api/v1/invitations/accept',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const parsed = AcceptInviteBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid acceptance parameters', parsed.error.format());
      }

      const tokenHash = hashToken(parsed.data.token);
      const result = await acceptMemberInvitation(db, {
        tokenHash,
        userId: request.user!.id,
        userEmail: request.user!.email,
      });

      return reply.status(200).send(result);
    }
  );

  // 7. Update member role
  app.patch(
    '/api/v1/orgs/:orgId/members/:userId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const params = request.params as { orgId: string; userId: string };
      const parsed = UpdateRoleBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid role update parameter', parsed.error.format());
      }

      const updated = await updateOrganizationMemberRole(db, {
        orgId: request.tenant!.orgId,
        actorUserId: request.user!.id,
        targetUserId: params.userId,
        newRole: parsed.data.role as OrgRole,
      });

      return reply.status(200).send({ membership: updated });
    }
  );

  // 8. Remove member
  app.delete(
    '/api/v1/orgs/:orgId/members/:userId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const params = request.params as { orgId: string; userId: string };

      await removeOrganizationMember(db, {
        orgId: request.tenant!.orgId,
        actorUserId: request.user!.id,
        targetUserId: params.userId,
      });

      return reply.status(200).send({ success: true });
    }
  );
};
