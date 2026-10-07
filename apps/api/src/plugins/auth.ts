import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import {
  type AppConfig,
  type AppPorts,
  type OrgRole,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  verifyInternalApiRequest,
} from '@workspace/core';
import {
  type DatabaseInstance,
  getOrganizationByIdOrSlug,
  getMembershipContext,
} from '@workspace/db';

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface TenantContextData {
  orgId: string;
  orgSlug: string;
  role: OrgRole;
  sessionEpoch: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireOrgContext: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user?: AuthenticatedUser;
    tenant?: TenantContextData;
  }
}

export interface AuthPluginOptions {
  config: AppConfig;
  ports: AppPorts;
  db: DatabaseInstance;
}

const authPluginInner: FastifyPluginAsync<AuthPluginOptions> = async (app, options) => {
  const { config, ports, db } = options;

  /**
   * Pre-handler hook verifying user identity.
   * Accepts authenticated internal headers from the trusted BFF (HMAC-SHA256 verified)
   * or a bearer token verified via the AuthPort.
   */
  app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    // 1. Check internal BFF signature headers
    const userIdHeader = request.headers['x-workspace-user-id'] as string | undefined;
    const emailHeader = request.headers['x-workspace-user-email'] as string | undefined;
    const timestampHeader = request.headers['x-workspace-timestamp'] as string | undefined;
    const signatureHeader = request.headers['x-workspace-signature'] as string | undefined;

    if (userIdHeader && emailHeader && timestampHeader && signatureHeader) {
      const timestamp = parseInt(timestampHeader, 10);
      const isValid = verifyInternalApiRequest(
        { userId: userIdHeader, email: emailHeader, timestamp },
        signatureHeader,
        config.ORIGIN_VERIFY_SECRET,
        300
      );

      if (!isValid) {
        throw new UnauthorizedError('Invalid internal request signature or expired timestamp');
      }

      request.user = {
        id: userIdHeader,
        email: emailHeader.toLowerCase(),
      };
      return;
    }

    // 2. Check Bearer authorization header
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      try {
        const verified = await ports.auth.verifySessionToken(token);
        if (!verified || !('id' in verified) || !verified.id) {
          throw new UnauthorizedError('Invalid session token');
        }
        request.user = {
          id: verified.id,
          email: verified.email.toLowerCase(),
        };
        return;
      } catch (err) {
        throw new UnauthorizedError('Bearer token verification failed', err);
      }
    }

    throw new UnauthorizedError('Authentication credentials required');
  });

  /**
   * Pre-handler hook resolving organization context from route path parameter (:orgId or :orgSlug).
   * Verifies caller is a member, checks session_epoch, and decorates request.tenant.
   */
  app.decorate('requireOrgContext', async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.user) {
      throw new UnauthorizedError('User authentication must run before organization resolution');
    }

    const params = request.params as { orgId?: string; orgSlug?: string; org?: string };
    const orgIdentifier = params.orgId ?? params.orgSlug ?? params.org;

    if (!orgIdentifier) {
      throw new NotFoundError('Missing organization identifier in path');
    }

    // Resolve org by UUID or slug
    const org = await getOrganizationByIdOrSlug(db, orgIdentifier);
    if (!org) {
      throw new NotFoundError(`Organization "${orgIdentifier}" was not found`);
    }

    // Query user membership
    const membership = await getMembershipContext(db, org.id, request.user.id);
    if (!membership) {
      throw new ForbiddenError(`You do not have access to organization "${org.slug}"`);
    }

    // Check session_epoch revocation if provided in header
    const requestedEpochHeader = request.headers['x-workspace-session-epoch'] as string | undefined;
    if (requestedEpochHeader) {
      const requestedEpoch = parseInt(requestedEpochHeader, 10);
      if (!isNaN(requestedEpoch) && requestedEpoch < membership.sessionEpoch) {
        throw new UnauthorizedError('Session has been revoked or permissions have changed. Please refresh session.');
      }
    }

    request.tenant = {
      orgId: org.id,
      orgSlug: org.slug,
      role: membership.role as OrgRole,
      sessionEpoch: membership.sessionEpoch,
    };
  });
};

export const authPlugin = fp(authPluginInner, {
  name: 'auth-plugin',
});
