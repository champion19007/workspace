import { PgBoss } from 'pg-boss';
import {
  type QueuePort,
  type JobName,
  type JobPayloadMap,
  type QueueEnqueueOptions,
  type JobHandler,
  JobPayloadSchemas,
  AdapterUnavailableError,
} from '@workspace/core';

export class InMemoryQueueAdapter implements QueuePort {
  public readonly provider = 'in_memory';
  public readonly messages: { job: JobName; data: unknown; options?: QueueEnqueueOptions }[] = [];
  private handlers: Map<string, JobHandler<any>[]> = new Map();
  private isRunning = false;

  async enqueue<T extends JobName>(
    job: T,
    data: JobPayloadMap[T],
    options?: QueueEnqueueOptions
  ): Promise<void> {
    const schema = JobPayloadSchemas[job];
    const validatedData = schema.parse(data);
    this.messages.push({ job, data: validatedData, options });

    const registered = this.handlers.get(job);
    if (registered && registered.length > 0) {
      for (const handler of registered) {
        await handler(validatedData, { id: crypto.randomUUID(), name: job });
      }
    }
  }

  async subscribe<T extends JobName>(
    job: T,
    handler: JobHandler<T>
  ): Promise<void> {
    const existing = this.handlers.get(job) ?? [];
    existing.push(handler as JobHandler<any>);
    this.handlers.set(job, existing);
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return {
      healthy: true,
      details: {
        provider: this.provider,
        pendingJobs: this.messages.length,
        running: this.isRunning,
      },
    };
  }

  async start(): Promise<void> {
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    this.isRunning = false;
  }
}

export interface PgBossConfig {
  databaseUrl?: string;
  schema?: string;
}

export class PgBossQueueAdapter implements QueuePort {
  public readonly provider = 'pgboss';
  private boss: PgBoss | null = null;
  private isStarted = false;

  constructor(private readonly config: PgBossConfig) {
    if (!config.databaseUrl) {
      throw new AdapterUnavailableError(
        'Queue',
        'pgboss',
        'Missing DATABASE_DIRECT_URL. Direct PostgreSQL session connection required for pg-boss advisory locks.'
      );
    }
  }

  private getBoss(): PgBoss {
    if (!this.boss) {
      this.boss = new PgBoss({
        connectionString: this.config.databaseUrl,
        schema: this.config.schema ?? 'pgboss',
      });
    }
    return this.boss;
  }

  async start(): Promise<void> {
    const boss = this.getBoss();
    if (!this.isStarted) {
      await boss.start();
      this.isStarted = true;
    }
  }

  async stop(): Promise<void> {
    if (this.boss && this.isStarted) {
      await this.boss.stop({ graceful: true });
      this.isStarted = false;
    }
  }

  async enqueue<T extends JobName>(
    job: T,
    data: JobPayloadMap[T],
    options?: QueueEnqueueOptions
  ): Promise<void> {
    const schema = JobPayloadSchemas[job];
    const validatedData = schema.parse(data) as object;
    const boss = this.getBoss();
    if (!this.isStarted) {
      await this.start();
    }

    const sendOptions: Record<string, unknown> = {};
    if (options?.dedupeKey) {
      sendOptions.singletonKey = options.dedupeKey;
    }
    if (options?.delayS) {
      sendOptions.startAfter = options.delayS;
    }
    if (options?.priority) {
      sendOptions.priority = options.priority;
    }

    await boss.send(job, validatedData, sendOptions as any);
  }

  async subscribe<T extends JobName>(
    job: T,
    handler: JobHandler<T>
  ): Promise<void> {
    const boss = this.getBoss();
    if (!this.isStarted) {
      await this.start();
    }

    await boss.work(job, async (jobs) => {
      const jobList = Array.isArray(jobs) ? jobs : [jobs];
      for (const j of jobList) {
        await handler((j as any).data, { id: (j as any).id, name: (j as any).name });
      }
    });
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    try {
      return {
        healthy: true,
        details: {
          provider: this.provider,
          started: this.isStarted,
          schema: this.config.schema ?? 'pgboss',
        },
      };
    } catch (err) {
      return {
        healthy: false,
        details: {
          provider: this.provider,
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}

export interface SqsConfig {
  region?: string;
  queueUrl?: string;
}

export class SqsQueueAdapter implements QueuePort {
  public readonly provider = 'sqs';

  constructor(private readonly config: SqsConfig) {
    if (!config.queueUrl) {
      throw new AdapterUnavailableError(
        'Queue',
        'sqs',
        'Missing SQS_MEETING_EVENTS_QUEUE_URL. SQS endpoint configuration required.'
      );
    }
  }

  async enqueue<T extends JobName>(
    _job: T,
    _data: JobPayloadMap[T],
    _options?: QueueEnqueueOptions
  ): Promise<void> {
    throw new AdapterUnavailableError(
      'Queue',
      'sqs',
      'SQS driver not connected. Active AWS credentials and queue ARN required.'
    );
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return {
      healthy: false,
      details: { provider: this.provider, error: 'SQS uninitialized', configPresent: Boolean(this.config.queueUrl) },
    };
  }

  async start(): Promise<void> {
    // noop
  }

  async stop(): Promise<void> {
    // noop
  }
}
