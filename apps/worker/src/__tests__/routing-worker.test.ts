import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseConfig, generateUuidV7, type LLMPort, type LLMCompletionRequest, type LLMCompletionResult } from '@workspace/core';
import {
  createWorkerClient,
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  connectZoomIntegration,
  type Sql,
  type DatabaseInstance,
} from '@workspace/db';
import { MockZoomClientAdapter } from '@workspace/adapters';
import { buildWorker, type WorkerInstance } from '../server.js';
import { handleTranscriptIngestedJob } from '../routing-handler.js';

describe('Stage 14: Worker Speaker Resolution & Project Routing Handler', () => {
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
  let devUser: { id: string; email: string };
  let testOrg: { id: string; slug: string };
  let projectId: string;

  const testSuffix = Date.now().toString().slice(-6);
  const ZOOM_ACCOUNT_ID = `zoom_act_worker14_${testSuffix}`;
  const HOST_ZOOM_ID = `zoom_usr_worker14_host_${testSuffix}`;

  beforeAll(async () => {
    worker = buildWorker(testConfig);
    const client = createWorkerClient({
      connectionString: testConfig.DATABASE_DIRECT_URL,
    });
    sql = client.sql;
    db = client.db;
    mockZoomClient = worker.ports.zoomClient as MockZoomClientAdapter;

    // 1. Seed users
    const ownerEmail = `worker14-owner-${testSuffix}@example.com`;
    const devEmail = `worker14-dev-${testSuffix}@example.com`;
    const owner = await findOrCreateUserByEmail(db, {
      email: ownerEmail,
      name: 'Worker14 Owner',
    });
    ownerUser = { id: owner.id, email: owner.email };

    const dev = await findOrCreateUserByEmail(db, {
      email: devEmail,
      name: 'Worker14 Dev',
    });
    devUser = { id: dev.id, email: dev.email };

    // 2. Create organization with owner
    const orgResult = await createOrganizationWithOwner(db, {
      userId: ownerUser.id,
      name: `Worker14 Org ${testSuffix}`,
      slug: `worker14-org-${testSuffix}`,
    });
    testOrg = { id: orgResult.org.id, slug: orgResult.org.slug };

    // Add devUser as member
    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${testOrg.id}, ${devUser.id}, 'member')
    `;

    // 3. Connect Zoom Integration
    const integration = await connectZoomIntegration(sql, worker.ports.secretStore, worker.ports.zoomClient, {
      orgId: testOrg.id,
      userId: ownerUser.id,
      accountId: ZOOM_ACCOUNT_ID,
      accountName: 'Worker14 Test Account',
      accountEmail: ownerUser.email,
      scopes: ['recording:read:admin', 'meeting:read:admin', 'user:read:admin'],
      tokens: {
        access_token: 'test_worker_access_token',
        refresh_token: 'test_worker_refresh_token',
        expires_in: 3600,
        token_type: 'bearer',
        scope: 'recording:read:admin meeting:read:admin user:read:admin',
      },
    });

    // 4. Register host consent
    await sql`
      INSERT INTO zoom_host_consents (
        org_id, integration_id, zoom_user_id, zoom_email, zoom_name, user_id, consent_status, policy_version
      )
      VALUES (
        ${testOrg.id}, ${integration.id}, ${HOST_ZOOM_ID}, ${ownerUser.email}, 'Worker14 Owner', ${ownerUser.id}, 'opted_in', '1.0'
      )
    `;

    // 5. Create project node
    projectId = generateUuidV7();
    await sql`
      INSERT INTO nodes (id, org_id, kind, name, path, visibility, rollup)
      VALUES (${projectId}, ${testOrg.id}, 'project', 'Core Backend', 'proj_backend', 'public', '{}')
    `;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('fences and rejects job if processing generation does not match', async () => {
    const meetingId = generateUuidV7();
    await sql`
      INSERT INTO meetings (
        id, org_id, provider, provider_meeting_uuid, status, processing_generation
      )
      VALUES (
        ${meetingId}, ${testOrg.id}, 'zoom', ${'zm_uuid_' + meetingId.slice(0, 8)},
        'transcript_ready', 5
      )
    `;

    const handled = await handleTranscriptIngestedJob(sql, worker.ports, worker.app.log, {
      orgId: testOrg.id,
      meetingId,
      processingGeneration: 2, // Outdated generation!
    });

    expect(handled).toBe(false);
  });

  it('skips meeting if cost gate fails (duration < 180s)', async () => {
    const meetingId = generateUuidV7();
    const meetingUuid = `short_uuid_${meetingId.slice(0, 8)}`;
    await sql`
      INSERT INTO meetings (
        id, org_id, provider, provider_meeting_uuid, title, duration_seconds, status, processing_generation
      )
      VALUES (
        ${meetingId}, ${testOrg.id}, 'zoom', ${meetingUuid},
        'Quick Sync', 90, 'transcript_ready', 1
      )
    `;

    await sql`
      INSERT INTO transcript_segments (id, org_id, meeting_id, seq, speaker_label, start_ms, end_ms, text)
      VALUES 
        (${generateUuidV7()}, ${testOrg.id}, ${meetingId}, 1, 'Worker14 Owner', 0, 30000, 'Hey quick question'),
        (${generateUuidV7()}, ${testOrg.id}, ${meetingId}, 2, 'Worker14 Dev', 31000, 60000, 'All good here')
    `;

    const handled = await handleTranscriptIngestedJob(sql, worker.ports, worker.app.log, {
      orgId: testOrg.id,
      meetingId,
      processingGeneration: 1,
    });

    expect(handled).toBe(true);

    const [updated] = await sql<Array<{ status: string; skipped: boolean; intake_error: string }>>`
      SELECT status, skipped, intake_error FROM meetings WHERE id = ${meetingId}
    `;
    expect(updated?.status).toBe('skipped');
    expect(updated?.skipped).toBe(true);
    expect(updated?.intake_error).toContain('under the 3-minute minimum threshold');
  });

  it('resolves speakers and automatically routes meeting when LLM confidence is >= 0.70', async () => {
    const meetingId = generateUuidV7();
    const meetingUuid = `auto_route_uuid_${meetingId.slice(0, 8)}`;

    // Configure mock participants for this UUID
    mockZoomClient.mockParticipants.set(meetingUuid, [
      {
        id: 'p_owner',
        name: 'Worker14 Owner',
        user_email: ownerUser.email,
      },
      {
        id: 'p_dev',
        name: 'Worker14 Dev',
        user_email: devUser.email,
      },
    ]);

    await sql`
      INSERT INTO meetings (
        id, org_id, provider, provider_meeting_uuid, title, duration_seconds, status, processing_generation, host_id
      )
      VALUES (
        ${meetingId}, ${testOrg.id}, 'zoom', ${meetingUuid},
        'Backend Refactor Discussion', 600, 'transcript_ready', 1, ${ownerUser.id}
      )
    `;

    await sql`
      INSERT INTO transcript_segments (id, org_id, meeting_id, seq, speaker_label, start_ms, end_ms, text)
      VALUES 
        (${generateUuidV7()}, ${testOrg.id}, ${meetingId}, 1, 'Worker14 Owner', 0, 30000, 'Let us discuss the Core Backend architecture.'),
        (${generateUuidV7()}, ${testOrg.id}, ${meetingId}, 2, 'Worker14 Dev', 31000, 60000, 'The database schemas for Core Backend are ready.')
    `;

    // Configure mock LLM response
    const mockLlm: LLMPort = {
      provider: 'mock',
      async complete<T>(req: LLMCompletionRequest<T>): Promise<LLMCompletionResult<T>> {
        if (req.promptId === 'route.project') {
          const validated = req.schema.parse({
            selectedProjectId: projectId,
            confidence: 0.88,
            explanation: 'Discusses Core Backend architecture',
            alternatives: [],
          });
          return {
            data: validated,
            model: 'mock-model',
            promptVersion: req.promptVersion,
            inputTokens: 50,
            outputTokens: 25,
            costInr: 0.01,
            durationMs: 10,
          };
        }
        return {
          data: {} as T,
          model: 'mock',
          promptVersion: '1.0',
          inputTokens: 0,
          outputTokens: 0,
          costInr: 0,
          durationMs: 0,
        };
      },
      async embed() {
        return { embeddings: [], model: 'mock', inputTokens: 0, costInr: 0 };
      },
      async checkHealth() {
        return { healthy: true };
      },
    };

    const portsWithCustomLlm = {
      ...worker.ports,
      llm: mockLlm,
    };

    const handled = await handleTranscriptIngestedJob(sql, portsWithCustomLlm, worker.app.log, {
      orgId: testOrg.id,
      meetingId,
      processingGeneration: 1,
    });

    expect(handled).toBe(true);

    const [updated] = await sql<Array<{ status: string; node_id: string; speakers_resolved: boolean }>>`
      SELECT status, node_id, speakers_resolved FROM meetings WHERE id = ${meetingId}
    `;
    expect(updated?.status).toBe('routed');
    expect(updated?.node_id).toBe(projectId);
    expect(updated?.speakers_resolved).toBe(true);

    // Verify speakers were resolved
    const segments = await sql<Array<{ speaker_label: string; user_id: string; resolution_method: string }>>`
      SELECT speaker_label, user_id, resolution_method FROM transcript_segments WHERE meeting_id = ${meetingId} ORDER BY seq ASC
    `;
    expect(segments).toHaveLength(2);
    expect(segments[0]!.user_id).toBe(ownerUser.id);
    expect(segments[0]!.resolution_method).toBe('email_verified');
    expect(segments[1]!.user_id).toBe(devUser.id);
    expect(segments[1]!.resolution_method).toBe('email_verified');
  });

  it('enters AskHost (awaiting_project_choice) when LLM confidence is < 0.70', async () => {
    const meetingId = generateUuidV7();
    const meetingUuid = `ask_host_uuid_${meetingId.slice(0, 8)}`;

    mockZoomClient.mockParticipants.set(meetingUuid, [
      { id: 'p_owner', name: 'Worker14 Owner', user_email: ownerUser.email },
      { id: 'p_dev', name: 'Worker14 Dev', user_email: devUser.email },
    ]);

    await sql`
      INSERT INTO meetings (
        id, org_id, provider, provider_meeting_uuid, title, duration_seconds, status, processing_generation, host_id
      )
      VALUES (
        ${meetingId}, ${testOrg.id}, 'zoom', ${meetingUuid},
        'General Cross-Project Discussion', 600, 'transcript_ready', 1, ${ownerUser.id}
      )
    `;

    await sql`
      INSERT INTO transcript_segments (id, org_id, meeting_id, seq, speaker_label, start_ms, end_ms, text)
      VALUES 
        (${generateUuidV7()}, ${testOrg.id}, ${meetingId}, 1, 'Worker14 Owner', 0, 30000, 'General team sync'),
        (${generateUuidV7()}, ${testOrg.id}, ${meetingId}, 2, 'Worker14 Dev', 31000, 60000, 'Nothing specific discussed')
    `;

    const lowConfidenceLlm: LLMPort = {
      provider: 'mock',
      async complete<T>(req: LLMCompletionRequest<T>): Promise<LLMCompletionResult<T>> {
        if (req.promptId === 'route.project') {
          const validated = req.schema.parse({
            selectedProjectId: projectId,
            confidence: 0.55, // Low confidence!
            explanation: 'General conversation with ambiguous project affiliation',
            alternatives: [],
          });
          return {
            data: validated,
            model: 'mock-model',
            promptVersion: req.promptVersion,
            inputTokens: 50,
            outputTokens: 25,
            costInr: 0.01,
            durationMs: 10,
          };
        }
        return { data: {} as T, model: 'mock', promptVersion: '1.0', inputTokens: 0, outputTokens: 0, costInr: 0, durationMs: 0 };
      },
      async embed() {
        return { embeddings: [], model: 'mock', inputTokens: 0, costInr: 0 };
      },
      async checkHealth() {
        return { healthy: true };
      },
    };

    const portsWithCustomLlm = {
      ...worker.ports,
      llm: lowConfidenceLlm,
    };

    const handled = await handleTranscriptIngestedJob(sql, portsWithCustomLlm, worker.app.log, {
      orgId: testOrg.id,
      meetingId,
      processingGeneration: 1,
    });

    expect(handled).toBe(true);

    const [updated] = await sql<Array<{ status: string; node_id: string | null; suggested_node_id: string }>>`
      SELECT status, node_id, suggested_node_id FROM meetings WHERE id = ${meetingId}
    `;
    expect(updated?.status).toBe('awaiting_project_choice');
    expect(updated?.node_id).toBeNull();
    expect(updated?.suggested_node_id).toBe(projectId);
  });
});
