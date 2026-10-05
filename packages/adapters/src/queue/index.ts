import {
  type QueuePort,
  type JobName,
  type JobPayloadMap,
  type QueueEnqueueOptions,
  JobPayloadSchemas,
  AdapterUnavailableError,
} from '@workspace/core';

export class InMemoryQueueAdapter implements QueuePort {
  public readonly provider = 'in_memory';
  public readonly messages: { job: JobName; data: unknown; options?: QueueEnqueueOptions }[] = [];
  private isRunning = false;

  async enqueue<T extends JobName>(
    job: T,
    data: JobPayloadMap[T],
    options?: QueueEnqueueOptions
  ): Promise<void> {
    const schema = JobPayloadSchemas[job];
    const validatedData = schema.parse(data);
    this.messages.push({ job, data: validatedData, options });
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

  constructor(private readonly config: PgBossConfig) {
    if (!config.databaseUrl) {
      throw new AdapterUnavailableError(
        'Queue',
        'pgboss',
        'Missing DATABASE_DIRECT_URL. Direct PostgreSQL session connection required for pg-boss advisory locks.'
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
      'pgboss',
      'pg-boss driver not connected. Set up pg-boss client in Stage 2 with direct database connection.'
    );
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return {
      healthy: false,
      details: { provider: this.provider, error: 'pg-boss uninitialized', configPresent: Boolean(this.config.databaseUrl) },
    };
  }

  async start(): Promise<void> {
    throw new AdapterUnavailableError('Queue', 'pgboss', 'Cannot start uninitialized pg-boss queue');
  }

  async stop(): Promise<void> {
    // noop
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
