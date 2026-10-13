import type { FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';
import {
  ActionItemDecisionSchema,
  ListActionItemsQuerySchema,
  ValidationError,
  formatETag,
} from '@workspace/core';
import { decideActionItem, getActionItemForUser, listActionItemsForReview } from '@workspace/db';

/**
 * Stage 17 approval API (Requirement N-2). Authorisation is centralised in
 * authorizeActionItemAccess (delegates to authorizeMeetingAccess).
 */
export const actionItemRoutes: FastifyPluginAsync<{ sql: Sql }> = async (app, { sql }) => {
  // Permission-filtered approval inbox
  app.get(
    '/api/v1/orgs/:orgSlug/action-items',
    { preHandler: [app.authenticate, app.requireOrgContext] },
    async (request, reply) => {
      const parsed = ListActionItemsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError('Invalid action item query parameters', parsed.error.format());
      }
      const page = await listActionItemsForReview(sql, {
        orgId: request.tenant!.orgId,
        userId: request.user!.id,
        role: request.tenant!.role,
        query: parsed.data,
      });
      return reply.status(200).send(page);
    }
  );

  app.get(
    '/api/v1/orgs/:orgSlug/action-items/:actionItemId',
    { preHandler: [app.authenticate, app.requireOrgContext] },
    async (request, reply) => {
      const { actionItemId } = request.params as { actionItemId: string };
      const item = await getActionItemForUser(sql, {
        orgId: request.tenant!.orgId,
        actionItemId,
        userId: request.user!.id,
        role: request.tenant!.role,
      });
      reply.header('ETag', formatETag(item.version!));
      return reply.status(200).send(item);
    }
  );

  // Human decision: approve | edit | reject. Requires If-Match "v{version}"; Idempotency-Key supported.
  app.post(
    '/api/v1/orgs/:orgSlug/action-items/:actionItemId/decision',
    { preHandler: [app.authenticate, app.requireOrgContext] },
    async (request, reply) => {
      const { actionItemId } = request.params as { actionItemId: string };
      const parsed = ActionItemDecisionSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid decision payload', parsed.error.format());
      }

      const params = {
        orgId: request.tenant!.orgId,
        actionItemId,
        userId: request.user!.id,
        role: request.tenant!.role,
      };
      // 404/403 before any precondition so private items never leak through 428/412.
      const current = await getActionItemForUser(sql, { ...params, action: 'decide' });
      const expectedVersion = app.verifyIfMatch(request, current.version!, current);

      const result = await decideActionItem(sql, { ...params, expectedVersion, input: parsed.data });
      reply.header('ETag', formatETag(result.actionItem.version!));
      return reply.status(200).send(result);
    }
  );
};
