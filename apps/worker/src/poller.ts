import type { AppPorts } from '@workspace/core';
import { pollZoomRecordingsForOrg, type PollZoomRecordingsResult, type Sql } from '@workspace/db';
import type { FastifyBaseLogger } from 'fastify';

export interface ZoomRecordingPollerOptions {
  pollIntervalMs?: number;
  workerId?: string;
}

export interface PollCycleResult {
  scannedOrgs: number;
  totalDiscovered: number;
  totalProcessed: number;
  results: Record<string, PollZoomRecordingsResult>;
  errors: Record<string, string>;
}

export class ZoomRecordingPoller {
  public readonly workerId: string;
  private readonly pollIntervalMs: number;
  private isRunning = false;
  private pollTimeout: NodeJS.Timeout | null = null;
  private inFlightPromise: Promise<PollCycleResult> | null = null;

  constructor(
    private readonly sql: Sql,
    private readonly ports: AppPorts,
    private readonly logger: FastifyBaseLogger | Console,
    options: ZoomRecordingPollerOptions = {}
  ) {
    this.workerId = options.workerId ?? `zoom-poller-${crypto.randomUUID()}`;
    // 30 minutes default interval for fallback polling (requirement M-2)
    this.pollIntervalMs = options.pollIntervalMs ?? 30 * 60 * 1000;
  }

  get active(): boolean {
    return this.isRunning;
  }

  /**
   * Executes a single polling cycle across all active Zoom installations.
   * Acquires per-org advisory locks, scans recordings with 2-hour overlap,
   * advances durable checkpoints, and recovers pending transcripts.
   */
  async pollOnce(): Promise<PollCycleResult> {
    const cycleResult: PollCycleResult = {
      scannedOrgs: 0,
      totalDiscovered: 0,
      totalProcessed: 0,
      results: {},
      errors: {},
    };

    try {
      // Find all connected Zoom integrations
      const connectedIntegrations = await this.sql<{ org_id: string }[]>`
        SELECT org_id FROM integrations
        WHERE provider = 'zoom' AND status = 'connected'
      `;

      cycleResult.scannedOrgs = connectedIntegrations.length;

      for (const { org_id } of connectedIntegrations) {
        try {
          const result = await pollZoomRecordingsForOrg(
            this.sql,
            this.ports.secretStore,
            this.ports.zoomClient,
            { orgId: org_id, workerId: this.workerId }
          );

          cycleResult.results[org_id] = result;
          cycleResult.totalDiscovered += result.discoveredCount;
          cycleResult.totalProcessed += result.advancedCount;

          if (result.reason === 'concurrent_poll_in_progress') {
            this.logger.info({ orgId: org_id }, 'Zoom poller skipped org: advisory lock held by another worker');
          } else {
            this.logger.info(
              {
                orgId: org_id,
                discovered: result.discoveredCount,
                advanced: result.advancedCount,
              },
              'Zoom poller completed cycle for organization'
            );
          }
        } catch (orgErr) {
          const errorMessage = orgErr instanceof Error ? orgErr.message : String(orgErr);
          cycleResult.errors[org_id] = errorMessage;
          this.logger.error({ orgId: org_id, err: orgErr }, 'Zoom poller failed for organization');
        }
      }
    } catch (err) {
      this.logger.error({ err }, 'Error querying connected Zoom integrations for poller');
    }

    return cycleResult;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info(
      { intervalMs: this.pollIntervalMs, workerId: this.workerId },
      'Starting Zoom recording fallback poller loop'
    );
    this.scheduleNext(0);
  }

  private scheduleNext(delayMs: number): void {
    if (!this.isRunning) return;

    this.pollTimeout = setTimeout(() => {
      this.pollTimeout = null;
      this.inFlightPromise = this.pollOnce();

      this.inFlightPromise
        .then(() => {
          this.inFlightPromise = null;
          this.scheduleNext(this.pollIntervalMs);
        })
        .catch((err) => {
          this.inFlightPromise = null;
          this.logger.error({ err }, 'Unexpected error in Zoom poller cycle');
          this.scheduleNext(this.pollIntervalMs);
        });
    }, delayMs);
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }

    if (this.inFlightPromise) {
      await this.inFlightPromise.catch(() => {});
      this.inFlightPromise = null;
    }

    this.logger.info({ workerId: this.workerId }, 'Zoom recording poller stopped');
  }
}
