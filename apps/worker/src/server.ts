import Fastify from 'fastify';
import { type AppConfig, type AppPorts, PINO_REDACT_PATHS } from '@workspace/core';
import { createAppPorts } from '@workspace/adapters';
import {
  createWorkerClient,
  checkDatabaseHealth,
  recomputeAndStoreNodeRollup,
  processDueRollupJobs,
  type Sql,
  type DatabaseInstance,
} from '@workspace/db';
import { OutboxRelay } from './relay.js';
import { ZoomRecordingPoller } from './poller.js';
import { handleTranscriptReadyJob, recoverReadyMeetings } from './transcript-handler.js';
import { handleTranscriptIngestedJob } from './routing-handler.js';
import { handleMeetingRoutedJob } from './extraction-handler.js';
import { handleSuggestionsCreatedJob } from './enrichment-handler.js';

export interface WorkerInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any;
  sql: Sql;
  db: DatabaseInstance;
  ports: AppPorts;
  relay: OutboxRelay;
  poller: ZoomRecordingPoller;
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

  const { sql, db } = createWorkerClient({
    connectionString: config.DATABASE_DIRECT_URL,
    maxConnections: config.DB_WORKER_POOL_SIZE,
  });

  const ports = createAppPorts(config);

  const relay = new OutboxRelay(sql, db, ports, app.log, {
    pollIntervalMs: 500,
    leaseSeconds: 60,
    retentionDays: 7,
  });

  const poller = new ZoomRecordingPoller(sql, ports, app.log, {
    pollIntervalMs: 30 * 60 * 1000,
  });

  // Liveness check for worker
  app.get('/healthz', async (_request, reply) => {
    return reply.status(200).send({
      status: 'pass',
      process: 'worker',
      uptimeSeconds: Math.round(process.uptime()),
      pollingActive: relay.active,
      zoomPollerActive: poller.active,
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

    // Register internal background job consumers
    if (ports.queue.subscribe) {
      await ports.queue.subscribe('system.ping', async (data) => {
        app.log.info({ pingId: data.pingId, timestamp: data.timestamp }, 'Worker handled system.ping job');
      });
      await ports.queue.subscribe('org.maintenance', async (data) => {
        app.log.info({ orgId: data.orgId, task: data.task }, 'Worker handled org.maintenance job');
        if (data.task === 'purge_outbox' || data.task === 'cleanup_idempotency') {
          await relay.runRetentionCleanup();
        } else if (data.task === 'rollup_recompute') {
          await processDueRollupJobs(sql, { workerId: relay.workerId });
        }
      });
      await ports.queue.subscribe('rollup', async (data) => {
        app.log.info({ orgId: data.orgId, nodeId: data.nodeId }, 'Worker handling rollup job');
        await recomputeAndStoreNodeRollup(sql, { orgId: data.orgId, nodeId: data.nodeId });
      });
      await ports.queue.subscribe('meeting.transcript_ready', async (data) => {
        app.log.info({ orgId: data.orgId, meetingId: data.meetingId }, 'Worker handling meeting.transcript_ready job');
        await handleTranscriptReadyJob(sql, ports, app.log, data);
      });
      await ports.queue.subscribe('meeting.transcript_ingested', async (data) => {
        app.log.info({ orgId: data.orgId, meetingId: data.meetingId }, 'Worker handling meeting.transcript_ingested job');
        await handleTranscriptIngestedJob(sql, ports, app.log, data);
      });
      await ports.queue.subscribe('meeting.routed', async (data) => {
        app.log.info({ orgId: data.orgId, meetingId: data.meetingId }, 'Worker handling meeting.routed job');
        await handleMeetingRoutedJob(sql, ports, app.log, data);
      });
      await ports.queue.subscribe('meeting.suggestions_created', async (data) => {
        app.log.info({ orgId: data.orgId, meetingId: data.meetingId }, 'Worker handling meeting.suggestions_created job');
        await handleSuggestionsCreatedJob(sql, ports, app.log, data);
      });
    }

    relay.start();
    poller.start();

    // Startup recovery sweep for ready meetings
    recoverReadyMeetings(sql, ports, app.log).catch((err) => {
      app.log.error({ err }, 'Error in worker startup ready-meetings recovery');
    });

    app.log.info({ port: config.WORKER_PORT }, 'Worker internal health server, outbox relay, and Zoom poller started');
  };

  const stop = async (): Promise<void> => {
    app.log.info('Stopping worker background loops and polling...');
    await poller.stop();
    await relay.stop();

    await ports.queue.stop();
    await app.close();
    await sql.end({ timeout: 5 });
    app.log.info('Worker process shutdown completed cleanly');
  };

  return { app, sql, db, ports, relay, poller, start, stop };
}
