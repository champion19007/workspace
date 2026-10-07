import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseConfig } from '@workspace/core';
import {
  createWorkerClient,
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  connectZoomIntegration,
  updateZoomHostConsent,
  type Sql,
  type DatabaseInstance,
} from '@workspace/db';
import { MockZoomClientAdapter } from '@workspace/adapters';
import { buildWorker, type WorkerInstance } from '../server.js';
import { ZoomRecordingPoller } from '../poller.js';

describe('Stage 12: Zoom Recording Fallback Poller (Requirement M-2 & M-4)', () => {
  const secret = 'test-origin-verify-secret-token-16-chars';
  const testConfig = parseConfig({
    DATABASE_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    DATABASE_DIRECT_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    ORIGIN_VERIFY_SECRET: secret,
    WORKER_PORT: 8099,
    QUEUE_PROVIDER: 'in_memory',
    REALTIME_PROVIDER: 'in_memory',
    LLM_PROVIDER: 'mock',
    STORAGE_PROVIDER: 'in_memory',
    AUTH_PROVIDER: 'mock',
    SECRET_STORE_PROVIDER: 'in_memory',
    ZOOM_CLIENT_PROVIDER: 'mock',
  });

  let worker: WorkerInstance;
  let sql: Sql;
  let db: DatabaseInstance;
  let mockZoomClient: MockZoomClientAdapter;

  let ownerUser: { id: string; email: string };
  let optedInHostUser: { id: string; email: string };
  let optedOutHostUser: { id: string; email: string };

  let testOrg: { id: string; slug: string };

  const ZOOM_ACCOUNT_ID = 'zoom_act_poller_999';
  const OPTED_IN_HOST_ZOOM_ID = 'zoom_usr_poller_opted_in';
  const OPTED_OUT_HOST_ZOOM_ID = 'zoom_usr_poller_opted_out';

  beforeAll(async () => {
    worker = buildWorker(testConfig);
    const client = createWorkerClient({
      connectionString: testConfig.DATABASE_DIRECT_URL,
    });
    sql = client.sql;
    db = client.db;
    mockZoomClient = worker.ports.zoomClient as MockZoomClientAdapter;

    // 1. Seed users
    const owner = await findOrCreateUserByEmail(db, {
      email: 'stage12-poller-owner@example.com',
      name: 'Poller Owner',
    });
    ownerUser = { id: owner.id, email: owner.email };

    const host1 = await findOrCreateUserByEmail(db, {
      email: 'stage12-poller-host1@example.com',
      name: 'Opted In Host',
    });
    optedInHostUser = { id: host1.id, email: host1.email };

    const host2 = await findOrCreateUserByEmail(db, {
      email: 'stage12-poller-host2@example.com',
      name: 'Opted Out Host',
    });
    optedOutHostUser = { id: host2.id, email: host2.email };

    // 2. Organization
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Stage 12 Poller Org',
      slug: `stage12-poller-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${testOrg.id}, ${optedInHostUser.id}, 'member'),
             (${testOrg.id}, ${optedOutHostUser.id}, 'member')
    `;

    // 3. Connect Zoom integration
    mockZoomClient.mockAccountId = ZOOM_ACCOUNT_ID;
    mockZoomClient.mockHosts = [
      {
        id: OPTED_IN_HOST_ZOOM_ID,
        email: optedInHostUser.email,
        firstName: 'Opted',
        lastName: 'In',
        status: 'active',
        type: 2,
      },
      {
        id: OPTED_OUT_HOST_ZOOM_ID,
        email: optedOutHostUser.email,
        firstName: 'Opted',
        lastName: 'Out',
        status: 'active',
        type: 2,
      },
    ];

    await connectZoomIntegration(sql, worker.ports.secretStore, worker.ports.zoomClient, {
      orgId: testOrg.id,
      accountId: ZOOM_ACCOUNT_ID,
      userId: ownerUser.id,
      scopes: ['recording:read:admin', 'user:read:admin'],
      tokens: {
        access_token: 'mock_poller_access_token',
        refresh_token: 'mock_poller_refresh_token',
        expires_in: 3600,
        scope: 'recording:read:admin user:read:admin',
        token_type: 'bearer',
      },
    });

    // 4. Set host consent: 1 opted-in, 1 opted-out
    await updateZoomHostConsent(sql, {
      orgId: testOrg.id,
      zoomUserId: OPTED_IN_HOST_ZOOM_ID,
      consentStatus: 'opted_in',
      adminDisabled: false,
      role: 'owner',
    });

    await updateZoomHostConsent(sql, {
      orgId: testOrg.id,
      zoomUserId: OPTED_OUT_HOST_ZOOM_ID,
      consentStatus: 'opted_out',
      adminDisabled: false,
      role: 'owner',
    });
  });

  afterAll(async () => {
    await sql`DELETE FROM zoom_webhook_events`;
    await sql`DELETE FROM zoom_poll_checkpoints`;
    await sql`DELETE FROM meetings WHERE org_id = ${testOrg.id}`;
    await sql`DELETE FROM zoom_host_consents WHERE org_id = ${testOrg.id}`;
    await sql`DELETE FROM integrations WHERE org_id = ${testOrg.id}`;
    await sql`DELETE FROM orgs WHERE id = ${testOrg.id}`;
    await worker.sql.end({ timeout: 2 });
    await sql.end({ timeout: 2 });
  });

  it('runs a poll cycle discovering recordings for opted-in hosts and advances checkpoint', async () => {
    const meetingUuid1 = 'poller_mtg_uuid_1_abc==';
    const nowIso = new Date().toISOString();

    // Mock recordings returned by Zoom API
    mockZoomClient.mockRecordings = [
      {
        uuid: meetingUuid1,
        id: 98765432101,
        topic: 'Poller Standup Sprint 42',
        hostId: OPTED_IN_HOST_ZOOM_ID,
        startTime: nowIso,
        duration: 30,
        timezone: 'UTC',
        recordingFiles: [
          {
            id: 'file_audio_1',
            fileType: 'AUDIO',
            fileExtension: 'M4A',
            recordingType: 'audio_only',
            status: 'completed',
          },
          {
            id: 'file_transcript_1',
            fileType: 'TRANSCRIPT',
            fileExtension: 'VTT',
            recordingType: 'audio_transcript',
            status: 'completed',
          },
        ],
      },
    ];

    const poller = new ZoomRecordingPoller(sql, worker.ports, console, {
      pollIntervalMs: 60000,
    });

    const cycleResult = await poller.pollOnce();

    expect(cycleResult.scannedOrgs).toBeGreaterThanOrEqual(1);
    expect(cycleResult.totalDiscovered).toBeGreaterThanOrEqual(1);
    expect(cycleResult.totalProcessed).toBeGreaterThanOrEqual(1);

    // Verify meeting in DB is ready_for_transcript_retrieval because transcript file was completed
    const [meeting] = await sql<{
      id: string;
      status: string;
      title: string;
      has_transcript: boolean;
      has_recording: boolean;
    }[]>`
      SELECT id, status, title, has_transcript, has_recording
      FROM meetings
      WHERE org_id = ${testOrg.id} AND provider_meeting_uuid = ${meetingUuid1}
    `;

    expect(meeting).toBeDefined();
    expect(meeting!.title).toBe('Poller Standup Sprint 42');
    expect(meeting!.status).toBe('ready_for_transcript_retrieval');
    expect(meeting!.has_transcript).toBe(true);
    expect(meeting!.has_recording).toBe(true);

    // Verify checkpoint was durably recorded
    const [checkpoint] = await sql<{
      last_scanned_at: Date;
    }[]>`
      SELECT last_scanned_at
      FROM zoom_poll_checkpoints
      WHERE org_id = ${testOrg.id}
    `;

    expect(checkpoint).toBeDefined();
    expect(checkpoint!.last_scanned_at).toBeDefined();
  });

  it('updates meeting from waiting_for_transcript to ready_for_transcript_retrieval when transcript becomes ready on subsequent poll', async () => {
    const meetingUuid2 = 'poller_mtg_uuid_2_def==';
    const nowIso = new Date().toISOString();

    // 1. Initial recording without transcript
    mockZoomClient.mockRecordings = [
      {
        uuid: meetingUuid2,
        id: 98765432102,
        topic: 'Poller Sprint Retro Part 1',
        hostId: OPTED_IN_HOST_ZOOM_ID,
        startTime: nowIso,
        duration: 45,
        timezone: 'UTC',
        recordingFiles: [
          {
            id: 'file_audio_2',
            fileType: 'AUDIO',
            fileExtension: 'M4A',
            recordingType: 'audio_only',
            status: 'completed',
          },
        ],
      },
    ];

    const poller = new ZoomRecordingPoller(sql, worker.ports, console);
    await poller.pollOnce();

    // Verify initial status is waiting_for_transcript
    const [initialMtg] = await sql<{ status: string; has_transcript: boolean }[]>`
      SELECT status, has_transcript FROM meetings
      WHERE org_id = ${testOrg.id} AND provider_meeting_uuid = ${meetingUuid2}
    `;
    expect(initialMtg).toBeDefined();
    expect(initialMtg!.status).toBe('waiting_for_transcript');
    expect(initialMtg!.has_transcript).toBe(false);

    // 2. Now transcript finishes processing in Zoom
    mockZoomClient.mockRecordings = [
      {
        uuid: meetingUuid2,
        id: 98765432102,
        topic: 'Poller Sprint Retro Part 1',
        hostId: OPTED_IN_HOST_ZOOM_ID,
        startTime: nowIso,
        duration: 45,
        timezone: 'UTC',
        recordingFiles: [
          {
            id: 'file_audio_2',
            fileType: 'AUDIO',
            fileExtension: 'M4A',
            recordingType: 'audio_only',
            status: 'completed',
          },
          {
            id: 'file_transcript_2',
            fileType: 'TRANSCRIPT',
            fileExtension: 'VTT',
            recordingType: 'audio_transcript',
            status: 'completed',
          },
        ],
      },
    ];

    // Run poller cycle again
    await poller.pollOnce();

    const [updatedMtg] = await sql<{ status: string; has_transcript: boolean }[]>`
      SELECT status, has_transcript FROM meetings
      WHERE org_id = ${testOrg.id} AND provider_meeting_uuid = ${meetingUuid2}
    `;
    expect(updatedMtg).toBeDefined();
    expect(updatedMtg!.status).toBe('ready_for_transcript_retrieval');
    expect(updatedMtg!.has_transcript).toBe(true);

    // Verify outbox emitted meeting.transcript_ready
    const [outboxRecord] = await sql<{ topic: string; payload: unknown }[]>`
      SELECT topic, payload FROM outbox
      WHERE org_id = ${testOrg.id}
        AND topic = 'meeting.transcript_ready'
        AND payload->>'providerMeetingUuid' = ${meetingUuid2}
    `;
    expect(outboxRecord).toBeDefined();
    expect(outboxRecord!.topic).toBe('meeting.transcript_ready');
  });

  it('scans exclusively opted-in hosts and serializes concurrent workers via advisory locking', async () => {
    const meetingUuidOptedOut = 'poller_mtg_opted_out_3==';
    const nowIso = new Date().toISOString();

    // Mock recordings only for opted-out host
    mockZoomClient.mockRecordings = [
      {
        uuid: meetingUuidOptedOut,
        id: 98765432103,
        topic: 'Opted Out Private 1on1',
        hostId: OPTED_OUT_HOST_ZOOM_ID,
        startTime: nowIso,
        duration: 15,
        timezone: 'UTC',
        recordingFiles: [
          {
            id: 'file_audio_3',
            fileType: 'AUDIO',
            fileExtension: 'M4A',
            recordingType: 'audio_only',
            status: 'completed',
          },
        ],
      },
    ];

    const poller = new ZoomRecordingPoller(sql, worker.ports, console);
    await poller.pollOnce();

    // Since opted-out host is not in opted-in list, poller does not ingest their recordings
    const [optedOutMtg] = await sql<{ id: string }[]>`
      SELECT id FROM meetings
      WHERE org_id = ${testOrg.id} AND provider_meeting_uuid = ${meetingUuidOptedOut}
    `;
    expect(optedOutMtg).toBeUndefined();

    // Verify advisory locking concurrency guard
    await sql.begin(async (txn) => {
      // Hold advisory lock inside transaction
      await txn`SELECT pg_try_advisory_xact_lock(hashtext('zoom_poll:' || ${testOrg.id}))`;

      // Concurrent poll during lock should skip org gracefully
      const concurrentResult = await poller.pollOnce();
      expect(concurrentResult.results[testOrg.id]?.reason).toBe('concurrent_poll_in_progress');
    });
  });
});
