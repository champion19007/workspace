import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseConfig } from '@workspace/core';
import {
  createWorkerClient,
  insertOutboxEvent,
  claimOutboxBatch,
  markOutboxDelivered,
  recordOutboxFailure,
  purgeDeliveredOutboxRecords,
  orgs,
  type Sql,
  type DatabaseInstance,
} from '@workspace/db';
import { buildWorker, type WorkerInstance } from '../server.js';

const testConfig = parseConfig({
  DATABASE_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
  DATABASE_DIRECT_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
  ORIGIN_VERIFY_SECRET: 'test-origin-verify-secret-token-16-chars',
  WORKER_PORT: 8098,
  QUEUE_PROVIDER: 'in_memory',
  REALTIME_PROVIDER: 'in_memory',
  LLM_PROVIDER: 'mock',
  STORAGE_PROVIDER: 'in_memory',
  AUTH_PROVIDER: 'mock',
});

describe('Transactional Outbox and Background Worker Infrastructure', () => {
  let worker: WorkerInstance;
  let sql: Sql;
  let db: DatabaseInstance;
  let testOrgId: string;

  beforeAll(async () => {
    worker = buildWorker(testConfig);
    const client = createWorkerClient({
      connectionString: testConfig.DATABASE_DIRECT_URL,
    });
    sql = client.sql;
    db = client.db;

    // Clean outbox from any other tests
    await sql`DELETE FROM outbox`;

    // Seed a test organization for outbox events
    const [org] = await db
      .insert(orgs)
      .values({
        slug: `outbox-test-org-${Date.now()}`,
        name: 'Outbox Test Org',
      })
      .returning({ id: orgs.id });
    testOrgId = org!.id;
  });

  afterAll(async () => {
    // Cleanup test organization (cascades to outbox)
    if (testOrgId) {
      await sql`DELETE FROM orgs WHERE id = ${testOrgId}`;
    }
    await worker.sql.end({ timeout: 2 });
    await sql.end({ timeout: 2 });
  });

  it('inserts outbox event atomically within database transaction', async () => {
    const eventId = await insertOutboxEvent(db, {
      orgId: testOrgId,
      topic: 'test.event',
      payload: { hello: 'world', timestamp: Date.now() },
    });

    expect(eventId).toBeDefined();

    const [record] = await sql`
      SELECT id, org_id, topic, payload, sent_at, locked_at, locked_by
      FROM outbox
      WHERE id = ${eventId}
    `;

    expect(record).toBeDefined();
    expect(record!.topic).toBe('test.event');
    expect(record!.sent_at).toBeNull();
    expect(record!.locked_at).toBeNull();
    expect(record!.locked_by).toBeNull();
  });

  it('claims batch atomically with FOR UPDATE SKIP LOCKED and prevents concurrent double-claims', async () => {
    const eventId1 = await insertOutboxEvent(db, {
      orgId: testOrgId,
      topic: 'batch.event.1',
      payload: { n: 1 },
    });
    const eventId2 = await insertOutboxEvent(db, {
      orgId: testOrgId,
      topic: 'batch.event.2',
      payload: { n: 2 },
    });

    const worker1Id = 'worker-test-instance-1';
    const worker2Id = 'worker-test-instance-2';

    // Worker 1 claims batch
    const claimedByWorker1 = await claimOutboxBatch(sql, {
      workerId: worker1Id,
      batchSize: 10,
      leaseSeconds: 60,
    });

    const claimedIds1 = claimedByWorker1.map((r) => r.id);
    expect(claimedIds1).toContain(eventId1);
    expect(claimedIds1).toContain(eventId2);

    const record1 = claimedByWorker1.find((r) => r.id === eventId1)!;
    expect(record1.lockedBy).toBe(worker1Id);
    expect(record1.lockedAt).toBeDefined();
    expect(record1.deliveryAttempts).toBeGreaterThanOrEqual(1);

    // Worker 2 attempts concurrent claim with SKIP LOCKED
    const claimedByWorker2 = await claimOutboxBatch(sql, {
      workerId: worker2Id,
      batchSize: 10,
      leaseSeconds: 60,
    });

    const claimedIds2 = claimedByWorker2.map((r) => r.id);
    expect(claimedIds2).not.toContain(eventId1);
    expect(claimedIds2).not.toContain(eventId2);

    // Mark delivered by Worker 1
    const delivered1 = await markOutboxDelivered(sql, { id: eventId1, workerId: worker1Id });
    const delivered2 = await markOutboxDelivered(sql, { id: eventId2, workerId: worker1Id });
    expect(delivered1).toBe(true);
    expect(delivered2).toBe(true);
  });

  it('records delivery failure and unlocks record for subsequent retry', async () => {
    const eventId = await insertOutboxEvent(db, {
      orgId: testOrgId,
      topic: 'fail.event',
      payload: { shouldFail: true },
    });

    const workerId = 'worker-fail-test';
    const claimed = await claimOutboxBatch(sql, {
      workerId,
      batchSize: 10,
      leaseSeconds: 60,
    });
    expect(claimed.some((r) => r.id === eventId)).toBe(true);

    const failed = await recordOutboxFailure(sql, {
      id: eventId,
      workerId,
      error: 'Simulated downstream connection timeout',
    });
    expect(failed).toBe(true);

    const [record] = await sql`
      SELECT locked_at, locked_by, last_error, delivery_attempts
      FROM outbox
      WHERE id = ${eventId}
    `;

    expect(record).toBeDefined();
    expect(record!.locked_at).toBeNull();
    expect(record!.locked_by).toBeNull();
    expect(record!.last_error).toBe('Simulated downstream connection timeout');
    expect(record!.delivery_attempts).toBe(1);

    // Record can be claimed again for retry
    const reclaimed = await claimOutboxBatch(sql, {
      workerId: 'worker-retry',
      batchSize: 10,
      leaseSeconds: 60,
    });
    expect(reclaimed.some((r) => r.id === eventId)).toBe(true);

    await markOutboxDelivered(sql, { id: eventId, workerId: 'worker-retry' });
  });

  it('reclaims expired leases when worker crashes or times out', async () => {
    const eventId = await insertOutboxEvent(db, {
      orgId: testOrgId,
      topic: 'lease.timeout.event',
      payload: { crash: true },
    });

    // Simulate stale lock from a dead worker (> 60 seconds ago)
    await sql`
      UPDATE outbox
      SET locked_at = NOW() - INTERVAL '120 seconds',
          locked_by = 'dead-worker-pid-999'
      WHERE id = ${eventId}
    `;

    const newWorkerId = 'active-worker-pid-101';
    const reclaimed = await claimOutboxBatch(sql, {
      workerId: newWorkerId,
      batchSize: 10,
      leaseSeconds: 60,
    });

    const target = reclaimed.find((r) => r.id === eventId);
    expect(target).toBeDefined();
    expect(target!.lockedBy).toBe(newWorkerId);

    await markOutboxDelivered(sql, { id: eventId, workerId: newWorkerId });
  });

  it('purges delivered records past retention period', async () => {
    const eventId = await insertOutboxEvent(db, {
      orgId: testOrgId,
      topic: 'retention.event',
      payload: { old: true },
    });

    // Mark as delivered 10 days ago
    await sql`
      UPDATE outbox
      SET sent_at = NOW() - INTERVAL '10 days'
      WHERE id = ${eventId}
    `;

    const purged = await purgeDeliveredOutboxRecords(sql, { retentionDays: 7 });
    expect(purged).toBeGreaterThanOrEqual(1);

    const [check] = await sql`
      SELECT id FROM outbox WHERE id = ${eventId}
    `;
    expect(check).toBeUndefined();
  });

  it('OutboxRelay dispatches system.ping to queue and processes end-to-end', async () => {
    let processedPing: { pingId: string; timestamp: string } | null = null;

    // Register queue subscription for system.ping
    if (worker.ports.queue.subscribe) {
      await worker.ports.queue.subscribe('system.ping', async (data) => {
        processedPing = data;
      });
    }

    const pingId = crypto.randomUUID();
    const pingTimestamp = new Date().toISOString();

    // Insert outbox event for system.ping
    const eventId = await insertOutboxEvent(worker.db, {
      orgId: testOrgId,
      topic: 'system.ping',
      payload: {
        pingId,
        timestamp: pingTimestamp,
        orgId: testOrgId,
      },
    });

    // Execute relay tick
    const dispatched = await worker.relay.relayOnce();
    expect(dispatched).toBeGreaterThanOrEqual(1);

    // Verify outbox record is marked delivered
    const [record] = await worker.sql`
      SELECT sent_at, locked_at, locked_by
      FROM outbox
      WHERE id = ${eventId}
    `;
    expect(record).toBeDefined();
    expect(record!.sent_at).not.toBeNull();
    expect(record!.locked_at).toBeNull();
    expect(record!.locked_by).toBeNull();

    // Verify background consumer executed the ping job
    expect(processedPing).not.toBeNull();
    expect(processedPing!.pingId).toBe(pingId);
  });

  it('OutboxRelay enqueues meeting.suggestions_created so suggestion enrichment runs', async () => {
    const received: Array<{ meetingId: string }> = [];
    await worker.ports.queue.subscribe?.('meeting.suggestions_created', async (data) => {
      received.push(data);
    });
    const meetingId = crypto.randomUUID();
    const eventId = await insertOutboxEvent(worker.db, {
      orgId: testOrgId,
      topic: 'meeting.suggestions_created',
      payload: { orgId: testOrgId, meetingId, actionItemCount: 0, actionItemIds: [], emittedAt: new Date().toISOString() },
    });

    await worker.relay.relayOnce();

    const [record] = await worker.sql`SELECT sent_at FROM outbox WHERE id = ${eventId}`;
    expect(record!.sent_at).not.toBeNull();
    expect(received.map((d) => d.meetingId)).toContain(meetingId);
  });
});
