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
  insertOutboxEvent,
  getOrganizationById,
} from '@workspace/db';
import {
  OrgRoleSchema,
  type OrgRole,
  type AppPorts,
  ValidationError,
  generateInvitationToken,
  hashToken,
  generateUuidV7,
  PaginationQuerySchema,
  decodeCursor,
  encodeCursor,
  formatETag,
} from '@workspace/core';

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

const SystemPingBodySchema = z.object({
  pingId: z.string().uuid().optional(),
  message: z.string().optional(),
});

// In-memory test OCC map for concurrency testing across stages
const OCC_TEST_STORE = new Map<string, { id: string; version: number; name: string; updatedAt: string }>();

export const orgRoutes: FastifyPluginAsync<{ db: DatabaseInstance; ports?: AppPorts }> = async (
  app,
  { db, ports }
) => {
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
      const org = await getOrganizationById(db, request.tenant!.orgId);

      return reply.status(200).send({
        org,
        currentRole: request.tenant!.role,
      });
    }
  );

  // 4. List members of organization with cursor pagination & updatedSince filtering
  app.get(
    '/api/v1/orgs/:orgId/members',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const queryParsed = PaginationQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        throw new ValidationError('Invalid pagination query parameters', queryParsed.error.format());
      }

      const { limit, cursor, updatedSince } = queryParsed.data;
      let allMembers = await getOrganizationMembers(db, request.tenant!.orgId, request.user!.id);

      // Apply updatedSince filter if provided
      if (updatedSince) {
        const sinceDate = new Date(updatedSince);
        allMembers = allMembers.filter((m) => m.joinedAt >= sinceDate);
      }

      // Sort stably by joinedAt ASC, tie-breaker userId ASC
      allMembers.sort((a, b) => {
        const timeDiff = a.joinedAt.getTime() - b.joinedAt.getTime();
        return timeDiff !== 0 ? timeDiff : a.userId.localeCompare(b.userId);
      });

      // Apply cursor if provided
      let startIndex = 0;
      if (cursor) {
        const decoded = decodeCursor(cursor);
        const foundIndex = allMembers.findIndex((m) => m.userId === decoded.id);
        if (foundIndex >= 0) {
          startIndex = foundIndex + 1;
        }
      }

      const paginatedSlice = allMembers.slice(startIndex, startIndex + limit);
      const hasNextPage = startIndex + limit < allMembers.length;

      let endCursor: string | undefined;
      if (paginatedSlice.length > 0) {
        const last = paginatedSlice[paginatedSlice.length - 1];
        if (last) {
          endCursor = encodeCursor({
            id: last.userId,
            val: last.joinedAt.toISOString(),
            dir: 'asc',
          });
        }
      }

      return reply.status(200).send({
        members: paginatedSlice,
        items: paginatedSlice,
        pageInfo: {
          hasNextPage,
          ...(endCursor ? { endCursor } : {}),
          totalCount: allMembers.length,
        },
      });
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
        throw new ValidationError('Invalid invitation parameters', parsed.error.issues);
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
        throw new ValidationError('Invalid acceptance parameters', parsed.error.issues);
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
        throw new ValidationError('Invalid role update parameter', parsed.error.issues);
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

  // 9. System Ping Proof Job & Transactional Outbox test
  app.post(
    '/api/v1/system/ping',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const parsed = SystemPingBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        throw new ValidationError('Invalid system ping payload', parsed.error.format());
      }

      const pingId = parsed.data.pingId || generateUuidV7();
      const timestamp = new Date().toISOString();
      const orgId = request.tenant?.orgId;

      // 1. Transactional write to outbox table
      let outboxId: string | null = null;
      if (orgId) {
        outboxId = await insertOutboxEvent(db, {
          orgId,
          topic: 'system.ping',
          payload: { pingId, timestamp, requestedBy: request.user!.id },
        });
      }

      // 2. Direct enqueue to queue port if configured
      if (ports) {
        await ports.queue.enqueue('system.ping', {
          pingId,
          timestamp,
          orgId,
        });
      }

      return reply.status(202).send({
        status: 'queued',
        job: 'system.ping',
        pingId,
        outboxId,
        timestamp,
      });
    }
  );

  // 10. Optimistic Concurrency Control (OCC) test route
  app.get(
    '/api/v1/orgs/:orgId/concurrency-resource',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const orgId = request.tenant!.orgId;
      let resource = OCC_TEST_STORE.get(orgId);
      if (!resource) {
        resource = {
          id: orgId,
          version: 1,
          name: request.tenant!.orgSlug,
          updatedAt: new Date().toISOString(),
        };
        OCC_TEST_STORE.set(orgId, resource);
      }

      reply.header('ETag', formatETag(resource.version));
      return reply.status(200).send(resource);
    }
  );

  app.patch(
    '/api/v1/orgs/:orgId/concurrency-resource',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const orgId = request.tenant!.orgId;
      let resource = OCC_TEST_STORE.get(orgId);
      if (!resource) {
        resource = {
          id: orgId,
          version: 1,
          name: request.tenant!.orgSlug,
          updatedAt: new Date().toISOString(),
        };
        OCC_TEST_STORE.set(orgId, resource);
      }

      // Verify If-Match header against current entity version
      app.verifyIfMatch(request, resource.version, resource);

      const body = request.body as { name?: string };
      const updated = {
        id: orgId,
        version: resource.version + 1,
        name: body?.name || `${resource.name}-updated`,
        updatedAt: new Date().toISOString(),
      };
      OCC_TEST_STORE.set(orgId, updated);

      reply.header('ETag', formatETag(updated.version));
      return reply.status(200).send(updated);
    }
  );

  // 11. Idempotency mutation test route
  app.post(
    '/api/v1/orgs/:orgId/idempotency-test',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const body = request.body as { name?: string; count?: number };
      const generatedId = generateUuidV7();
      return reply.status(201).send({
        createdId: generatedId,
        name: body?.name ?? 'item',
        count: body?.count ?? 1,
        processedAt: new Date().toISOString(),
      });
    }
  );
};

