import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parseConfig,
  signInternalApiRequest,
  generateUuidV7,
  formatETag,
} from '@workspace/core';
import { buildServer, type ServerInstance } from '../server.js';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  type DatabaseInstance,
  type Sql,
} from '@workspace/db';

describe('Stage 14: Project Routing and Speaker Resolution APIs (Requirements M-3 & M-4)', () => {
  const secret = 'test-origin-verify-secret-token-16-chars';

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
    ZOOM_WEBHOOK_SECRET_TOKEN: 'stage14_api_webhook_token',
  });

  let server: ServerInstance;
  let db: DatabaseInstance;
  let sql: Sql;

  let ownerUser: { id: string; email: string; name?: string | null };
  let hostMemberUser: { id: string; email: string; name?: string | null };
  let otherMemberUser: { id: string; email: string; name?: string | null };
  let viewerUser: { id: string; email: string; name?: string | null };

  let testOrg: { id: string; slug: string };
  let candidateProject1Id: string;
  let candidateProject2Id: string;
  let teamNodeId: string;
  let archivedProjectId: string;
  let privateProjectId: string;

  let meetingId: string;
  let meetingVersion: number;

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
      email: 'stage14-api-owner@example.com',
      name: 'Stage 14 API Owner',
    });
    ownerUser = { id: owner.id, email: owner.email, name: owner.name };

    const hostMember = await findOrCreateUserByEmail(db, {
      email: 'stage14-api-host@example.com',
      name: 'Stage 14 API Host',
    });
    hostMemberUser = { id: hostMember.id, email: hostMember.email, name: hostMember.name };

    const otherMember = await findOrCreateUserByEmail(db, {
      email: 'stage14-api-other@example.com',
      name: 'Stage 14 API Other',
    });
    otherMemberUser = { id: otherMember.id, email: otherMember.email, name: otherMember.name };

    const viewer = await findOrCreateUserByEmail(db, {
      email: 'stage14-api-viewer@example.com',
      name: 'Stage 14 API Viewer',
    });
    viewerUser = { id: viewer.id, email: viewer.email, name: viewer.name };

    // 2. Organization and memberships
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Stage 14 Routing API Test Org',
      slug: `stage14-routing-api-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES 
        (${testOrg.id}, ${hostMemberUser.id}, 'member'),
        (${testOrg.id}, ${otherMemberUser.id}, 'member'),
        (${testOrg.id}, ${viewerUser.id}, 'viewer')
    `;

    // 3. Setup nodes hierarchy: team -> 2 public projects, 1 archived project, 1 private project
    teamNodeId = generateUuidV7();
    await sql`
      INSERT INTO nodes (id, org_id, parent_id, kind, name, path, visibility)
      VALUES (${teamNodeId}, ${testOrg.id}, NULL, 'team', 'Engineering Team', 'engineering', 'public')
    `;

    candidateProject1Id = generateUuidV7();
    await sql`
      INSERT INTO nodes (id, org_id, parent_id, kind, name, path, visibility)
      VALUES (${candidateProject1Id}, ${testOrg.id}, ${teamNodeId}, 'project', 'Alpha Pipeline', 'engineering.alpha', 'public')
    `;

    candidateProject2Id = generateUuidV7();
    await sql`
      INSERT INTO nodes (id, org_id, parent_id, kind, name, path, visibility)
      VALUES (${candidateProject2Id}, ${testOrg.id}, ${teamNodeId}, 'project', 'Beta Migration', 'engineering.beta', 'public')
    `;

    archivedProjectId = generateUuidV7();
    await sql`
      INSERT INTO nodes (id, org_id, parent_id, kind, name, path, visibility, archived_at)
      VALUES (${archivedProjectId}, ${testOrg.id}, ${teamNodeId}, 'project', 'Archived Legacy Project', 'engineering.legacy', 'public', NOW())
    `;

    privateProjectId = generateUuidV7();
    await sql`
      INSERT INTO nodes (id, org_id, parent_id, kind, name, path, visibility)
      VALUES (${privateProjectId}, ${testOrg.id}, ${teamNodeId}, 'project', 'Executive Secret Project', 'engineering.exec', 'private')
    `;

    // 4. Create a test meeting in awaiting_project_choice
    meetingId = generateUuidV7();
    const [insertedMeeting] = await sql<Array<{ id: string; version: number }>>`
      INSERT INTO meetings (
        id, org_id, provider, provider_meeting_uuid, title, duration_seconds, status,
        processing_generation, host_id, zoom_host_email, suggested_node_id, routing_confidence, routing_reason
      )
      VALUES (
        ${meetingId}, ${testOrg.id}, 'zoom', ${`uuid_${meetingId.slice(0, 8)}`},
        'Sprint 14 Routing Planning', 1200, 'awaiting_project_choice',
        1, ${hostMemberUser.id}, ${hostMemberUser.email}, ${candidateProject1Id}, 0.65, 'Ambiguous project reference'
      )
      RETURNING id, version
    `;
    meetingVersion = insertedMeeting!.version;

    // Add transcript segments for speaker testing
    await sql`
      INSERT INTO transcript_segments (id, org_id, meeting_id, seq, speaker_label, start_ms, end_ms, text)
      VALUES
        (${generateUuidV7()}, ${testOrg.id}, ${meetingId}, 1, 'Stage 14 API Host', 0, 10000, 'Welcome to the planning meeting'),
        (${generateUuidV7()}, ${testOrg.id}, ${meetingId}, 2, 'Unmapped Guest', 11000, 25000, 'I have questions about Beta migration')
    `;

    // Connect mock Zoom integration for host consent tests
    const accountId = `acct_14_${testOrg.id.slice(0, 8)}`;
    await sql`
      INSERT INTO integrations (id, org_id, provider, account_id, secret_arn, status)
      VALUES (${generateUuidV7()}, ${testOrg.id}, 'zoom', ${accountId}, 'mock-secret-arn', 'connected')
    `;
  });

  afterAll(async () => {
    await server.app.close();
  });

  describe('GET /api/v1/orgs/:orgSlug/meetings/:meetingId/routing-candidates', () => {
    it('returns candidate project leaves visible to meeting host', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${meetingId}/routing-candidates`,
        headers: createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.candidates).toBeDefined();
      expect(Array.isArray(body.candidates)).toBe(true);

      const candidateIds = body.candidates.map((c: any) => c.id);
      expect(candidateIds).toContain(candidateProject1Id);
      expect(candidateIds).toContain(candidateProject2Id);
      // Teams and archived projects must be excluded
      expect(candidateIds).not.toContain(teamNodeId);
      expect(candidateIds).not.toContain(archivedProjectId);
      // Host member has no access to private project
      expect(candidateIds).not.toContain(privateProjectId);
    });

    it('returns private projects if requested by organization owner', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${meetingId}/routing-candidates`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const candidateIds = body.candidates.map((c: any) => c.id);
      expect(candidateIds).toContain(privateProjectId);
    });

    it('returns 403 for member who is not the meeting host', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${meetingId}/routing-candidates`,
        headers: createAuthHeaders(otherMemberUser.id, otherMemberUser.email),
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 403 for organization viewer', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${meetingId}/routing-candidates`,
        headers: createAuthHeaders(viewerUser.id, viewerUser.email),
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/orgs/:orgSlug/meetings/:meetingId/speakers', () => {
    it('returns speaker resolution summary for meeting host', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${meetingId}/speakers`,
        headers: createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.speakers).toBeDefined();
      expect(body.speakers).toHaveLength(2);
      expect(body.speakers.map((s: any) => s.speakerLabel)).toEqual(
        expect.arrayContaining(['Stage 14 API Host', 'Unmapped Guest'])
      );
    });
  });

  describe('POST /api/v1/orgs/:orgSlug/meetings/:meetingId/speakers', () => {
    it('allows host to manually map a speaker label to an active org member', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${meetingId}/speakers`,
        headers: createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
        payload: {
          speakerLabel: 'Unmapped Guest',
          userId: otherMemberUser.id,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.meeting).toBeDefined();

      // Verify transcript segments were updated
      const [seg] = await sql<Array<{ user_id: string; resolution_method: string }>>`
        SELECT user_id, resolution_method FROM transcript_segments
        WHERE meeting_id = ${meetingId} AND speaker_label = 'Unmapped Guest'
      `;
      expect(seg?.user_id).toBe(otherMemberUser.id);
      expect(seg?.resolution_method).toBe('manual');
    });

    it('rejects mapping to a user ID not in the organization', async () => {
      const externalUserId = generateUuidV7();
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${meetingId}/speakers`,
        headers: createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
        payload: {
          speakerLabel: 'Unmapped Guest',
          userId: externalUserId,
        },
      });

      expect(res.statusCode).toBe(422); // ValidationError
    });
  });

  describe('POST /api/v1/orgs/:orgSlug/meetings/:meetingId/route', () => {
    it('returns 428 when If-Match header is missing', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${meetingId}/route`,
        headers: createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
        payload: {
          nodeId: candidateProject2Id,
        },
      });

      expect(res.statusCode).toBe(428);
    });

    it('returns 412 when If-Match header version does not match', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${meetingId}/route`,
        headers: {
          ...createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
          'if-match': formatETag(meetingVersion + 99),
        },
        payload: {
          nodeId: candidateProject2Id,
        },
      });

      expect(res.statusCode).toBe(412);
    });

    it('rejects routing to a non-project node (team)', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${meetingId}/route`,
        headers: {
          ...createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
          'if-match': formatETag(meetingVersion),
        },
        payload: {
          nodeId: teamNodeId,
        },
      });

      expect(res.statusCode).toBe(422); // ValidationError
    });

    it('rejects routing to an archived project', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${meetingId}/route`,
        headers: {
          ...createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
          'if-match': formatETag(meetingVersion),
        },
        payload: {
          nodeId: archivedProjectId,
        },
      });

      expect(res.statusCode).toBe(404);
    });

    it('successfully routes meeting to active project leaf with valid If-Match', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${meetingId}/route`,
        headers: {
          ...createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
          'if-match': formatETag(meetingVersion),
        },
        payload: {
          nodeId: candidateProject2Id,
          reason: 'Confirmed project context is Beta Migration',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.meeting).toBeDefined();
      expect(body.meeting.status).toBe('routed');
      expect(body.meeting.nodeId).toBe(candidateProject2Id);
      expect(body.meeting.version).toBe(meetingVersion + 1);

      // Verify ETag header returned
      expect(res.headers.etag).toBe(formatETag(meetingVersion + 1));

      // Verify outbox event emitted
      const [outbox] = await sql<Array<{ topic: string; payload: any }>>`
        SELECT topic, payload FROM outbox
        WHERE org_id = ${testOrg.id} AND topic = 'meeting.routed'
        ORDER BY created_at DESC LIMIT 1
      `;
      expect(outbox).toBeDefined();
      expect(outbox?.payload.nodeId).toBe(candidateProject2Id);
      expect(outbox?.payload.meetingId).toBe(meetingId);

      // Update local version for subsequent tests
      meetingVersion = body.meeting.version;
    });
  });

  describe('POST /api/v1/orgs/:orgSlug/meetings/:meetingId/guest-consent', () => {
    it('allows host to confirm guest consent resolution', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/meetings/${meetingId}/guest-consent`,
        headers: createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
        payload: {
          guestConsentStatus: 'consented',
          attestationNotes: 'Verbal consent verified at start of call',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.meeting.guestConsentStatus).toBe('consented');
    });
  });

  describe('Self-Service Host Consent Endpoints', () => {
    it('GET /api/v1/orgs/:orgSlug/zoom/my-consent returns initial consent status', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/zoom/my-consent`,
        headers: createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('consent');
    });

    it('PATCH /api/v1/orgs/:orgSlug/zoom/my-consent allows host to opt-in', async () => {
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/zoom/my-consent`,
        headers: createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
        payload: {
          consentStatus: 'opted_in',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.consent.consentStatus).toBe('opted_in');
      expect(body.consent.userId).toBe(hostMemberUser.id);
    });

    it('PATCH /api/v1/orgs/:orgSlug/zoom/my-consent allows host to opt-out and fences processing', async () => {
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/zoom/my-consent`,
        headers: createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
        payload: {
          consentStatus: 'opted_out',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.consent.consentStatus).toBe('opted_out');
    });
  });
});
