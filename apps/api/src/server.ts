import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  type AppConfig,
  type AppPorts,
  PINO_REDACT_PATHS,
  generateUuidV7,
} from '@workspace/core';
import { createAppPorts } from '@workspace/adapters';
import { createApiClient, checkDatabaseHealth, type Sql, type DatabaseInstance } from '@workspace/db';
import { authPlugin } from './plugins/auth.js';
import { idempotencyPlugin } from './plugins/idempotency.js';
import { concurrencyPlugin } from './plugins/concurrency.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { swaggerPlugin } from './plugins/swagger.js';
import { rfc9457ErrorHandler } from './plugins/error-handler.js';
import { orgRoutes } from './routes/orgs.js';
import { nodeRoutes } from './routes/nodes.js';
import { taskRoutes } from './routes/tasks.js';
import { labelRoutes } from './routes/labels.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { docRoutes } from './routes/docs.js';
import { zoomRoutes } from './routes/zoom.js';
import { webhookRoutes } from './routes/webhooks.js';
import { meetingRoutes } from './routes/meetings.js';

export interface ServerInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any;
  sql: Sql;
  db: DatabaseInstance;
  ports: AppPorts;
  start: () => Promise<void>;
  close: () => Promise<void>;
}

export function buildServer(config: AppConfig): ServerInstance {
  const app = Fastify({
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      if (typeof incoming === 'string' && incoming.trim()) {
        return incoming.trim();
      }
      return generateUuidV7();
    },
    requestIdHeader: 'x-request-id',
    logger: {
      level: config.LOG_LEVEL,
      redact: config.REDACT_SENSITIVE_LOGS ? PINO_REDACT_PATHS : undefined,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
    keepAliveTimeout: 65_000,
  });

  // Capture exact raw request body for webhook HMAC signature verification before JSON parsing
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      const str = (body as Buffer).toString('utf8');
      (req as unknown as { rawBody: string }).rawBody = str;
      const json = str.trim() ? JSON.parse(str) : {};
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const { sql, db } = createApiClient({
    connectionString: config.DATABASE_URL,
    maxConnections: config.DB_API_POOL_SIZE,
  });

  const ports = createAppPorts(config);

  // 1. CORS
  app.register(cors, {
    origin: config.CORS_ORIGIN,
    credentials: true,
  });

  // 2. OpenAPI 3.1 Swagger & UI Documentation
  app.register(swaggerPlugin);

  // 3. Rate Limiting (600 req/min per user, 6000 req/min org, strict auth limits)
  app.register(rateLimitPlugin);

  // 4. Concurrency Plugin (If-Match verification & ETag generation)
  app.register(concurrencyPlugin);

  // 5. Auth Plugin (Authenticate hook & requireOrgContext hook)
  app.register(authPlugin, { config, ports, db });

  // 6. Idempotency Plugin (PostgreSQL-backed for Architecture A)
  app.register(idempotencyPlugin, { db });

  // 7. Domain Routes (Org onboarding, members, invitations, nodes, tasks, labels)
  app.register(orgRoutes, { db, ports });
  app.register(nodeRoutes, { db, ports });
  app.register(taskRoutes, { db, ports });
  app.register(labelRoutes, { db, ports });
  app.register(dashboardRoutes, { db, ports });
  app.register(docRoutes, { db, ports });
  app.register(zoomRoutes, { sql, ports, config });
  app.register(webhookRoutes, { sql, ports, config });
  app.register(meetingRoutes, { sql, ports });

  // 8. RFC 9457 Problem Details Error Handler
  app.setErrorHandler(rfc9457ErrorHandler);

  // 9. Attach x-request-id header to all HTTP responses
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });

  // 10. Liveness check: verifies process is alive and responsive without external dependencies
  app.get('/healthz', async (_request, reply) => {
    return reply.status(200).send({
      status: 'pass',
      process: 'api',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // 10. Readiness check: verifies external dependencies (DB connection pool & ports)
  app.get('/readyz', async (_request, reply) => {
    const dbHealth = await checkDatabaseHealth(sql);
    const queueHealth = await ports.queue.checkHealth();
    const realtimeHealth = await ports.realtime.checkHealth();

    const isReady = dbHealth.healthy && queueHealth.healthy && realtimeHealth.healthy;
    const statusCode = isReady ? 200 : 503;

    return reply.status(statusCode).send({
      status: isReady ? 'ready' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbHealth,
        queue: queueHealth,
        realtime: realtimeHealth,
      },
    });
  });

  // 11. Foundation status endpoint
  app.get('/api/v1/status', async (_request, reply) => {
    return reply.status(200).send({
      environment: config.APP_ENV,
      architectureTier: config.ARCHITECTURE_TIER,
      providers: {
        queue: ports.queue.provider,
        realtime: ports.realtime.provider,
        llm: ports.llm.provider,
        blobStore: ports.blobStore.provider,
        auth: ports.auth.provider,
      },
      stage: 'Stage 1 of 25 (Foundation, Adapters, Outbox & Background Jobs)',
      readyForStage2: true,
      readyForStage6: true,
    });
  });

  const start = async (): Promise<void> => {
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info({ port: config.PORT, host: config.HOST }, 'Fastify API server started');
  };

  const close = async (): Promise<void> => {
    app.log.info('Draining in-flight requests and shutting down Fastify...');
    await app.close();
    await sql.end({ timeout: 5 });
    app.log.info('Fastify API shutdown completed cleanly');
  };

  return { app, sql, db, ports, start, close };
}
