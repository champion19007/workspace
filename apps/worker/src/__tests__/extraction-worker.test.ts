import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parseConfig,
  generateUuidV7,
  type LLMPort,
  type LLMCompletionRequest,
  type LLMCompletionResult,
} from '@workspace/core';
import {
  createWorkerClient,
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  type Sql,
  type DatabaseInstance,
} from '@workspace/db';
import { buildWorker, type WorkerInstance } from '../server.js';
import { handleMeetingRoutedJob } from '../extraction-handler.js';
import type { ExtractionOutput } from '@workspace/prompts';

describe('Stage 15: Worker Notes & Action-Suggestion Extraction Handler', () => {
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

  let ownerUser: { id: string; email: string };
  let testOrg: { id: string; slug: string };
  let projectId: string;
  let meetingId: string;

  const testSuffix = Date.now().toString().slice(-6);

  beforeAll(async () => {
    worker = buildWorker(testConfig);
    const client = createWorkerClient({
      connectionString: testConfig.DATABASE_DIRECT_URL,
    });
    sql = client.sql;
    db = client.db;

    // 1. Seed user
    const ownerEmail = `worker15-owner-${testSuffix}@example.com`;
    const owner = await findOrCreateUserByEmail(db, {
      email: ownerEmail,
      name: 'Worker15 Owner',
    });
    ownerUser = { id: owner.id, email: owner.email };

    // 2. Create organization
    const orgResult = await createOrganizationWithOwner(db, {
      userId: ownerUser.id,
      name: `Worker15 Org ${testSuffix}`,
      slug: `worker15-org-${testSuffix}`,
    });
    testOrg = { id: orgResult.org.id, slug: orgResult.org.slug };

    // 3. Create Project Node
    projectId = generateUuidV7();
    await sql`
      INSERT INTO nodes (id, org_id, kind, name, path, visibility, rollup)
      VALUES (${projectId}, ${testOrg.id}, 'project', 'Core Engine Project', 'core_engine', 'public', '{}')
    `;

    // 4. Create Meeting in 'routed' state
    meetingId = generateUuidV7();
    await sql`
      INSERT INTO meetings (
        id,
        org_id,
        provider,
        provider_meeting_uuid,
        title,
        status,
        node_id,
        host_id,
        processing_generation,
        has_transcript,
        raw_transcript_checksum,
        version
      ) VALUES (
        ${meetingId},
        ${testOrg.id},
        'zoom',
        ${`zm_uuid_${meetingId.slice(0, 8)}`},
        'Sprint 15 Planning & Extraction',
        'routed',
        ${projectId},
        ${ownerUser.id},
        1,
        true,
        'sha256:testchecksum15',
        1
      )
    `;

    // 5. Seed transcript segments
    await sql`
      INSERT INTO transcript_segments (org_id, meeting_id, seq, speaker_label, start_ms, end_ms, text, checksum)
      VALUES
        (${testOrg.id}, ${meetingId}, 1, 'Alice Host', 0, 5000, 'Welcome everyone. Today we plan the database indexing.', 'c1'),
        (${testOrg.id}, ${meetingId}, 2, 'Alice Host', 6000, 12000, 'I will write the database indexing migration by Friday.', 'c2'),
        (${testOrg.id}, ${meetingId}, 3, 'Bob Dev', 13000, 20000, 'Sounds great, and we agreed to use B-tree indexes for all primary keys.', 'c3'),
        (${testOrg.id}, ${meetingId}, 4, 'Charlie QA', 21000, 28000, 'Should we run performance benchmarks against staging first?', 'c4')
    `;
  });

  afterAll(async () => {
    // Clean up test org records
    await sql`DELETE FROM orgs WHERE id = ${testOrg.id}`;
    await sql.end({ timeout: 5 });
  });

  it('fences extraction job by processing generation', async () => {
    // Send mismatched generation (expected: 1, sent: 99)
    const result = await handleMeetingRoutedJob(sql, worker.ports, console, {
      orgId: testOrg.id,
      meetingId,
      nodeId: projectId,
      processingGeneration: 99,
    });

    expect(result).toBe(false);
  });

  it('aborts extraction job if meeting is not routed', async () => {
    const unroutedMeetingId = generateUuidV7();
    await sql`
      INSERT INTO meetings (
        id, org_id, provider, provider_meeting_uuid, title, status, processing_generation, version
      ) VALUES (
        ${unroutedMeetingId}, ${testOrg.id}, 'zoom', ${`uuid_${unroutedMeetingId}`},
        'Unrouted Sync', 'waiting_for_transcript', 1, 1
      )
    `;

    const result = await handleMeetingRoutedJob(sql, worker.ports, console, {
      orgId: testOrg.id,
      meetingId: unroutedMeetingId,
      nodeId: projectId,
      processingGeneration: 1,
    });

    expect(result).toBe(false);
  });

  it('executes end-to-end extraction, validates N-1 evidence, and persists notes & suggestions', async () => {
    // Configure mock LLM to return valid structured extraction
    const mockLlm: LLMPort = {
      provider: 'mock-llm',
      async complete<T>(req: LLMCompletionRequest<T>): Promise<LLMCompletionResult<T>> {
        const mockExtractionData: ExtractionOutput = {
          summary_md: 'Sprint 15 planning focused on database indexing migrations and B-tree key decisions.',
          decisions: [
            {
              text: 'Use B-tree indexes for all primary keys',
              evidence: [{ seq: 3, quote: 'we agreed to use B-tree indexes for all primary keys' }],
            },
          ],
          open_questions: [
            {
              text: 'Should we run performance benchmarks against staging first?',
              evidence: [],
            },
          ],
          action_items: [
            {
              text: 'Write database indexing migration',
              owner_name: 'Alice Host',
              due_phrase: 'by Friday',
              evidence: [{ seq: 2, quote: 'write the database indexing migration by Friday' }],
              confidence: 0.95,
            },
            // Hallucinated quote that must be pruned by Requirement N-1
            {
              text: 'Hallucinated task without valid quote',
              owner_name: 'Nobody',
              due_phrase: null,
              evidence: [{ seq: 2, quote: 'this text does not appear in segment 2 at all' }],
              confidence: 0.85,
            },
          ],
        };

        return {
          data: mockExtractionData as unknown as T,
          model: 'claude-3-7-sonnet-latest',
          promptVersion: req.promptVersion,
          inputTokens: 350,
          outputTokens: 150,
          costInr: 0.25,
          durationMs: 450,
        };
      },
      async embed() {
        return { embeddings: [], model: 'mock', inputTokens: 0, costInr: 0 };
      },
      async checkHealth() {
        return { healthy: true };
      },
    };

    const portsWithMockLlm = {
      ...worker.ports,
      llm: mockLlm,
    };

    const handled = await handleMeetingRoutedJob(sql, portsWithMockLlm, console, {
      orgId: testOrg.id,
      meetingId,
      nodeId: projectId,
      processingGeneration: 1,
    });

    expect(handled).toBe(true);

    // 1. Verify meeting transitioned to 'completed'
    const [mtg] = await sql`SELECT status FROM meetings WHERE id = ${meetingId}`;
    expect(mtg).toBeDefined();
    expect(mtg!.status).toBe('completed');

    // 2. Verify meeting_notes persisted
    const [notes] = await sql`SELECT * FROM meeting_notes WHERE meeting_id = ${meetingId}`;
    expect(notes).toBeDefined();
    expect(notes!.summary_md).toContain('Sprint 15 planning');

    // 3. Verify action_items persisted with Strict N-1 Gate:
    // Only 1 item should survive (the hallucinated one must be dropped)
    const items = await sql`SELECT * FROM action_items WHERE meeting_id = ${meetingId}`;
    expect(items.length).toBe(1);
    expect(items[0]!.text).toBe('Write database indexing migration');
    expect(items[0]!.owner_name).toBe('Alice Host');
    expect(items[0]!.state).toBe('suggested');
    expect(items[0]!.task_id).toBeNull(); // ZERO rows in tasks table

    // 4. Verify extraction_runs updated to completed
    const [run] = await sql`SELECT * FROM extraction_runs WHERE meeting_id = ${meetingId}`;
    expect(run).toBeDefined();
    expect(run!.status).toBe('completed');

    // 5. Verify usage logged in ai_usage_ledger
    const [ledger] = await sql`
      SELECT * FROM ai_usage_ledger
      WHERE meeting_id = ${meetingId} AND operation = 'extract.notes_and_actions'
    `;
    expect(ledger).toBeDefined();
    expect(ledger!.status).toBe('succeeded');
  });

  it('idempotently handles duplicate queue deliveries without duplicating runs or notes', async () => {
    // Redeliver job with same parameters
    const handled = await handleMeetingRoutedJob(sql, worker.ports, console, {
      orgId: testOrg.id,
      meetingId,
      nodeId: projectId,
      processingGeneration: 1,
    });

    expect(handled).toBe(true);

    // Ensure still exactly 1 note and 1 action item
    const notes = await sql`SELECT * FROM meeting_notes WHERE meeting_id = ${meetingId}`;
    const items = await sql`SELECT * FROM action_items WHERE meeting_id = ${meetingId}`;
    expect(notes.length).toBe(1);
    expect(items.length).toBe(1);
  });
});
