import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import fastifyRateLimit from '@fastify/rate-limit';

const rateLimitPluginInner: FastifyPluginAsync = async (app) => {
  await app.register(fastifyRateLimit, {
    global: true,
    max: 600, // 600 req/min per user
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      // Rate limit per authenticated user if present; fallback to IP
      const user = (req as any).user;
      return user?.id ? `usr:${user.id}` : `ip:${req.ip}`;
    },
    errorResponseBuilder: (_req, context) => {
      const retryAfterSeconds = Math.max(1, Math.ceil(context.ttl / 1000));
      return {
        type: 'https://api.workspace.dev/errors/rate-limit-exceeded',
        title: 'Too Many Requests',
        status: 429,
        detail: `Rate limit of ${context.max} requests per minute exceeded. Please retry in ${retryAfterSeconds} seconds.`,
        code: 'RATE_LIMIT_EXCEEDED',
        details: {
          retryAfterSeconds,
          limit: context.max,
        },
      };
    },
  });
};

export const rateLimitPlugin = fp(rateLimitPluginInner, {
  name: 'rate-limit-plugin',
});
