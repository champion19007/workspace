import {
  type Sql,
  type DatabaseInstance,
  claimOutboxBatch,
  markOutboxDelivered,
  recordOutboxFailure,
  purgeDeliveredOutboxRecords,
  purgeExpiredIdempotencyKeys,
  processDueRollupJobs,
} from '@workspace/db';
import { type AppPorts, type JobName, type RealtimeEventType } from '@workspace/core';
import type { FastifyBaseLogger } from 'fastify';

export interface OutboxRelayOptions {
  workerId?: string;
  batchSize?: number;
  leaseSeconds?: number;
  pollIntervalMs?: number;
  cleanupIntervalMs?: number;
  retentionDays?: number;
  maxRetries?: number;
}

export class OutboxRelay {
  public readonly workerId: string;
  private readonly batchSize: number;
  private readonly leaseSeconds: number;
  private readonly pollIntervalMs: number;
  private readonly cleanupIntervalMs: number;
  private readonly retentionDays: number;
  private readonly maxRetries: number;
  private isRunning = false;
  private pollTimeout: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private inFlightPromise: Promise<number> | null = null;

  constructor(
    private readonly sql: Sql,
    private readonly db: DatabaseInstance,
    private readonly ports: AppPorts,
    private readonly logger: FastifyBaseLogger | Console,
    options: OutboxRelayOptions = {}
  ) {
    this.workerId = options.workerId ?? `worker-${crypto.randomUUID()}`;
    this.batchSize = options.batchSize ?? 50;
    this.leaseSeconds = options.leaseSeconds ?? 60;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 3600000; // 1 hour
    this.retentionDays = options.retentionDays ?? 7;
    this.maxRetries = options.maxRetries ?? 5;
  }

  get active(): boolean {
    return this.isRunning;
  }

  /**
   * Processes a single batch of claimable outbox records.
   * Atomic SELECT ... FOR UPDATE SKIP LOCKED ensures no other worker processes the same records.
   */
  async relayOnce(): Promise<number> {
    try {
      await processDueRollupJobs(this.sql, { workerId: this.workerId, limit: 20 });
    } catch (err) {
      this.logger.error({ err }, 'Error processing due rollup jobs');
    }

    const records = await claimOutboxBatch(this.sql, {
      workerId: this.workerId,
      batchSize: this.batchSize,
      leaseSeconds: this.leaseSeconds,
    });

    if (records.length === 0) {
      return 0;
    }

    this.logger.info(
      { count: records.length, workerId: this.workerId },
      'Claimed outbox batch for dispatch'
    );

    let processedCount = 0;

    for (const record of records) {
      try {
        await this.dispatchEvent(record);
        await markOutboxDelivered(this.sql, {
          id: record.id,
          workerId: this.workerId,
        });
        processedCount++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          {
            recordId: record.id,
            topic: record.topic,
            deliveryAttempts: record.deliveryAttempts,
            error: errorMsg,
          },
          'Failed to dispatch outbox event'
        );

        if (record.deliveryAttempts >= this.maxRetries) {
          this.logger.warn(
            {
              recordId: record.id,
              topic: record.topic,
              deliveryAttempts: record.deliveryAttempts,
              maxRetries: this.maxRetries,
            },
            'Outbox event reached maximum delivery attempts'
          );
        }

        await recordOutboxFailure(this.sql, {
          id: record.id,
          workerId: this.workerId,
          error: errorMsg,
        });
      }
    }

    return processedCount;
  }

  private async dispatchEvent(record: {
    id: string;
    orgId: string;
    topic: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const { topic, payload, orgId } = record;

    const knownJobs: JobName[] = [
      'system.ping',
      'org.maintenance',
      'meeting.pipeline',
      'meeting.transcript_ready',
      'meeting.transcript_ingested',
      'meeting.routed',
      'meeting.suggestions_created',
      'notify',
      'index',
      'rollup',
      'export.erasure',
    ];

    if (knownJobs.includes(topic as JobName)) {
      await this.ports.queue.enqueue(topic as JobName, payload as any);
      return;
    }

    const realtimeTypes: RealtimeEventType[] = [
      'task.upserted',
      'task.deleted',
      'node.rollup',
      'comment.created',
      'comment.updated',
      'comment.deleted',
      'meeting.status',
      'notification.created',
    ];

    const matchedRealtimeType = realtimeTypes.find(
      (t) => t === topic || `realtime.${t}` === topic
    );

    if (matchedRealtimeType) {
      const channel = (payload.channel as string) ?? `org:${orgId}`;
      const eventPayload = (payload.data as any) ?? payload;
      await this.ports.realtime.publish(channel, {
        type: matchedRealtimeType,
        payload: eventPayload,
      });
      return;
    }

    // Default change hint broadcast as notification.created
    await this.ports.realtime.publish(`org:${orgId}`, {
      type: 'notification.created',
      payload: {
        id: record.id,
        kind: topic,
        at: new Date().toISOString(),
      },
    });
  }

  async runRetentionCleanup(): Promise<{ purgedOutbox: number; purgedIdempotency: number }> {
    const purgedOutbox = await purgeDeliveredOutboxRecords(this.sql, {
      retentionDays: this.retentionDays,
    });
    const purgedIdempotency = await purgeExpiredIdempotencyKeys(this.db);
    this.logger.info(
      { purgedOutbox, purgedIdempotency },
      'Retention cleanup finished'
    );
    return { purgedOutbox, purgedIdempotency };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const scheduleNext = () => {
      if (!this.isRunning) return;
      this.pollTimeout = setTimeout(async () => {
        try {
          this.inFlightPromise = this.relayOnce();
          await this.inFlightPromise;
        } catch (err) {
          this.logger.error({ err }, 'Error in outbox relay cycle');
        } finally {
          this.inFlightPromise = null;
          scheduleNext();
        }
      }, this.pollIntervalMs);
    };

    scheduleNext();

    this.cleanupInterval = setInterval(async () => {
      try {
        await this.runRetentionCleanup();
      } catch (err) {
        this.logger.error({ err }, 'Error during periodic retention cleanup');
      }
    }, this.cleanupIntervalMs);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.inFlightPromise) {
      try {
        await this.inFlightPromise;
      } catch {
        // Ignore in-flight failure on stop
      }
      this.inFlightPromise = null;
    }
  }
}
