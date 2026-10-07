import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseConfig } from '@workspace/core';
import {
  createWorkerClient,
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  connectZoomIntegration,
  updateZoomHostConsent,
  skipMeetingAndCleanup,
  getMeetingTranscript,
  type Sql,
  type DatabaseInstance,
} from '@workspace/db';
import { MockZoomClientAdapter } from '@workspace/adapters';
import { buildWorker, type WorkerInstance } from '../server.js';
import { handleTranscriptReadyJob, recoverReadyMeetings } from '../transcript-handler.js';

describe('Stage 13: Transcript Retrieval, Normalization, Evidence Anchors, and Skip Cleanup', () => {
  const secret = 'test-origin-verify-secret-token-16-chars';
  const testConfig = parseConfig({
    DATABASE_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    DATABASE_DIRECT_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    ORIGIN_VERIFY_SECRET: secret,
    WORKER_PORT: 8098,
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
  let hostUser: { id: string; email: string };
  let testOrg: { id: string; slug: string };

  const ZOOM_ACCOUNT_ID = `zoom_act_stage13_${Date.now()}`;
  const HOST_ZOOM_ID = `zoom_usr_stage13_host_${Date.now()}`;

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
      email: 'stage13-owner@example.com',
      name: 'Stage13 Owner',
    });
    ownerUser = { id: owner.id, email: owner.email };

    const host = await findOrCreateUserByEmail(db, {
      email: 'stage13-host@example.com',
      name: 'Stage13 Host',
    });
    hostUser = { id: host.id, email: host.email };

    // 2. Organization
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Stage 13 Test Org',
      slug: `stage13-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${testOrg.id}, ${hostUser.id}, 'member')
    `;

    // 3. Connect Zoom integration
    mockZoomClient.mockAccountId = ZOOM_ACCOUNT_ID;
    mockZoomClient.mockHosts = [
      {
        id: HOST_ZOOM_ID,
        email: hostUser.email,
        firstName: 'Stage13',
        lastName: 'Host',
        status: 'active',
        type: 2,
      },
    ];

    await connectZoomIntegration(sql, worker.ports.secretStore, mockZoomClient, {
      orgId: testOrg.id,
      accountId: ZOOM_ACCOUNT_ID,
      userId: ownerUser.id,
      scopes: ['recording:read:admin', 'user:read:admin'],
      tokens: {
        access_token: 'mock_transcript_access_token',
        refresh_token: 'mock_transcript_refresh_token',
        expires_in: 3600,
        scope: 'recording:read:admin user:read:admin',
        token_type: 'bearer',
      },
    });

    // 4. Opt-in the host
    await updateZoomHostConsent(sql, {
      orgId: testOrg.id,
      zoomUserId: HOST_ZOOM_ID,
      consentStatus: 'opted_in',
      adminDisabled: false,
      role: 'owner',
    });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('retrieves, normalizes, stores raw source in BlobStore, and commits evidence segments', async () => {
    const meetingUuid = `stage13_mtg_e2e_${Date.now()}==`;
    const downloadUrl = `https://api.zoom.us/v2/recordings/download/${meetingUuid}.vtt`;

    const sampleVtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
<v Alex Lead>Good morning everyone.</v>

2
00:00:04.000 --> 00:00:06.000
<v Alex Lead>Let's review the product deliverables.</v>

3
00:00:07.500 --> 00:00:10.000
<v Jordan Engineer>All migration tests are passing cleanly.</v>
`;

    mockZoomClient.mockTranscripts.set(downloadUrl, sampleVtt);

    mockZoomClient.mockRecordings = [
      {
        uuid: meetingUuid,
        id: 1122334455,
        topic: 'Engineering Sync',
        hostId: HOST_ZOOM_ID,
        startTime: new Date().toISOString(),
        duration: 30,
        recordingFiles: [
          {
            id: 'file_vtt_1',
            fileType: 'TRANSCRIPT',
            fileExtension: 'VTT',
            status: 'completed',
            downloadUrl,
          },
        ],
      },
    ];

    // Insert meeting in ready_for_transcript_retrieval
    const [insertedMeeting] = await sql<Array<{ id: string }>>`
      INSERT INTO meetings (
        org_id,
        provider,
        provider_meeting_uuid,
        title,
        zoom_host_id,
        zoom_host_email,
        status,
        guests_present,
        guest_consent_status,
        has_transcript,
        has_recording
      ) VALUES (
        ${testOrg.id},
        'zoom',
        ${meetingUuid},
        'Engineering Sync',
        ${HOST_ZOOM_ID},
        ${hostUser.email},
        'ready_for_transcript_retrieval',
        false,
        'absent',
        true,
        true
      )
      RETURNING id
    `;

    expect(insertedMeeting).toBeDefined();
    const meetingId = insertedMeeting!.id;

    // Run handler
    const success = await handleTranscriptReadyJob(sql, worker.ports, worker.app.log, {
      orgId: testOrg.id,
      meetingId,
      providerMeetingUuid: meetingUuid,
    });

    expect(success).toBe(true);

    // Verify meeting record in database
    const [meetingRow] = await sql<Array<{
      status: string;
      raw_transcript_object_key: string | null;
      raw_transcript_checksum: string | null;
      raw_transcript_byte_count: number | null;
      transcript_retention_deadline: Date | null;
      source_manifest: any;
      version: number;
    }>>`
      SELECT
        status,
        raw_transcript_object_key,
        raw_transcript_checksum,
        raw_transcript_byte_count,
        transcript_retention_deadline,
        source_manifest,
        version
      FROM meetings
      WHERE id = ${meetingId} AND org_id = ${testOrg.id}
    `;

    expect(meetingRow).toBeDefined();
    expect(meetingRow!.status).toBe('transcript_ready');
    expect(meetingRow!.raw_transcript_object_key).toMatch(/^raw-transcripts\//);
    expect(meetingRow!.raw_transcript_checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(meetingRow!.raw_transcript_byte_count).toBeGreaterThan(0);
    expect(meetingRow!.version).toBeGreaterThan(1);

    // Retention deadline should be ~180 days in the future
    const deadlineMs = new Date(meetingRow!.transcript_retention_deadline!).getTime();
    const expectedApproxMs = Date.now() + 180 * 24 * 60 * 60 * 1000;
    expect(Math.abs(deadlineMs - expectedApproxMs)).toBeLessThan(60000);

    // Verify raw object exists in BlobStore
    const blobObject = await worker.ports.blobStore.getObject(meetingRow!.raw_transcript_object_key!);
    expect(blobObject).toBeDefined();
    expect(blobObject.contentType).toBe('text/vtt; charset=utf-8');

    // Verify transcript segments in database
    const transcript = await getMeetingTranscript(sql, {
      orgId: testOrg.id,
      meetingId,
    });

    // Cue 1 and 2 from same speaker (gap = 1000ms <= 2000ms) merged together!
    // Cue 3 from Jordan Engineer is separate segment
    expect(transcript.total).toBe(2);
    expect(transcript.segments).toHaveLength(2);

    const seg1 = transcript.segments[0]!;
    expect(seg1.seq).toBe(1);
    expect(seg1.speakerLabel).toBe('Alex Lead');
    expect(seg1.startMs).toBe(1000);
    expect(seg1.endMs).toBe(6000);
    expect(seg1.text).toBe("Good morning everyone. Let's review the product deliverables.");
    expect(seg1.checksum).toMatch(/^[a-f0-9]{64}$/);

    const seg2 = transcript.segments[1]!;
    expect(seg2.seq).toBe(2);
    expect(seg2.speakerLabel).toBe('Jordan Engineer');
    expect(seg2.startMs).toBe(7500);
    expect(seg2.endMs).toBe(10000);
    expect(seg2.text).toBe('All migration tests are passing cleanly.');

    // Verify outbox event emitted
    const [outboxEvent] = await sql<Array<{ topic: string; payload: any }>>`
      SELECT topic, payload FROM outbox
      WHERE org_id = ${testOrg.id}
        AND topic = 'meeting.transcript_ingested'
        AND payload->>'meetingId' = ${meetingId}
    `;
    expect(outboxEvent).toBeDefined();
    expect(outboxEvent!.topic).toBe('meeting.transcript_ingested');
    expect(outboxEvent!.payload.segmentCount).toBe(2);
  });

  it('rejects processing when guest consent is unverified (status: unknown or pending)', async () => {
    const meetingUuid = `stage13_mtg_guest_check_${Date.now()}==`;

    const [insertedMeeting] = await sql<Array<{ id: string }>>`
      INSERT INTO meetings (
        org_id,
        provider,
        provider_meeting_uuid,
        title,
        zoom_host_id,
        zoom_host_email,
        status,
        guests_present,
        guest_consent_status
      ) VALUES (
        ${testOrg.id},
        'zoom',
        ${meetingUuid},
        'External Client Call',
        ${HOST_ZOOM_ID},
        ${hostUser.email},
        'ready_for_transcript_retrieval',
        true,
        'pending'
      )
      RETURNING id
    `;

    const success = await handleTranscriptReadyJob(sql, worker.ports, worker.app.log, {
      orgId: testOrg.id,
      meetingId: insertedMeeting!.id,
      providerMeetingUuid: meetingUuid,
    });

    expect(success).toBe(false);

    // Verify meeting transitioned to pending_consent
    const [meetingRow] = await sql<Array<{ status: string; intake_error: string | null }>>`
      SELECT status, intake_error FROM meetings
      WHERE id = ${insertedMeeting!.id}
    `;

    expect(meetingRow!.status).toBe('pending_consent');
    expect(meetingRow!.intake_error).toContain('guest consent');
  });

  it('atomically skips a meeting, increments generation, and purges segments and blob storage', async () => {
    const meetingUuid = `stage13_mtg_skip_${Date.now()}==`;
    const downloadUrl = `https://api.zoom.us/v2/recordings/download/${meetingUuid}.vtt`;

    mockZoomClient.mockTranscripts.set(
      downloadUrl,
      'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n<v Host>Confidential meeting</v>'
    );
    mockZoomClient.mockRecordings = [
      {
        uuid: meetingUuid,
        id: 7788990011,
        topic: 'Confidential Discussion',
        hostId: HOST_ZOOM_ID,
        startTime: new Date().toISOString(),
        duration: 10,
        recordingFiles: [
          {
            id: 'file_skip_vtt',
            fileType: 'TRANSCRIPT',
            fileExtension: 'VTT',
            status: 'completed',
            downloadUrl,
          },
        ],
      },
    ];

    const [insertedMeeting] = await sql<Array<{ id: string }>>`
      INSERT INTO meetings (
        org_id,
        provider,
        provider_meeting_uuid,
        title,
        zoom_host_id,
        zoom_host_email,
        status,
        guests_present,
        guest_consent_status
      ) VALUES (
        ${testOrg.id},
        'zoom',
        ${meetingUuid},
        'Confidential Discussion',
        ${HOST_ZOOM_ID},
        ${hostUser.email},
        'ready_for_transcript_retrieval',
        false,
        'absent'
      )
      RETURNING id
    `;
    const meetingId = insertedMeeting!.id;

    // Ingest first
    await handleTranscriptReadyJob(sql, worker.ports, worker.app.log, {
      orgId: testOrg.id,
      meetingId,
      providerMeetingUuid: meetingUuid,
    });

    // Check segments exist before skip
    const beforeSegments = await getMeetingTranscript(sql, { orgId: testOrg.id, meetingId });
    expect(beforeSegments.total).toBe(1);

    const [beforeMeeting] = await sql<Array<{ raw_transcript_object_key: string; version: number }>>`
      SELECT raw_transcript_object_key, version FROM meetings WHERE id = ${meetingId}
    `;
    const rawKey = beforeMeeting!.raw_transcript_object_key;
    expect(rawKey).toBeDefined();

    // Call skipMeetingAndCleanup with correct If-Match version
    const skipped = await skipMeetingAndCleanup(sql, {
      orgId: testOrg.id,
      meetingId,
      ifMatchVersion: beforeMeeting!.version,
      reason: 'Host requested privacy exclusion',
      blobStore: worker.ports.blobStore,
    });

    expect(skipped.skipped).toBe(true);
    expect(skipped.status).toBe('skipped');
    expect(skipped.cleanupStatus).toBe('completed');
    expect(skipped.processingGeneration).toBeGreaterThan(1);

    // Verify segments purged from database
    const afterSegments = await getMeetingTranscript(sql, { orgId: testOrg.id, meetingId });
    expect(afterSegments.total).toBe(0);

    // Verify raw blob was purged from BlobStore
    await expect(worker.ports.blobStore.getObject(rawKey)).rejects.toThrow();

    // Verify outbox emitted meeting.skipped
    const [skipOutbox] = await sql<Array<{ topic: string; payload: any }>>`
      SELECT topic, payload FROM outbox
      WHERE org_id = ${testOrg.id}
        AND topic = 'meeting.skipped'
        AND payload->>'meetingId' = ${meetingId}
    `;
    expect(skipOutbox).toBeDefined();
    expect(skipOutbox!.topic).toBe('meeting.skipped');
    expect(skipOutbox!.payload.cleanupStatus).toBe('completed');
  });

  it('recovers unhandled ready meetings via recoverReadyMeetings sweep', async () => {
    const meetingUuid = `stage13_mtg_recovery_${Date.now()}==`;
    const downloadUrl = `https://api.zoom.us/v2/recordings/download/${meetingUuid}.vtt`;

    mockZoomClient.mockTranscripts.set(
      downloadUrl,
      'WEBVTT\n\n1\n00:00:02.000 --> 00:00:05.000\n<v Recovered>Recovered transcript</v>'
    );
    mockZoomClient.mockRecordings = [
      {
        uuid: meetingUuid,
        id: 9988776655,
        topic: 'Unprocessed Ready Meeting',
        hostId: HOST_ZOOM_ID,
        startTime: new Date().toISOString(),
        duration: 15,
        recordingFiles: [
          {
            id: 'file_rec_vtt',
            fileType: 'TRANSCRIPT',
            fileExtension: 'VTT',
            status: 'completed',
            downloadUrl,
          },
        ],
      },
    ];

    const [insertedMeeting] = await sql<Array<{ id: string }>>`
      INSERT INTO meetings (
        org_id,
        provider,
        provider_meeting_uuid,
        title,
        zoom_host_id,
        zoom_host_email,
        status,
        guests_present,
        guest_consent_status
      ) VALUES (
        ${testOrg.id},
        'zoom',
        ${meetingUuid},
        'Unprocessed Ready Meeting',
        ${HOST_ZOOM_ID},
        ${hostUser.email},
        'ready_for_transcript_retrieval',
        false,
        'absent'
      )
      RETURNING id
    `;

    // Trigger recovery sweep
    const count = await recoverReadyMeetings(sql, worker.ports, worker.app.log, 10);
    expect(count).toBeGreaterThanOrEqual(1);

    const [recMeeting] = await sql<Array<{ status: string }>>`
      SELECT status FROM meetings WHERE id = ${insertedMeeting!.id}
    `;
    expect(recMeeting!.status).toBe('transcript_ready');
  });
});
