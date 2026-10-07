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

describe('Stage 15: Meeting Notes & Action-Suggestion APIs (Requirement N-1)', () => {
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
    ZOOM_WEBHOOK_SECRET_TOKEN: 'stage15_api_webhook_token',
  });

  let server: ServerInstance;
  let db: DatabaseInstance;
  let sql: Sql;

  let ownerUser: { id: string; email: string };
  let hostMemberUser: { id: string; email: string };
  let projectMemberUser: { id: string; email: string };
  let restrictedMemberUser: { id: string; email: string };
  let viewerUser: { id: string; email: string };

  let testOrg: { id: string; slug: string };
  let projectNodeId: string;
  let completedMeetingId: string;
  let pendingMeetingId: string;
  const meetingVersion = 3;

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
      email: 'stage15-api-owner@example.com',
      name: 'Stage 15 API Owner',
    });
    ownerUser = { id: owner.id, email: owner.email };

    const host = await findOrCreateUserByEmail(db, {
      email: 'stage15-api-host@example.com',
      name: 'Stage 15 API Host',
    });
    hostMemberUser = { id: host.id, email: host.email };

    const projectMember = await findOrCreateUserByEmail(db, {
      email: 'stage15-api-proj-member@example.com',
      name: 'Stage 15 API Project Member',
    });
    projectMemberUser = { id: projectMember.id, email: projectMember.email };

    const restrictedMember = await findOrCreateUserByEmail(db, {
      email: 'stage15-api-restricted@example.com',
      name: 'Stage 15 API Restricted Member',
    });
    restrictedMemberUser = { id: restrictedMember.id, email: restrictedMember.email };

    const viewer = await findOrCreateUserByEmail(db, {
      email: 'stage15-api-viewer@example.com',
      name: 'Stage 15 API Viewer',
    });
    viewerUser = { id: viewer.id, email: viewer.email };

    // 2. Organization and memberships
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Stage 15 Notes API Test Org',
      slug: `stage15-notes-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${testOrg.id}, ${hostMemberUser.id}, 'member'),
             (${testOrg.id}, ${projectMemberUser.id}, 'member'),
             (${testOrg.id}, ${restrictedMemberUser.id}, 'member'),
             (${testOrg.id}, ${viewerUser.id}, 'viewer')
    `;

    // 3. Create private project node
    projectNodeId = generateUuidV7();
    await sql`
      INSERT INTO nodes (
        id, org_id, kind, name, path, visibility, rollup
      ) VALUES (
        ${projectNodeId}, ${testOrg.id}, 'project', 'Secret Project',
        ${`secret-project-${Date.now()}`}, 'private', '{}'::jsonb
      )
    `;

    // Give projectMember access to this node
    await sql`
      INSERT INTO node_members (org_id, node_id, user_id)
      VALUES (${testOrg.id}, ${projectNodeId}, ${projectMemberUser.id})
    `;

    // 4. Create completed meeting with notes & suggestions
    completedMeetingId = generateUuidV7();
    await sql`
      INSERT INTO meetings (
        id, org_id, provider, provider_meeting_uuid, provider_numeric_id,
        title, zoom_host_id, zoom_host_email, host_id, status,
        processing_generation, node_id, version, created_at, updated_at
      ) VALUES (
        ${completedMeetingId}, ${testOrg.id}, 'zoom',
        ${`uuid-notes-${Date.now()}`}, ${`num-${Date.now()}`},
        'Sprint 15 Demo', 'zh_host_1', ${hostMemberUser.email}, ${hostMemberUser.id},
        'completed', 1, ${projectNodeId}, ${meetingVersion}, now(), now()
      )
    `;

    // Insert doc record
    const docId = generateUuidV7();
    await sql`
      INSERT INTO docs (
        id, org_id, node_id, title, body_md, version, created_by, updated_by, source_meeting_id, created_at, updated_at
      ) VALUES (
        ${docId}, ${testOrg.id}, ${projectNodeId}, 'Notes: Sprint 15 Demo',
        '## Executive Summary', 1, NULL, NULL, ${completedMeetingId}, now(), now()
      )
    `;

    // Insert notes
    const notesId = generateUuidV7();
    await sql`
      INSERT INTO meeting_notes (
        id, org_id, meeting_id, summary_md, decisions, open_questions,
        evidence, model, prompt_version, cost_inr, doc_id, created_at, updated_at
      ) VALUES (
        ${notesId}, ${testOrg.id}, ${completedMeetingId},
        '## Executive Summary\nDiscussed requirements for Stage 15 notes extraction.',
        ${JSON.stringify([{ text: 'Use temperature 0.0', evidence: [{ seq: 1, quote: 'We decided on temp 0' }] }])}::jsonb,
        ${JSON.stringify([{ text: 'When is Stage 16 kickoff?', evidence: [{ seq: 2, quote: 'What about Stage 16?' }] }])}::jsonb,
        '[]'::jsonb,
        'claude-3-7-sonnet-latest', 'v1.0.0', 0.15, ${docId}, now(), now()
      )
    `;

    // Insert staged action item (with Strict N-1 evidence)
    const actionId = generateUuidV7();
    await sql`
      INSERT INTO action_items (
        id, org_id, meeting_id, text, owner_name, due_phrase,
        evidence, confidence, state, proposal_type, task_id, decided_by,
        created_at, updated_at
      ) VALUES (
        ${actionId}, ${testOrg.id}, ${completedMeetingId},
        'Update documentation with ADR 15', 'Alice Host', 'by tomorrow',
        ${JSON.stringify([{ seq: 3, quote: 'Alice will update documentation' }])}::jsonb,
        0.95, 'suggested', 'create_task', NULL, NULL, now(), now()
      )
    `;

    // 5. Create pending meeting (no notes generated yet)
    pendingMeetingId = generateUuidV7();
    await sql`
      INSERT INTO meetings (
        id, org_id, provider, provider_meeting_uuid, provider_numeric_id,
        title, zoom_host_id, zoom_host_email, host_id, status,
        processing_generation, node_id, version, created_at, updated_at
      ) VALUES (
        ${pendingMeetingId}, ${testOrg.id}, 'zoom',
        ${`uuid-pending-${Date.now()}`}, ${`num-p-${Date.now()}`},
        'Pending Intake Meeting', 'zh_host_2', ${hostMemberUser.email}, ${hostMemberUser.id},
        'routed', 1, ${projectNodeId}, 1, now(), now()
      )
    `;
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${testOrg.slug}/meetings/${completedMeetingId}/notes`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects member without project access with 404 Not Found (zero private leakage)', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${testOrg.slug}/meetings/${completedMeetingId}/notes`,
      headers: createAuthHeaders(restrictedMemberUser.id, restrictedMemberUser.email),
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('NOT_FOUND');
  });

  it('rejects meeting host with 404 when routed to private project they do not belong to (hosting does not bypass privacy)', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${testOrg.slug}/meetings/${completedMeetingId}/notes`,
      headers: createAuthHeaders(hostMemberUser.id, hostMemberUser.email),
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('NOT_FOUND');
  });

  it('allows viewer with project access to read notes (reconciled Stage 16 read-only role)', async () => {
    // Grant viewer access to this project node
    await sql`
      INSERT INTO node_members (org_id, node_id, user_id)
      VALUES (${testOrg.id}, ${projectNodeId}, ${viewerUser.id})
      ON CONFLICT DO NOTHING
    `;

    const res = await server.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${testOrg.slug}/meetings/${completedMeetingId}/notes`,
      headers: createAuthHeaders(viewerUser.id, viewerUser.email),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.notes).toBeDefined();
    expect(body.notes.summaryMd).toContain('Executive Summary');
  });

  it('allows organization owner to inspect notes (200 OK)', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${testOrg.slug}/meetings/${completedMeetingId}/notes`,
      headers: createAuthHeaders(ownerUser.id, ownerUser.email),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.notes).toBeDefined();
    expect(body.notes.summaryMd).toContain('Stage 15');
  });

  it('allows project member to inspect notes and action items (200 OK + ETag)', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${testOrg.slug}/meetings/${completedMeetingId}/notes`,
      headers: createAuthHeaders(projectMemberUser.id, projectMemberUser.email),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe(formatETag(meetingVersion));

    const body = JSON.parse(res.body);
    expect(body.notes).toBeDefined();
    expect(body.notes.summaryMd).toContain('Executive Summary');
    expect(body.notes.decisions.length).toBe(1);
    expect(body.notes.decisions[0].text).toBe('Use temperature 0.0');
    expect(body.notes.openQuestions.length).toBe(1);

    expect(body.actionItems.length).toBe(1);
    expect(body.actionItems[0].text).toBe('Update documentation with ADR 15');
    expect(body.actionItems[0].ownerName).toBe('Alice Host');
    expect(body.actionItems[0].state).toBe('suggested');
    expect(body.actionItems[0].taskId).toBeNull(); // ZERO tasks created
    expect(body.actionItems[0].evidence.length).toBe(1);
  });

  it('returns 404 for non-existent meeting', async () => {
    const missingId = generateUuidV7();
    const res = await server.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${testOrg.slug}/meetings/${missingId}/notes`,
      headers: createAuthHeaders(ownerUser.id, ownerUser.email),
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('NOT_FOUND');
  });

  it('returns notes: null and empty action items when meeting has not completed extraction', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${testOrg.slug}/meetings/${pendingMeetingId}/notes`,
      headers: createAuthHeaders(projectMemberUser.id, projectMemberUser.email),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.notes).toBeNull();
    expect(body.actionItems).toEqual([]);
  });
});
