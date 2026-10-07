import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parseConfig,
  signInternalApiRequest,
  type AppPorts,
} from '@workspace/core';
import { buildServer, type ServerInstance } from '../server.js';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  ingestMeetingTranscript,
  type DatabaseInstance,
  type Sql,
} from '@workspace/db';

describe('Stage 13: Transcript Retrieval and Meeting Skip APIs (Requirements M-2 & M-4)', () => {
  const secret = 'test-origin-verify-secret-token-16-chars';

  const testConfig = parseConfig({
    DATABASE_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    DATABASE_DIRECT_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    ORIGIN_VERIFY_SECRET: secret,
    PORT: 8098,
    QUEUE_PROVIDER: 'in_memory',
    REALTIME_PROVIDER: 'in_memory',
    LLM_PROVIDER: 'mock',
    STORAGE_PROVIDER: 'in_memory',
    AUTH_PROVIDER: 'mock',
    SECRET_STORE_PROVIDER: 'in_memory',
    ZOOM_CLIENT_PROVIDER: 'mock',
    ZOOM_WEBHOOK_SECRET_TOKEN: 'stage13_webhook_token',
  });

  let server: ServerInstance;
  let db: DatabaseInstance;
  let sql: Sql;
  let ports: AppPorts;

  let ownerUser: { id: string; email: string };
  let hostMemberUser: { id: string; email: string };
  let otherMemberUser: { id: string; email: string };
  let viewerUser: { id: string; email: string };

  let testOrg: { id: string; slug: string };
  let ingestedMeetingId: string;
  let ingestedMeetingVersion: number;
  const rawBlobKey = 'raw-transcripts/stage13-test-meeting.vtt';

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
    ports = server.ports;

    // 1. Seed users
    const owner = await findOrCreateUserByEmail(db, {
      email: 'stage13-owner@example.com',
      name: 'Stage 13 Owner',
    });
    ownerUser = { id: owner.id, email: owner.email };

    const hostMember = await findOrCreateUserByEmail(db, {
      email: 'stage13-host@example.com',
      name: 'Stage 13 Host Member',
    });
    hostMemberUser = { id: hostMember.id, email: hostMember.email };

    const otherMember = await findOrCreateUserByEmail(db, {
      email: 'stage13-other@example.com',
      name: 'Stage 13 Other Member',
    });
    otherMemberUser = { id: otherMember.id, email: otherMember.email };

    const viewer = await findOrCreateUserByEmail(db, {
      email: 'stage13-viewer@example.com',
      name: 'Stage 13 Viewer',
    });
    viewerUser = { id: viewer.id, email: viewer.email };

    // 2. Organization and memberships
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Stage 13 Transcripts Org',
      slug: `stage13-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${testOrg.id}, ${hostMemberUser.id}, 'member'),
             (${testOrg.id}, ${otherMemberUser.id}, 'member'),
             (${testOrg.id}, ${viewerUser.id}, 'viewer')
    `;

    // 3. Insert mock raw transcript into blob store
    await ports.blobStore.putObject({
      key: rawBlobKey,
      body: Buffer.from('WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\n<v Host>Architecture review session</v>'),
      contentType: 'text/vtt',
    });

    // 4. Create meeting record in DB
    const [meetingRow] = await sql<Array<{ id: string }>>`
      INSERT INTO meetings (
        org_id,
        provider,
        provider_meeting_uuid,
        provider_numeric_id,
        title,
        zoom_host_id,
        zoom_host_email,
        host_id,
        status,
        has_transcript,
        has_recording,
        connection_generation,
        processing_generation,
        guest_consent_status,
        version
      ) VALUES (
        ${testOrg.id},
        'zoom',
        ${`stage13_mtg_uuid_${Date.now()}`},
        '987654321',
        'Stage 13 Architecture Sync',
        'zoom_host_stg13',
        ${hostMemberUser.email},
        ${hostMemberUser.id},
        'ready_for_transcript_retrieval',
        false,
        true,
        1,
        1,
        'consented',
        1
      )
      RETURNING id
    `;
    ingestedMeetingId = meetingRow!.id;

    // 5. Ingest transcript segments
    const ingestResult = await ingestMeetingTranscript(sql, {
      orgId: testOrg.id,
      meetingId: ingestedMeetingId,
      expectedProcessingGeneration: 1,
      rawTranscriptObjectKey: rawBlobKey,
      rawTranscriptChecksum: 'mockchecksum1234567890',
      rawTranscriptByteCount: 120,
      sourceManifest: {
        files: [],
        totalCues: 3,
        totalSegments: 3,
        durationMs: 45000,
        rawTranscriptChecksum: 'mockchecksum1234567890',
        rawTranscriptByteCount: 120,
        processedAt: new Date().toISOString(),
      },
      segments: [
        {
          seq: 1,
          speakerLabel: 'Alice (Host)',
          startMs: 1000,
          endMs: 8000,
          text: 'Welcome everyone to the architecture review meeting.',
          checksum: 'hash1',
        },
        {
          seq: 2,
          speakerLabel: 'Bob',
          startMs: 9000,
          endMs: 25000,
          text: 'Thanks Alice, let us look at the database schema design.',
          checksum: 'hash2',
        },
        {
          seq: 3,
          speakerLabel: 'Alice (Host)',
          startMs: 26000,
          endMs: 45000,
          text: 'Agreed. Next we will finalize the skip and cleanup strategy.',
          checksum: 'hash3',
        },
      ],
    });

    ingestedMeetingVersion = ingestResult.meeting.version;
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  describe('GET /api/v1/orgs/:orgSlug/meetings/:meetingId/transcript', () => {
    it('returns 401 when request is unauthenticated', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${ingestedMeetingId}/transcript`,
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 403 Forbidden for Viewer role', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${ingestedMeetingId}/transcript`,
        headers: createAuthHeaders(viewerUser.id, viewerUser.email),
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.message).toContain('Viewers cannot access meeting transcripts');
    });

    it('returns 403 Forbidden for Member who did not host the meeting', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${ingestedMeetingId}/transcript`,
        headers: createAuthHeaders(otherMemberUser.id, otherMemberUser.email),
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.message).toContain('You can only view transcripts for meetings you hosted');
    });

    it('returns 200 OK with transcript segments and ETag header for Owner', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${ingestedMeetingId}/transcript`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['etag']).toBe(`"v${ingestedMeetingVersion}"`);

      const body = JSON.parse(res.body);
      expect(body.total).toBe(3);
      expect(body.segments).toHaveLength(3);
      expect(body.segments[0].seq).toBe(1);
      expect(body.segments[0].speakerLabel).toBe('Alice (Host)');
      expect(body.segments[0].text).toBe('Welcome everyone to the architecture review meeting.');
      expect(body.hasMore).toBe(false);
    });

    it('returns 200 OK for the Host Member', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${ingestedMeetingId}/transcript`,
        headers: createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.total).toBe(3);
      expect(body.segments).toHaveLength(3);
    });

    it('supports pagination via limit and offset', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${ingestedMeetingId}/transcript?limit=1&offset=1`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.total).toBe(3);
      expect(body.limit).toBe(1);
      expect(body.offset).toBe(1);
      expect(body.segments).toHaveLength(1);
      expect(body.segments[0].seq).toBe(2);
      expect(body.segments[0].text).toContain('database schema design');
      expect(body.hasMore).toBe(true);
    });

    it('supports search query filter across cues', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${ingestedMeetingId}/transcript?search=cleanup`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.total).toBe(1);
      expect(body.segments).toHaveLength(1);
      expect(body.segments[0].seq).toBe(3);
      expect(body.segments[0].text).toContain('skip and cleanup strategy');
    });

    it('returns 404 for non-existent meeting', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/00000000-0000-0000-0000-000000000000/transcript`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/orgs/:orgSlug/meetings/:meetingId/skip', () => {
    it('returns 428 Precondition Required when If-Match header is missing', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${ingestedMeetingId}/skip`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { reason: 'No longer needed' },
      });

      expect(res.statusCode).toBe(428);
      const body = JSON.parse(res.body);
      expect(body.detail).toContain('If-Match header is required');
    });

    it('returns 412 Precondition Failed when weak ETag is provided', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${ingestedMeetingId}/skip`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': `W/"v${ingestedMeetingVersion}"`,
        },
        payload: { reason: 'Weak tag test' },
      });

      expect(res.statusCode).toBe(412);
      const body = JSON.parse(res.body);
      expect(body.detail).toContain('Weak entity tags');
    });

    it('returns 412 Precondition Failed when version mismatch occurs', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${ingestedMeetingId}/skip`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': '"v999"',
        },
        payload: { reason: 'Version mismatch test' },
      });

      expect(res.statusCode).toBe(412);
      const body = JSON.parse(res.body);
      expect(body.detail).toContain('Version conflict');
    });

    it('returns 403 Forbidden for Viewer role', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${ingestedMeetingId}/skip`,
        headers: {
          ...createAuthHeaders(viewerUser.id, viewerUser.email),
          'if-match': `"v${ingestedMeetingVersion}"`,
        },
        payload: { reason: 'Viewer skip test' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 403 Forbidden for non-host Member', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${ingestedMeetingId}/skip`,
        headers: {
          ...createAuthHeaders(otherMemberUser.id, otherMemberUser.email),
          'if-match': `"v${ingestedMeetingVersion}"`,
        },
        payload: { reason: 'Other member skip test' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('successfully skips meeting, fences generation, purges segments and deletes blob for Owner', async () => {
      // Verify raw blob exists before skip
      const blobBefore = await ports.blobStore.getObject(rawBlobKey);
      expect(blobBefore).not.toBeNull();

      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${ingestedMeetingId}/skip`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': `"v${ingestedMeetingVersion}"`,
        },
        payload: { reason: 'Meeting skipped by workspace owner' },
      });

      expect(res.statusCode).toBe(200);
      const newVersion = ingestedMeetingVersion + 1;
      expect(res.headers['etag']).toBe(`"v${newVersion}"`);

      const body = JSON.parse(res.body);
      expect(body.meeting.id).toBe(ingestedMeetingId);
      expect(body.meeting.skipped).toBe(true);
      expect(body.meeting.status).toBe('skipped');
      expect(body.meeting.cleanupStatus).toBe('completed');
      expect(body.meeting.rawTranscriptObjectKey).toBeNull();
      expect(body.meeting.processingGeneration).toBe(2);

      // Verify DB transcript segments were purged
      const segRows = await sql`
        SELECT * FROM transcript_segments
        WHERE org_id = ${testOrg.id} AND meeting_id = ${ingestedMeetingId}
      `;
      expect(segRows).toHaveLength(0);

      // Verify raw blob was deleted from blob store
      await expect(ports.blobStore.getObject(rawBlobKey)).rejects.toThrow('Blob not found');

      // Verify outbox recorded meeting.skipped event
      const outboxRows = await sql`
        SELECT * FROM outbox
        WHERE org_id = ${testOrg.id} AND topic = 'meeting.skipped'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]!.payload.meetingId).toBe(ingestedMeetingId);
      expect(outboxRows[0]!.payload.cleanupStatus).toBe('completed');
    });
  });
});
