import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  type AppConfig,
  type AppPorts,
  DomainError,
  PINO_REDACT_PATHS,
} from '@workspace/core';
import { createAppPorts } from '@workspace/adapters';
import { createApiClient, checkDatabaseHealth, type Sql } from '@workspace/db';
import { authPlugin } from './plugins/auth.js';
import { orgRoutes } from './routes/orgs.js';

export interface ServerInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any;
  sql: Sql;
  ports: AppPorts;
  start: () => Promise<void>;
  close: () => Promise<void>;
}

export function buildServer(config: AppConfig): ServerInstance {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: config.REDACT_SENSITIVE_LOGS ? PINO_REDACT_PATHS : undefined,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
    keepAliveTimeout: 65_000,
  });

  const { sql, db } = createApiClient({
    connectionString: config.DATABASE_URL,
    maxConnections: config.DB_API_POOL_SIZE,
  });

  const ports = createAppPorts(config);

  // Register CORS
  app.register(cors, {
    origin: config.CORS_ORIGIN,
    credentials: true,
  });

  // Register Auth plugin and Org routes
  app.register(authPlugin, { config, ports, db });
  app.register(orgRoutes, { db });

  // RFC 9457 Problem Details Error Handler
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Request processing error');

    if (error instanceof DomainError) {
      reply.header('content-type', 'application/problem+json');
      return reply.status(error.status).send({
        type: `https://api.workspace.dev/errors/${error.code.toLowerCase()}`,
        title: error.message,
        status: error.status,
        detail: error.message,
        code: error.code,
        details: error.details,
      });
    }

    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode ?? 500;
    reply.header('content-type', 'application/problem+json');
    return reply.status(statusCode).send({
      type: 'https://api.workspace.dev/errors/internal-error',
      title: statusCode === 500 ? 'Internal Server Error' : err.message,
      status: statusCode,
      detail: statusCode === 500 ? 'An unexpected server error occurred' : err.message,
      code: 'INTERNAL_ERROR',
    });
  });

  // 1. Liveness check: verifies process is alive and responsive without touching external dependencies
  app.get('/healthz', async (_request, reply) => {
    return reply.status(200).send({
      status: 'pass',
      process: 'api',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Readiness check: verifies external dependencies (DB connection pool & ports)
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

  // 3. Foundation status endpoint
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
      stage: 'Stage 1 of 25 (Foundation)',
      readyForStage2: true,
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

  return { app, sql, ports, start, close };
}
