import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseConfig } from '@workspace/core';
import {
  createWorkerClient,
  seedTestFixtures,
  cleanTestFixtures,
  listPendingReadyMeetings,
  FIXTURE_IDS,
  type Sql,
} from '@workspace/db';
import { buildWorker, type WorkerInstance } from '../server.js';
import { handleTranscriptReadyJob } from '../transcript-handler.js';

/**
 * Stage 17b: the worker, connected as the restricted login role `workspace_worker`, runs its cross-organization
 * maintenance through the narrowly privileged entry points and every per-organization job as workspace_system.
 */
const ADMIN_DB_URL =
  process.env['DATABASE_MIGRATION_URL'] ??
  'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev';
const WORKER_DB_URL =
  process.env['DATABASE_WORKER_URL'] ??
  'postgresql://workspace_worker:workspace_worker_dev_password@localhost:5432/workspace_dev';

const { orgs, nodes, meetings } = FIXTURE_IDS;
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe('Stage 17b: the worker under the restricted login role', () => {
  let worker: WorkerInstance;
  let admin: Sql;

  beforeAll(async () => {
    admin = createWorkerClient({ connectionString: ADMIN_DB_URL, maxConnections: 1 }).sql;
    await seedTestFixtures(admin);
    worker = buildWorker(
      parseConfig({
        DATABASE_URL: WORKER_DB_URL,
        DATABASE_DIRECT_URL: WORKER_DB_URL,
        ORIGIN_VERIFY_SECRET: 'test-origin-verify-secret-token-16-chars',
        WORKER_PORT: 8118,
        QUEUE_PROVIDER: 'in_memory',
        REALTIME_PROVIDER: 'in_memory',
        LLM_PROVIDER: 'mock',
        STORAGE_PROVIDER: 'in_memory',
        AUTH_PROVIDER: 'mock',
      })
    );
  });

  afterAll(async () => {
    await worker?.sql.end({ timeout: 5 });
    if (admin) {
      await cleanTestFixtures(admin);
      await admin.end({ timeout: 5 });
    }
  });

  it('connects as workspace_worker, which is neither superuser nor BYPASSRLS', async () => {
    const [role] = await worker.sql<Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    expect(role).toEqual({ current_user: 'workspace_worker', rolsuper: false, rolbypassrls: false });
  });

  it('relays outbox events and recomputes due rollups', async () => {
    // Oldest first: the relay claims across organizations in created_at order.
    const [event] = await admin<Array<{ id: string }>>`
      INSERT INTO outbox (org_id, topic, payload, created_at)
      VALUES (
        ${orgs.orgA}, 'system.ping',
        ${JSON.stringify({ pingId: '01923456-789a-7000-8000-00000000abcd', timestamp: new Date().toISOString() })}::jsonb,
        '2000-01-01T00:00:00Z'
      ) RETURNING id
    `;
    await admin`
      INSERT INTO node_rollup_dirty (node_id, org_id, debounce_until)
      VALUES (${nodes.orgAPrivate}, ${orgs.orgA}, now() - interval '1 minute')
      ON CONFLICT (node_id) DO UPDATE SET debounce_until = EXCLUDED.debounce_until, locked_at = NULL, locked_by = NULL
    `;

    await worker.relay.relayOnce();

    const [sent] = await admin`SELECT sent_at FROM outbox WHERE id = ${event!.id}`;
    expect(sent!.sent_at).not.toBeNull();
    // The private project is recomputed too: workspace_system is not subject to per-user visibility.
    const [node] = await admin`SELECT rollup FROM nodes WHERE id = ${nodes.orgAPrivate}`;
    expect(node!.rollup).toMatchObject({ tasks: { total: 1 } });
    expect(await admin`SELECT 1 FROM node_rollup_dirty WHERE node_id = ${nodes.orgAPrivate}`).toHaveLength(0);
  });

  it('scans connected Zoom organizations and updates their integration as workspace_system', async () => {
    await admin`
      INSERT INTO integrations (org_id, provider, account_id, secret_arn, status, installed_at)
      VALUES (${orgs.orgA}, 'zoom', ${`rls-worker-${Date.now()}`}, 'arn:missing-secret', 'connected', now())
    `;
    const cycle = await worker.poller.pollOnce();
    expect(cycle.results[orgs.orgA]?.reason ?? '').not.toMatch(/permission denied/);
    expect(cycle.errors[orgs.orgA]).toBeUndefined();
    // No stored credentials: the credential coordinator parks the integration (an RLS-guarded write).
    const [integration] = await admin`SELECT status FROM integrations WHERE org_id = ${orgs.orgA} AND provider = 'zoom'`;
    expect(integration!.status).toBe('needs_reauthorization');
  });

  it('lists recovery work across organizations and processes jobs in their own organization', async () => {
    await expect(listPendingReadyMeetings(worker.sql, 5)).resolves.toBeInstanceOf(Array);
    // meetingA is already completed: the job reads it under workspace_system and stops.
    const handled = await handleTranscriptReadyJob(worker.sql, worker.ports, silent, {
      orgId: orgs.orgA,
      meetingId: meetings.meetingA,
      providerMeetingUuid: 'zoom-acme-meet-123',
      connectionGeneration: 1,
      processingGeneration: 1,
      emittedAt: new Date().toISOString(),
    });
    expect(handled).toBe(false);
  });
});
