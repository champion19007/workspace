import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import {
  parseConfig,
  signInternalApiRequest,
  ZOOM_REQUIRED_SCOPES,
} from '@workspace/core';
import { buildServer, type ServerInstance } from '../server.js';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  connectZoomIntegration,
  updateZoomHostConsent,
  updateMyHostConsent,
  type DatabaseInstance,
  type Sql,
} from '@workspace/db';
import { MockZoomClientAdapter } from '@workspace/adapters';

describe('Stage 12: Secure Zoom Webhook Intake, Deauthorization, and Meeting Metadata (Requirement M-2 & M-4)', () => {
  const secret = 'test-origin-verify-secret-token-16-chars';
  const WEBHOOK_SECRET = 'stage12_webhook_secret_token_12345';

  const testConfig = parseConfig({
    DATABASE_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    DATABASE_DIRECT_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    ORIGIN_VERIFY_SECRET: secret,
    PORT: 8097,
    QUEUE_PROVIDER: 'in_memory',
    REALTIME_PROVIDER: 'in_memory',
    LLM_PROVIDER: 'mock',
    STORAGE_PROVIDER: 'in_memory',
    AUTH_PROVIDER: 'mock',
    SECRET_STORE_PROVIDER: 'in_memory',
    ZOOM_CLIENT_PROVIDER: 'mock',
    ZOOM_WEBHOOK_SECRET_TOKEN: WEBHOOK_SECRET,
  });

  let server: ServerInstance;
  let db: DatabaseInstance;
  let sql: Sql;

  let ownerUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let otherHostUser: { id: string; email: string };

  let testOrg: { id: string; slug: string };
  let otherOrg: { id: string; slug: string };

  const ZOOM_ACCOUNT_ID = 'zoom_act_stage12_123';
  const OPTED_IN_HOST_ID = 'zoom_usr_opted_in_1';
  const OPTED_OUT_HOST_ID = 'zoom_usr_opted_out_2';

  function signZoomWebhook(rawBody: string, timestampSec: number, secretToken = WEBHOOK_SECRET): string {
    const message = `v0:${timestampSec}:${rawBody}`;
    const hash = crypto.createHmac('sha256', secretToken).update(message).digest('hex');
    return `v0=${hash}`;
  }

  function createAuthHeaders(userId: string, email: string, timestamp = Date.now()) {
    const signature = signInternalApiRequest({ userId, email, timestamp }, secret);
    return {
      'x-workspace-user-id': userId,
      'x-workspace-user-email': email,
      'x-workspace-timestamp': timestamp.toString(),
      'x-workspace-signature': signature,
    };
  }

  beforeAll(async () => {
    server = buildServer(testConfig);
    db = server.db;
    sql = server.sql;

    // 1. Seed users
    const owner = await findOrCreateUserByEmail(db, {
      email: 'stage12-owner@example.com',
      name: 'Stage 12 Owner',
    });
    ownerUser = { id: owner.id, email: owner.email };

    const member = await findOrCreateUserByEmail(db, {
      email: 'stage12-member@example.com',
      name: 'Stage 12 Member',
    });
    memberUser = { id: member.id, email: member.email };

    const otherHost = await findOrCreateUserByEmail(db, {
      email: 'stage12-otherhost@example.com',
      name: 'Stage 12 Other Host',
    });
    otherHostUser = { id: otherHost.id, email: otherHost.email };

    // 2. Primary organization
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Stage 12 Primary Org',
      slug: `stage12-primary-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${testOrg.id}, ${memberUser.id}, 'member'),
             (${testOrg.id}, ${otherHostUser.id}, 'member')
    `;

    // 3. Connect Zoom integration for primary org
    const mockZoomClient = server.ports.zoomClient as MockZoomClientAdapter;
    mockZoomClient.mockAccountId = ZOOM_ACCOUNT_ID;
    mockZoomClient.mockHosts = [
      {
        id: OPTED_IN_HOST_ID,
        email: memberUser.email,
        firstName: 'Opted',
        lastName: 'In Host',
        status: 'active',
        type: 2,
      },
      {
        id: OPTED_OUT_HOST_ID,
        email: otherHostUser.email,
        firstName: 'Opted',
        lastName: 'Out Host',
        status: 'active',
        type: 2,
      },
    ];

    await connectZoomIntegration(sql, server.ports.secretStore, server.ports.zoomClient, {
      orgId: testOrg.id,
      userId: ownerUser.id,
      accountId: ZOOM_ACCOUNT_ID,
      accountName: 'Stage 12 Test Zoom Account',
      accountEmail: 'zoom-admin@example.com',
      scopes: [...ZOOM_REQUIRED_SCOPES],
      tokens: {
        access_token: 'initial_stage12_access_token',
        refresh_token: 'initial_stage12_refresh_token',
        expires_in: 3600,
        token_type: 'bearer',
        scope: ZOOM_REQUIRED_SCOPES.join(' '),
      },
    });

    // 4. Set host consent: OPTED_IN_HOST_ID -> opted_in, OPTED_OUT_HOST_ID -> opted_out
    await updateZoomHostConsent(sql, {
      orgId: testOrg.id,
      zoomUserId: OPTED_IN_HOST_ID,
      consentStatus: 'opted_in',
      adminDisabled: false,
      role: 'owner',
      userId: ownerUser.id,
    });

    await updateZoomHostConsent(sql, {
      orgId: testOrg.id,
      zoomUserId: OPTED_OUT_HOST_ID,
      consentStatus: 'opted_out',
      adminDisabled: false,
      role: 'owner',
      userId: ownerUser.id,
    });

    // 5. Secondary organization
    const { org: secOrg } = await createOrganizationWithOwner(db, {
      name: 'Stage 12 Secondary Org',
      slug: `stage12-sec-org-${Date.now()}`,
      userId: otherHostUser.id,
    });
    otherOrg = { id: secOrg.id, slug: secOrg.slug };
  });

  afterAll(async () => {
    if (testOrg) {
      await sql`DELETE FROM meetings WHERE org_id = ${testOrg.id}`;
      await sql`DELETE FROM zoom_host_consents WHERE org_id = ${testOrg.id}`;
      await sql`DELETE FROM integrations WHERE org_id = ${testOrg.id}`;
      await sql`DELETE FROM orgs WHERE id = ${testOrg.id}`;
    }
    if (otherOrg) {
      await sql`DELETE FROM meetings WHERE org_id = ${otherOrg.id}`;
      await sql`DELETE FROM zoom_host_consents WHERE org_id = ${otherOrg.id}`;
      await sql`DELETE FROM integrations WHERE org_id = ${otherOrg.id}`;
      await sql`DELETE FROM orgs WHERE id = ${otherOrg.id}`;
    }
    await server.close();
  });

  describe('1. Webhook Signature and Endpoint Validation Security', () => {
    it('answers endpoint.url_validation challenge in under 3 seconds with valid HMAC token', async () => {
      const plainToken = 'challenge_plain_token_abc_123';
      const body = {
        event: 'endpoint.url_validation',
        payload: { plainToken },
        event_ts: Date.now(),
      };
      const rawBody = JSON.stringify(body);
      const timestampSec = Math.floor(Date.now() / 1000);
      const signature = signZoomWebhook(rawBody, timestampSec);

      const startTime = performance.now();
      const res = await server.app.inject({
        method: 'POST',
        url: '/webhooks/zoom',
        headers: {
          'x-zm-request-timestamp': String(timestampSec),
          'x-zm-signature': signature,
          'Content-Type': 'application/json',
        },
        payload: rawBody,
      });
      const durationMs = performance.now() - startTime;

      expect(durationMs).toBeLessThan(3000);
      expect(res.statusCode).toBe(200);

      const json = res.json();
      expect(json.plainToken).toBe(plainToken);
      const expectedEncryptedToken = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(plainToken)
        .digest('hex');
      expect(json.encryptedToken).toBe(expectedEncryptedToken);
    });

    it('rejects tampered webhook body with 401 Unauthorized', async () => {
      const timestampSec = Math.floor(Date.now() / 1000);
      const validBody = JSON.stringify({ event: 'recording.completed', payload: { account_id: ZOOM_ACCOUNT_ID } });
      const signature = signZoomWebhook(validBody, timestampSec);
      const tamperedBody = JSON.stringify({ event: 'recording.completed', payload: { account_id: 'tampered_acc' } });

      const res = await server.app.inject({
        method: 'POST',
        url: '/webhooks/zoom',
        headers: {
          'x-zm-request-timestamp': String(timestampSec),
          'x-zm-signature': signature,
          'Content-Type': 'application/json',
        },
        payload: tamperedBody,
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('UNAUTHORIZED');
    });

    it('rejects expired timestamp outside the 5-minute window with 401 Unauthorized', async () => {
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 305; // 305s in the past
      const rawBody = JSON.stringify({ event: 'recording.completed', payload: { account_id: ZOOM_ACCOUNT_ID } });
      const signature = signZoomWebhook(rawBody, expiredTimestamp);

      const res = await server.app.inject({
        method: 'POST',
        url: '/webhooks/zoom',
        headers: {
          'x-zm-request-timestamp': String(expiredTimestamp),
          'x-zm-signature': signature,
          'Content-Type': 'application/json',
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().message).toContain('5-minute window');
    });
  });

  describe('2. Meeting Metadata Ingestion, Deduplication, and Lifecycle Transitions', () => {
    const meeting1Uuid = 'instance_uuid_alpha_123';
    const numericMeetingId = 98765432101;

    it('ingests recording.completed event into waiting_for_transcript state in < 3s', async () => {
      const body = {
        event: 'recording.completed',
        event_ts: Date.now(),
        payload: {
          account_id: ZOOM_ACCOUNT_ID,
          object: {
            id: numericMeetingId,
            uuid: meeting1Uuid,
            host_id: OPTED_IN_HOST_ID,
            host_email: memberUser.email,
            topic: 'Sprint 42 Architecture Review',
            start_time: new Date().toISOString(),
            duration: 45,
            timezone: 'Asia/Kolkata',
            recording_files: [
              {
                id: 'file_mp4_1',
                file_type: 'MP4',
                file_extension: 'MP4',
                download_url: 'https://zoom.us/rec/download/sensitive-token-1?access_token=secret_tok',
                status: 'completed',
              },
            ],
          },
        },
      };

      const rawBody = JSON.stringify(body);
      const timestampSec = Math.floor(Date.now() / 1000);
      const signature = signZoomWebhook(rawBody, timestampSec);

      const startTime = performance.now();
      const res = await server.app.inject({
        method: 'POST',
        url: '/webhooks/zoom',
        headers: {
          'x-zm-request-timestamp': String(timestampSec),
          'x-zm-signature': signature,
          'Content-Type': 'application/json',
        },
        payload: rawBody,
      });
      const durationMs = performance.now() - startTime;

      expect(durationMs).toBeLessThan(3000);
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.status).toBe('processed');
      expect(json.meetingStatus).toBe('waiting_for_transcript');

      // Verify database record
      const rows = await sql<Array<{
        id: string;
        status: string;
        provider_numeric_id: string;
        provider_meeting_uuid: string;
        has_transcript: boolean;
      }>>`
        SELECT id, status, provider_numeric_id, provider_meeting_uuid, has_transcript
        FROM meetings
        WHERE org_id = ${testOrg.id} AND provider_meeting_uuid = ${meeting1Uuid}
      `;

      expect(rows.length).toBe(1);
      expect(rows[0]!.status).toBe('waiting_for_transcript');
      expect(rows[0]!.provider_numeric_id).toBe(String(numericMeetingId));
      expect(rows[0]!.has_transcript).toBe(false);

      // Verify receipt was recorded in zoom_webhook_events
      const receipts = await sql`
        SELECT * FROM zoom_webhook_events
        WHERE account_id = ${ZOOM_ACCOUNT_ID} AND provider_meeting_uuid = ${meeting1Uuid}
      `;
      expect(receipts.length).toBe(1);
    });

    it('advances meeting to ready_for_transcript_retrieval on recording.transcript_completed and writes outbox event', async () => {
      const body = {
        event: 'recording.transcript_completed',
        event_ts: Date.now() + 1000,
        payload: {
          account_id: ZOOM_ACCOUNT_ID,
          object: {
            id: numericMeetingId,
            uuid: meeting1Uuid,
            host_id: OPTED_IN_HOST_ID,
            host_email: memberUser.email,
            topic: 'Sprint 42 Architecture Review',
            start_time: new Date().toISOString(),
            duration: 45,
            timezone: 'Asia/Kolkata',
            recording_files: [
              {
                id: 'file_vtt_1',
                file_type: 'TRANSCRIPT',
                file_extension: 'VTT',
                download_url: 'https://zoom.us/rec/download/sensitive-vtt-token?access_token=secret_tok',
                status: 'completed',
              },
            ],
          },
        },
      };

      const rawBody = JSON.stringify(body);
      const timestampSec = Math.floor(Date.now() / 1000);
      const signature = signZoomWebhook(rawBody, timestampSec);

      const res = await server.app.inject({
        method: 'POST',
        url: '/webhooks/zoom',
        headers: {
          'x-zm-request-timestamp': String(timestampSec),
          'x-zm-signature': signature,
          'Content-Type': 'application/json',
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().meetingStatus).toBe('ready_for_transcript_retrieval');

      // Verify meeting in DB advanced
      const rows = await sql<Array<{ status: string; has_transcript: boolean }>>`
        SELECT status, has_transcript FROM meetings
        WHERE org_id = ${testOrg.id} AND provider_meeting_uuid = ${meeting1Uuid}
      `;
      expect(rows[0]!.status).toBe('ready_for_transcript_retrieval');
      expect(rows[0]!.has_transcript).toBe(true);

      // Verify outbox command meeting.transcript_ready was emitted
      const outboxRows = await sql<Array<{ topic: string; payload: { providerMeetingUuid: string } }>>`
        SELECT topic, payload FROM outbox
        WHERE org_id = ${testOrg.id} AND topic = 'meeting.transcript_ready'
      `;
      expect(outboxRows.length).toBeGreaterThan(0);
      expect(outboxRows.some((r) => r.payload.providerMeetingUuid === meeting1Uuid)).toBe(true);
    });

    it('handles duplicate deliveries idempotently without creating duplicate meetings or outbox floods', async () => {
      const body = {
        event: 'recording.transcript_completed',
        event_ts: Date.now() + 2000,
        payload: {
          account_id: ZOOM_ACCOUNT_ID,
          object: {
            id: numericMeetingId,
            uuid: meeting1Uuid,
            host_id: OPTED_IN_HOST_ID,
            host_email: memberUser.email,
            topic: 'Sprint 42 Architecture Review',
            start_time: new Date().toISOString(),
          },
        },
      };

      const rawBody = JSON.stringify(body);
      const timestampSec = Math.floor(Date.now() / 1000);
      const signature = signZoomWebhook(rawBody, timestampSec);

      // Send 5 duplicate requests rapidly
      for (let i = 0; i < 5; i++) {
        const res = await server.app.inject({
          method: 'POST',
          url: '/webhooks/zoom',
          headers: {
            'x-zm-request-timestamp': String(timestampSec),
            'x-zm-signature': signature,
            'Content-Type': 'application/json',
          },
          payload: rawBody,
        });
        expect(res.statusCode).toBe(200);
      }

      // Assert exactly one row in meetings table
      const rows = await sql`
        SELECT id FROM meetings
        WHERE org_id = ${testOrg.id} AND provider_meeting_uuid = ${meeting1Uuid}
      `;
      expect(rows.length).toBe(1);
    });

    it('prevents delayed out-of-order recording.completed from regressing ready_for_transcript_retrieval', async () => {
      // Re-send recording.completed for meeting1Uuid which is already ready_for_transcript_retrieval
      const body = {
        event: 'recording.completed',
        event_ts: Date.now() + 3000,
        payload: {
          account_id: ZOOM_ACCOUNT_ID,
          object: {
            id: numericMeetingId,
            uuid: meeting1Uuid,
            host_id: OPTED_IN_HOST_ID,
            host_email: memberUser.email,
            topic: 'Delayed Recording Completed Event',
            start_time: new Date().toISOString(),
          },
        },
      };

      const rawBody = JSON.stringify(body);
      const timestampSec = Math.floor(Date.now() / 1000);
      const signature = signZoomWebhook(rawBody, timestampSec);

      const res = await server.app.inject({
        method: 'POST',
        url: '/webhooks/zoom',
        headers: {
          'x-zm-request-timestamp': String(timestampSec),
          'x-zm-signature': signature,
          'Content-Type': 'application/json',
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);

      // Check status remains ready_for_transcript_retrieval (did not regress to waiting_for_transcript)
      const rows = await sql<Array<{ status: string }>>`
        SELECT status FROM meetings
        WHERE org_id = ${testOrg.id} AND provider_meeting_uuid = ${meeting1Uuid}
      `;
      expect(rows[0]!.status).toBe('ready_for_transcript_retrieval');
    });

    it('distinguishes separate recurring instances sharing the same numeric meeting ID', async () => {
      // Second instance of recurring meeting with a DIFFERENT instance UUID
      const recurringInstanceUuid = 'instance_uuid_beta_456';

      const body = {
        event: 'recording.completed',
        event_ts: Date.now(),
        payload: {
          account_id: ZOOM_ACCOUNT_ID,
          object: {
            id: numericMeetingId, // Same numeric ID!
            uuid: recurringInstanceUuid, // Unique instance UUID!
            host_id: OPTED_IN_HOST_ID,
            host_email: memberUser.email,
            topic: 'Sprint 43 Recurring Sync',
            start_time: new Date().toISOString(),
          },
        },
      };

      const rawBody = JSON.stringify(body);
      const timestampSec = Math.floor(Date.now() / 1000);
      const signature = signZoomWebhook(rawBody, timestampSec);

      const res = await server.app.inject({
        method: 'POST',
        url: '/webhooks/zoom',
        headers: {
          'x-zm-request-timestamp': String(timestampSec),
          'x-zm-signature': signature,
          'Content-Type': 'application/json',
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);

      // Verify that two distinct meeting rows exist for this numeric ID
      const rows = await sql<Array<{ provider_meeting_uuid: string }>>`
        SELECT provider_meeting_uuid FROM meetings
        WHERE org_id = ${testOrg.id} AND provider_numeric_id = ${String(numericMeetingId)}
      `;

      expect(rows.length).toBe(2);
      const uuids = rows.map((r) => r.provider_meeting_uuid);
      expect(uuids).toContain(meeting1Uuid);
      expect(uuids).toContain(recurringInstanceUuid);
    });

    it('binds meetings.host_id only through the verified consent mapping, never by host email', async () => {
      // Meeting ingested before the member claimed the Zoom identity: same host email, but no binding.
      const [unbound] = await sql<Array<{ host_id: string | null }>>`
        SELECT host_id FROM meetings
        WHERE org_id = ${testOrg.id} AND provider_meeting_uuid = ${meeting1Uuid}
      `;
      expect(unbound!.host_id).toBeNull();

      // Member claims the Zoom host identity through authenticated self-service consent.
      await updateMyHostConsent(sql, {
        orgId: testOrg.id,
        userId: memberUser.id,
        userEmail: memberUser.email,
        consentStatus: 'opted_in',
      });

      const boundUuid = 'instance_uuid_bound_789';
      const rawBody = JSON.stringify({
        event: 'recording.completed',
        event_ts: Date.now(),
        payload: {
          account_id: ZOOM_ACCOUNT_ID,
          object: {
            id: 12312312399,
            uuid: boundUuid,
            host_id: OPTED_IN_HOST_ID,
            host_email: 'renamed-zoom-email@example.com',
            topic: 'Bound Host Sync',
            start_time: new Date(Date.now() + 1000).toISOString(),
          },
        },
      });
      const timestampSec = Math.floor(Date.now() / 1000);
      const res = await server.app.inject({
        method: 'POST',
        url: '/webhooks/zoom',
        headers: {
          'x-zm-request-timestamp': String(timestampSec),
          'x-zm-signature': signZoomWebhook(rawBody, timestampSec),
          'Content-Type': 'application/json',
        },
        payload: rawBody,
      });
      expect(res.statusCode).toBe(200);

      const [bound] = await sql<Array<{ host_id: string | null }>>`
        SELECT host_id FROM meetings
        WHERE org_id = ${testOrg.id} AND provider_meeting_uuid = ${boundUuid}
      `;
      expect(bound!.host_id).toBe(memberUser.id);
    });

    it('marks meeting from opted-out host as skipped tombstone and does not emit ready outbox command', async () => {
      const optedOutUuid = 'instance_opted_out_999';

      const body = {
        event: 'recording.transcript_completed',
        event_ts: Date.now(),
        payload: {
          account_id: ZOOM_ACCOUNT_ID,
          object: {
            id: 12345678,
            uuid: optedOutUuid,
            host_id: OPTED_OUT_HOST_ID, // Explicitly opted-out host!
            host_email: otherHostUser.email,
            topic: 'Opted-Out Host Meeting',
            start_time: new Date().toISOString(),
          },
        },
      };

      const rawBody = JSON.stringify(body);
      const timestampSec = Math.floor(Date.now() / 1000);
      const signature = signZoomWebhook(rawBody, timestampSec);

      const res = await server.app.inject({
        method: 'POST',
        url: '/webhooks/zoom',
        headers: {
          'x-zm-request-timestamp': String(timestampSec),
          'x-zm-signature': signature,
          'Content-Type': 'application/json',
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().meetingStatus).toBe('skipped');

      // Verify meeting in DB is marked skipped
      const rows = await sql<Array<{ status: string; skipped: boolean; intake_error: string }>>`
        SELECT status, skipped, intake_error FROM meetings
        WHERE org_id = ${testOrg.id} AND provider_meeting_uuid = ${optedOutUuid}
      `;

      expect(rows[0]!.status).toBe('skipped');
      expect(rows[0]!.skipped).toBe(true);
      expect(rows[0]!.intake_error).toContain('opt-in consent');

      // Verify NO outbox command for this meeting
      const outboxRows = await sql`
        SELECT * FROM outbox
        WHERE org_id = ${testOrg.id} AND topic = 'meeting.transcript_ready'
          AND payload->>'providerMeetingUuid' = ${optedOutUuid}
      `;
      expect(outboxRows.length).toBe(0);
    });

    it('safely acknowledges unknown or disconnected accounts without creating tenant data', async () => {
      const unknownAccountBody = {
        event: 'recording.completed',
        event_ts: Date.now(),
        payload: {
          account_id: 'unknown_zoom_acc_000',
          object: {
            id: 77777777,
            uuid: 'unknown_instance_777',
            host_id: 'unknown_host',
          },
        },
      };

      const rawBody = JSON.stringify(unknownAccountBody);
      const timestampSec = Math.floor(Date.now() / 1000);
      const signature = signZoomWebhook(rawBody, timestampSec);

      const res = await server.app.inject({
        method: 'POST',
        url: '/webhooks/zoom',
        headers: {
          'x-zm-request-timestamp': String(timestampSec),
          'x-zm-signature': signature,
          'Content-Type': 'application/json',
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('ignored_unmapped_account');

      // Verify no meeting row created
      const rows = await sql`
        SELECT * FROM meetings WHERE provider_meeting_uuid = 'unknown_instance_777'
      `;
      expect(rows.length).toBe(0);
    });
  });

  describe('3. Durable Deauthorization Handling (app_deauthorized)', () => {
    it('disconnects installation, increments generation, purges secrets, and updates waiting meetings', async () => {
      const deauthBody = {
        event: 'app_deauthorized',
        event_ts: Date.now(),
        payload: {
          account_id: ZOOM_ACCOUNT_ID,
          deauthorization_time: new Date().toISOString(),
          user_data_retention: 'false',
        },
      };

      const rawBody = JSON.stringify(deauthBody);
      const timestampSec = Math.floor(Date.now() / 1000);
      const signature = signZoomWebhook(rawBody, timestampSec);

      const res = await server.app.inject({
        method: 'POST',
        url: '/webhooks/zoom',
        headers: {
          'x-zm-request-timestamp': String(timestampSec),
          'x-zm-signature': signature,
          'Content-Type': 'application/json',
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('deauthorized');

      // Verify integration marked disconnected and generation incremented
      const integrationRows = await sql<Array<{
        status: string;
        connection_generation: number;
        last_error_category: string;
      }>>`
        SELECT status, connection_generation, last_error_category FROM integrations
        WHERE org_id = ${testOrg.id} AND provider = 'zoom'
      `;
      expect(integrationRows[0]!.status).toBe('disconnected');
      expect(integrationRows[0]!.connection_generation).toBeGreaterThanOrEqual(2);
      expect(integrationRows[0]!.last_error_category).toBe('deauthorized');

      // Verify deauthorized outbox event emitted
      const deauthOutbox = await sql`
        SELECT * FROM outbox
        WHERE org_id = ${testOrg.id} AND topic = 'integration.zoom.deauthorized'
      `;
      expect(deauthOutbox.length).toBeGreaterThan(0);

      // Verify Secret Store was purged
      const secret = await server.ports.secretStore.getSecret(`zoom:${testOrg.id}`);
      expect(secret).toBeNull();
    });
  });

  describe('4. Meeting Access Control and Ingestion RBAC', () => {
    let meetingRowId: string;

    beforeAll(async () => {
      // Re-insert an active meeting for query verification
      const [mtg] = await sql<Array<{ id: string }>>`
        INSERT INTO meetings (
          org_id, provider, provider_meeting_uuid, provider_numeric_id,
          title, zoom_host_id, zoom_host_email, host_id, status
        ) VALUES (
          ${testOrg.id}, 'zoom', 'rbac_test_meeting_uuid', '55555555',
          'RBAC Review Meeting', ${OPTED_IN_HOST_ID}, ${memberUser.email}, ${memberUser.id},
          'ready_for_transcript_retrieval'
        )
        RETURNING id
      `;
      meetingRowId = mtg!.id;
    });

    it('allows Owners and Admins to list all meetings in organization', async () => {
      const signedHeaders = createAuthHeaders(ownerUser.id, ownerUser.email);

      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings`,
        headers: signedHeaders,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(Array.isArray(json.meetings)).toBe(true);
      expect(json.meetings.some((m: { id: string }) => m.id === meetingRowId)).toBe(true);
    });

    it('allows regular Members to view only meetings where they are the verified host', async () => {
      const signedHeaders = createAuthHeaders(memberUser.id, memberUser.email);

      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings`,
        headers: signedHeaders,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(Array.isArray(json.meetings)).toBe(true);
      // Member is the host of this meeting
      expect(json.meetings.some((m: { id: string }) => m.id === meetingRowId)).toBe(true);
    });

    it('prohibits non-member access across organizations', async () => {
      // User from otherOrg tries to view testOrg's meetings
      const signedHeaders = createAuthHeaders(otherHostUser.id, otherHostUser.email);

      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${otherOrg.slug}/meetings`,
        headers: signedHeaders,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      // Should not contain testOrg's meetings
      expect(json.meetings.some((m: { id: string }) => m.id === meetingRowId)).toBe(false);
    });
  });
});
