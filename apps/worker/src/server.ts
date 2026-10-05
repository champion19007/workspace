import Fastify from 'fastify';
import { type AppConfig, type AppPorts, PINO_REDACT_PATHS } from '@workspace/core';
import { createAppPorts } from '@workspace/adapters';
import { createWorkerClient, checkDatabaseHealth, type Sql } from '@workspace/db';

export interface WorkerInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any;
  sql: Sql;
  ports: AppPorts;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function buildWorker(config: AppConfig): WorkerInstance {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: config.REDACT_SENSITIVE_LOGS ? PINO_REDACT_PATHS : undefined,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
  });

  const { sql } = createWorkerClient({
    connectionString: config.DATABASE_DIRECT_URL,
    maxConnections: config.DB_WORKER_POOL_SIZE,
  });

  const ports = createAppPorts(config);
  let isPolling = false;
  let pollingInterval: NodeJS.Timeout | null = null;

  // Liveness check for worker
  app.get('/healthz', async (_request, reply) => {
    return reply.status(200).send({
      status: 'pass',
      process: 'worker',
      uptimeSeconds: Math.round(process.uptime()),
      pollingActive: isPolling,
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness check for worker (verifies direct db session and queue)
  app.get('/readyz', async (_request, reply) => {
    const dbHealth = await checkDatabaseHealth(sql);
    const queueHealth = await ports.queue.checkHealth();
    const isReady = dbHealth.healthy && queueHealth.healthy;
    const statusCode = isReady ? 200 : 503;

    return reply.status(statusCode).send({
      status: isReady ? 'ready' : 'unhealthy',
      checks: { database: dbHealth, queue: queueHealth },
      timestamp: new Date().toISOString(),
    });
  });

  const start = async (): Promise<void> => {
    await app.listen({ port: config.WORKER_PORT, host: config.HOST });
    await ports.queue.start();
    isPolling = true;

    // Outbox relay loop placeholder for Stage 5
    pollingInterval = setInterval(() => {
      if (!isPolling) return;
    }, 1000);

    app.log.info({ port: config.WORKER_PORT }, 'Worker internal health server and background loops started');
  };

  const stop = async (): Promise<void> => {
    app.log.info('Stopping worker background loops and polling...');
    isPolling = false;
    if (pollingInterval) clearInterval(pollingInterval);

    await ports.queue.stop();
    await app.close();
    await sql.end({ timeout: 5 });
    app.log.info('Worker process shutdown completed cleanly');
  };

  return { app, sql, ports, start, stop };
}
