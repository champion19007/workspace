import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import crypto from 'node:crypto';
import {
  type DatabaseInstance,
  checkOrCreateIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
} from '@workspace/db';
import {
  IdempotencyConflictError,
  ValidationError,
} from '@workspace/core';

export interface IdempotencyPluginOptions {
  db: DatabaseInstance;
}

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string;
    idempotencyFingerprint?: string;
    isIdempotentReplay?: boolean;
  }
}

export function computeRequestFingerprint(method: string, url: string, body: unknown): string {
  const content = `${method.toUpperCase()}:${url}:${JSON.stringify(body ?? {})}`;
  return crypto.createHash('sha256').update(content).digest('hex');
}

const idempotencyPluginInner: FastifyPluginAsync<IdempotencyPluginOptions> = async (app, options) => {
  const { db } = options;

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only apply to POST requests with Idempotency-Key header
    if (request.method !== 'POST') return;

    const rawKey = request.headers['idempotency-key'] as string | undefined;
    if (!rawKey) return;

    const key = rawKey.trim();
    if (!key || key.length > 128) {
      throw new ValidationError('Idempotency-Key header must be between 1 and 128 characters');
    }

    // Ensure user identity is resolved first
    if (!request.user && typeof (app as any).authenticate === 'function') {
      await (app as any).authenticate(request, reply);
    }

    // Ensure tenant context is resolved if request has orgSlug or orgId parameter
    const orgIdentifier = (request.params as any)?.orgSlug || (request.params as any)?.orgId;
    if (!request.tenant && orgIdentifier && typeof (app as any).requireOrgContext === 'function') {
      await (app as any).requireOrgContext(request, reply);
    }

    // Tenant and User must be resolved prior to idempotency evaluation
    if (!request.user || !request.tenant) return;

    const fingerprint = computeRequestFingerprint(request.method, request.url, request.body);

    const checkResult = await checkOrCreateIdempotencyKey(db, {
      orgId: request.tenant.orgId,
      actorId: request.user.id,
      key,
      operation: request.routeOptions.url || request.url,
      fingerprint,
    });

    if (checkResult.state === 'in_flight') {
      throw new IdempotencyConflictError(
        'An identical request is currently being processed with this idempotency key. Please wait before retrying.'
      );
    }

    if (checkResult.state === 'fingerprint_mismatch') {
      throw new ValidationError(
        'The provided Idempotency-Key has already been used with a different request payload or endpoint.'
      );
    }

    if (checkResult.state === 'replay') {
      request.isIdempotentReplay = true;
      reply.header('x-idempotent-replayed', 'true');
      if (checkResult.headers) {
        for (const [k, v] of Object.entries(checkResult.headers)) {
          reply.header(k, v);
        }
      }
      return reply.status(checkResult.statusCode).send(checkResult.responseBody);
    }

    // New key registered in pending state
    request.idempotencyKey = key;
    request.idempotencyFingerprint = fingerprint;
  });

  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (!request.idempotencyKey || !request.tenant || !request.user || request.isIdempotentReplay) {
      return payload;
    }

    if (reply.statusCode < 400) {
      let parsedBody: unknown;
      if (typeof payload === 'string') {
        try {
          parsedBody = JSON.parse(payload);
        } catch {
          parsedBody = payload;
        }
      } else {
        parsedBody = payload;
      }

      await completeIdempotencyKey(db, {
        orgId: request.tenant.orgId,
        actorId: request.user.id,
        key: request.idempotencyKey,
        statusCode: reply.statusCode,
        headers: { 'content-type': 'application/json' },
        responseBody: parsedBody,
      });
    } else {
      await failIdempotencyKey(db, {
        orgId: request.tenant.orgId,
        actorId: request.user.id,
        key: request.idempotencyKey,
        statusCode: reply.statusCode,
      });
    }

    return payload;
  });
};

export const idempotencyPlugin = fp(idempotencyPluginInner, {
  name: 'idempotency-plugin',
});
