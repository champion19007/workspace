import type { FastifyPluginAsync } from 'fastify';
import {
  type AppConfig,
  type AppPorts,
  AuthorizeZoomRequestSchema,
  ZoomCallbackRequestSchema,
  UpdateZoomHostConsentSchema,
  UpdateMyConsentSchema,
  ForbiddenError,
  ValidationError,
} from '@workspace/core';
import {
  type Sql,
  createOAuthState,
  consumeOAuthState,
  getZoomIntegration,
  connectZoomIntegration,
  disconnectZoomIntegration,
  listZoomHostConsents,
  updateZoomHostConsent,
  getMyHostConsent,
  updateMyHostConsent,
} from '@workspace/db';

export interface ZoomRoutesOptions {
  sql: Sql;
  ports: AppPorts;
  config: AppConfig;
}

export const zoomRoutes: FastifyPluginAsync<ZoomRoutesOptions> = async (
  app,
  { sql, ports, config }
) => {
  // 1. Get Zoom integration status for organization
  app.get(
    '/api/v1/orgs/:orgSlug/integrations/zoom',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const integration = await getZoomIntegration(sql, request.tenant!.orgId, request.user!.id);
      return reply.status(200).send({ integration });
    }
  );

  // 2. Initiate Zoom connection (OAuth Authorize URL generation)
  // Restricted to organization Owners and Admins
  app.post(
    '/api/v1/orgs/:orgSlug/integrations/zoom/authorize',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      if (request.tenant!.role !== 'owner' && request.tenant!.role !== 'admin') {
        throw new ForbiddenError('Only organization Owners or Admins can connect integrations');
      }

      const parsed = AuthorizeZoomRequestSchema.safeParse(request.body || {});
      if (!parsed.success) {
        throw new ValidationError('Invalid authorize request body', parsed.error.format());
      }

      const redirectUri = parsed.data.redirectUri || config.ZOOM_REDIRECT_URI;
      const sessionId =
        (request.headers['x-workspace-session-id'] as string | undefined) ||
        request.user!.id;

      const { state, codeChallenge } = await createOAuthState(sql, {
        orgId: request.tenant!.orgId,
        userId: request.user!.id,
        sessionId,
        redirectUri,
      });

      const authorizationUrl = ports.zoomClient.getAuthorizationUrl({
        state,
        redirectUri,
        codeChallenge,
      });

      return reply.status(200).send({
        authorizationUrl,
        state,
        redirectUri,
      });
    }
  );

  // 3. Handle Zoom OAuth Callback (Atomic state consumption, token exchange, account resolution)
  // Restricted to organization Owners and Admins
  app.post(
    '/api/v1/orgs/:orgSlug/integrations/zoom/callback',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      if (request.tenant!.role !== 'owner' && request.tenant!.role !== 'admin') {
        throw new ForbiddenError('Only organization Owners or Admins can connect integrations');
      }

      const parsed = ZoomCallbackRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid callback payload', parsed.error.format());
      }

      // Atomically consume state (single-use guarantee, expiration, tenant verification)
      const stateRow = await consumeOAuthState(sql, {
        state: parsed.data.state,
        orgId: request.tenant!.orgId,
        userId: request.user!.id,
      });

      // Exchange authorization code for tokens
      const tokens = await ports.zoomClient.exchangeCode({
        code: parsed.data.code,
        redirectUri: stateRow.redirectUri,
        codeVerifier: stateRow.codeVerifier,
      });

      // Resolve authorized Zoom user and account identity
      const zoomUser = await ports.zoomClient.getCurrentUser(tokens.access_token);
      const accountName =
        [zoomUser.firstName, zoomUser.lastName].filter(Boolean).join(' ') ||
        zoomUser.email;

      // Connect integration with multi-tenant collision check and secret store persistence
      const integration = await connectZoomIntegration(
        sql,
        ports.secretStore,
        ports.zoomClient,
        {
          orgId: request.tenant!.orgId,
          userId: request.user!.id,
          accountId: zoomUser.accountId,
          accountName,
          accountEmail: zoomUser.email,
          scopes: tokens.scope.split(' '),
          tokens,
        }
      );

      return reply.status(200).send({
        success: true,
        integration,
      });
    }
  );

  // 4. Disconnect Zoom integration (Revoke tokens, purge secret, emit audit event)
  // Restricted to organization Owners and Admins
  app.delete(
    '/api/v1/orgs/:orgSlug/integrations/zoom',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      if (request.tenant!.role !== 'owner' && request.tenant!.role !== 'admin') {
        throw new ForbiddenError('Only organization Owners or Admins can disconnect integrations');
      }

      const integration = await disconnectZoomIntegration(
        sql,
        ports.secretStore,
        ports.zoomClient,
        {
          orgId: request.tenant!.orgId,
          userId: request.user!.id,
          role: request.tenant!.role,
        }
      );

      return reply.status(200).send({
        success: true,
        integration,
      });
    }
  );

  // 5. List discovered hosts and consent statuses
  app.get(
    '/api/v1/orgs/:orgSlug/integrations/zoom/hosts',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const query = request.query as { query?: string; consentStatus?: string };
      const hosts = await listZoomHostConsents(sql, {
        orgId: request.tenant!.orgId,
        query: query.query,
        consentStatus: query.consentStatus,
      });

      return reply.status(200).send({ hosts });
    }
  );

  // 6. Update host consent or admin processing override
  app.patch(
    '/api/v1/orgs/:orgSlug/integrations/zoom/hosts/:zoomUserId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { zoomUserId } = request.params as { zoomUserId: string };
      const parsed = UpdateZoomHostConsentSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid host consent update data', parsed.error.format());
      }

      const host = await updateZoomHostConsent(sql, {
        orgId: request.tenant!.orgId,
        zoomUserId,
        consentStatus: parsed.data.consentStatus,
        adminDisabled: parsed.data.adminDisabled,
        role: request.tenant!.role,
        userId: request.user!.id,
      });

      return reply.status(200).send({ host });
    }
  );

  // 7. Get caller's own host consent status (self-service)
  const handleGetMyConsent = async (
    request: any,
    reply: any
  ) => {
    const consent = await getMyHostConsent(sql, {
      orgId: request.tenant!.orgId,
      userId: request.user!.id,
      userEmail: request.user!.email,
    });

    return reply.status(200).send({ consent });
  };

  app.get(
    '/api/v1/orgs/:orgSlug/zoom/my-consent',
    { preHandler: [app.authenticate, app.requireOrgContext] },
    handleGetMyConsent
  );
  app.get(
    '/api/v1/orgs/:orgSlug/integrations/zoom/my-consent',
    { preHandler: [app.authenticate, app.requireOrgContext] },
    handleGetMyConsent
  );

  // 8. Update caller's own host consent status (self-service opt-in/opt-out)
  const handlePatchMyConsent = async (
    request: any,
    reply: any
  ) => {
    const parsed = UpdateMyConsentSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid host consent update data', parsed.error.format());
    }

    const consent = await updateMyHostConsent(sql, {
      orgId: request.tenant!.orgId,
      userId: request.user!.id,
      userEmail: request.user!.email,
      userName: request.user!.name,
      consentStatus: parsed.data.consentStatus,
    });

    return reply.status(200).send({ consent });
  };

  app.patch(
    '/api/v1/orgs/:orgSlug/zoom/my-consent',
    { preHandler: [app.authenticate, app.requireOrgContext] },
    handlePatchMyConsent
  );
  app.patch(
    '/api/v1/orgs/:orgSlug/integrations/zoom/my-consent',
    { preHandler: [app.authenticate, app.requireOrgContext] },
    handlePatchMyConsent
  );
};
