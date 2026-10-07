import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import {
  generateUuidV7,
  BudgetExceededError,
} from '@workspace/core';
import {
  normalizeEvidenceQuote,
  estimateTokens,
  validateEvidenceSegments,
  mergeWindowOutputs,
  checkBudgetCapacity,
  recordAiUsageLedgerEntry,
  createOrFindExtractionRun,
  persistMeetingNotesAndSuggestions,
  getMeetingNotesAndSuggestions,
} from '../extraction-operations.js';
import { skipMeetingAndCleanup } from '../transcript-operations.js';
import type { SuggestedActionItem } from '@workspace/prompts';

describe('Stage 15 Database Operations: Extraction & Notes Persistence', () => {
  const directUrl =
    process.env.DATABASE_DIRECT_URL ||
    'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev?sslmode=disable';

  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = postgres(directUrl, { max: 5 });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  describe('Unit Functions: Normalization, Windowing & Merging', () => {
    it('normalizes quotes across punctuation, case, and spacing', () => {
      const q1 = '  "Hello, World!" - Let\'s test this...  ';
      const q2 = 'hello world let s test this';
      expect(normalizeEvidenceQuote(q1)).toBe(q2);
    });

    it('estimates tokens based on text length (~4 chars per token)', () => {
      expect(estimateTokens('1234')).toBe(1);
      expect(estimateTokens('12345678')).toBe(2);
      expect(estimateTokens('')).toBe(1);
    });

    it('validates evidence segments against transcript segments strictly', () => {
      const segmentsBySeq = new Map([
        [1, { text: 'I will finish the backend migration by Friday afternoon.', startMs: 1000, endMs: 5000 }],
        [2, { text: 'Can someone take a look at the PR?', startMs: 6000, endMs: 8000 }],
      ]);

      // 1. Verbatim quote match
      const valid = validateEvidenceSegments(segmentsBySeq, [
        { seq: 1, quote: 'finish the backend migration by Friday afternoon' },
      ]);
      expect(valid.length).toBe(1);
      expect(valid[0]!.seq).toBe(1);
      expect(valid[0]!.startMs).toBe(1000);

      // 2. Hallucinated quote
      const hallucinated = validateEvidenceSegments(segmentsBySeq, [
        { seq: 1, quote: 'write unit tests for frontend component' },
      ]);
      expect(hallucinated.length).toBe(0);

      // 3. Nonexistent sequence number
      const missingSeq = validateEvidenceSegments(segmentsBySeq, [
        { seq: 99, quote: 'finish the backend migration' },
      ]);
      expect(missingSeq.length).toBe(0);
    });

    it('merges multi-window outputs and collapses overlapping duplicates', () => {
      const win1 = {
        summary_md: 'Summary Part 1',
        decisions: [{ text: 'Use PostgreSQL for all transactional data', evidence: [{ seq: 1, quote: 'Use PostgreSQL' }] }],
        open_questions: [{ text: 'Cache invalidation strategy?', evidence: [] }],
        action_items: [
          {
            text: 'Setup database schema migration scripts',
            owner_name: 'Alice',
            due_phrase: 'by Tuesday',
            evidence: [{ seq: 5, quote: 'Setup database schema' }],
            confidence: 0.90,
          },
        ],
      };

      const win2 = {
        summary_md: 'Summary Part 2',
        decisions: [{ text: 'Use PostgreSQL for all transactional data', evidence: [{ seq: 1, quote: 'Use PostgreSQL' }] }],
        open_questions: [{ text: 'Cache invalidation strategy?', evidence: [] }],
        action_items: [
          // Overlap duplicate
          {
            text: 'Setup database schema migration scripts',
            owner_name: 'Alice',
            due_phrase: 'by Tuesday',
            evidence: [{ seq: 5, quote: 'Setup database schema' }],
            confidence: 0.95,
          },
          {
            text: 'Configure Prometheus alerting metrics',
            owner_name: 'Bob',
            due_phrase: 'by Wednesday',
            evidence: [{ seq: 12, quote: 'Configure Prometheus' }],
            confidence: 0.85,
          },
        ],
      };

      const merged = mergeWindowOutputs([win1, win2]);
      expect(merged.action_items.length).toBe(2);
      expect(merged.action_items[0]!.confidence).toBe(0.95);
      expect(merged.decisions.length).toBe(1);
      expect(merged.open_questions.length).toBe(1);
    });
  });

  describe('Database Integration: AI Notes, Suggestions & Document Sync', () => {
    let orgId: string;
    let ownerId: string;
    let nodeId: string;
    let meetingId: string;

    beforeAll(async () => {
      orgId = generateUuidV7();
      ownerId = generateUuidV7();
      nodeId = generateUuidV7();
      meetingId = generateUuidV7();

      const orgSlug = `org-stage15-${orgId.replace(/-/g, '').slice(0, 16)}`;
      const userEmail = `owner.${orgId.replace(/-/g, '')}@test.com`;

      // 1. Create Organization with 5000 INR budget
      await sql`
        INSERT INTO orgs (id, name, slug)
        VALUES (${orgId}, 'Stage 15 Test Org', ${orgSlug})
      `;

      // 2. Create User and Membership
      await sql`
        INSERT INTO users (id, email, name)
        VALUES (${ownerId}, ${userEmail}, 'Test Owner')
      `;
      await sql`
        INSERT INTO memberships (org_id, user_id, role)
        VALUES (${orgId}, ${ownerId}, 'owner')
      `;

      // 3. Create Project Node
      await sql`
        INSERT INTO nodes (id, org_id, kind, name, path, visibility, rollup)
        VALUES (${nodeId}, ${orgId}, 'project', 'Backend Infra Project', 'backend_infra', 'public', '{}')
      `;

      // 4. Create Meeting in 'routed' state
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
          version
        ) VALUES (
          ${meetingId},
          ${orgId},
          'zoom',
          ${`uuid-${meetingId}`},
          'Architecture & Planning Sync',
          'routed',
          ${nodeId},
          ${ownerId},
          1,
          true,
          1
        )
      `;

      // 5. Insert transcript segments
      await sql`
        INSERT INTO transcript_segments (org_id, meeting_id, seq, speaker_label, start_ms, end_ms, text, checksum)
        VALUES
          (${orgId}, ${meetingId}, 1, 'Alice Host', 0, 5000, 'Welcome everyone to the architecture sync.', 'c1'),
          (${orgId}, ${meetingId}, 2, 'Alice Host', 6000, 12000, 'I will write the authentication middleware by Thursday.', 'c2'),
          (${orgId}, ${meetingId}, 3, 'Bob Dev', 13000, 20000, 'I will update the OpenAPI schemas before Monday.', 'c3')
      `;
    });

    afterAll(async () => {
      // Clean up test org records
      await sql`DELETE FROM orgs WHERE id = ${orgId}`;
    });

    it('evaluates budget capacity and enforces spending limits', async () => {
      // Default org has budget 5000 INR
      const cap = await checkBudgetCapacity(sql, orgId, 10.0);
      expect(cap.permitted).toBe(true);
      expect(cap.budgetInr).toBe(5000.0);

      // Record artificial usage in ledger to exceed budget
      await recordAiUsageLedgerEntry(sql, {
        orgId,
        meetingId,
        operation: 'extract.notes_and_actions',
        provider: 'anthropic',
        model: 'claude-3-7-sonnet-latest',
        promptId: 'extract.notes_and_actions',
        promptVersion: 'v1.0.0',
        inputTokens: 1000000,
        outputTokens: 500000,
        costInr: 6000.0,
        estimated: false,
        durationMs: 2500,
        status: 'succeeded',
      });

      // Subsequent check should throw BudgetExceededError
      await expect(checkBudgetCapacity(sql, orgId, 5.0)).rejects.toThrow(BudgetExceededError);

      // Reset ledger entry so subsequent tests proceed
      await sql`DELETE FROM ai_usage_ledger WHERE org_id = ${orgId}`;
    });

    it('creates extraction run and idempotently recognizes completed runs', async () => {
      const res1 = await createOrFindExtractionRun(sql, {
        orgId,
        meetingId,
        nodeId,
        processingGeneration: 1,
        transcriptChecksum: 'checksum-v1',
        promptVersion: 'v1.0.0',
        model: 'claude-3-7-sonnet-latest',
        totalWindows: 1,
      });

      expect(res1.isExistingCompleted).toBe(false);
      expect(res1.run.status).toBe('running');

      // Update run to completed
      await sql`
        UPDATE extraction_runs
        SET status = 'completed', completed_windows = 1, completed_at = now()
        WHERE id = ${res1.run.id}
      `;

      // Second check with same parameters
      const res2 = await createOrFindExtractionRun(sql, {
        orgId,
        meetingId,
        nodeId,
        processingGeneration: 1,
        transcriptChecksum: 'checksum-v1',
        promptVersion: 'v1.0.0',
        model: 'claude-3-7-sonnet-latest',
        totalWindows: 1,
      });

      expect(res2.isExistingCompleted).toBe(true);
      expect(res2.run.id).toBe(res1.run.id);
    });

    it('persists meeting notes, staged action items, doc sync, and enforces Requirement N-1', async () => {
      const runId = generateUuidV7();
      await sql`
        INSERT INTO extraction_runs (
          id, org_id, meeting_id, node_id, run_key, processing_generation,
          transcript_checksum, prompt_version, model, status, total_windows,
          completed_windows, input_tokens, output_tokens, cost_inr, created_at, updated_at
        ) VALUES (
          ${runId}, ${orgId}, ${meetingId}, ${nodeId}, ${`key-${runId}`}, 1,
          'checksum-v1', 'v1.0.0', 'claude-3-7-sonnet-latest', 'running', 1,
          0, 500, 200, 0.5, now(), now()
        )
      `;

      const actionItemsToPersist: SuggestedActionItem[] = [
        {
          text: 'Write authentication middleware',
          owner_name: 'Alice Host',
          due_phrase: 'by Thursday',
          evidence: [{ seq: 2, quote: 'write the authentication middleware by Thursday' }],
          confidence: 0.95,
        },
        // Strict N-1 Gate: This item has 0 evidence segments and MUST be discarded!
        {
          text: 'Fake action item without evidence',
          owner_name: 'Ghost',
          due_phrase: null,
          evidence: [],
          confidence: 0.80,
        },
      ];

      const result = await persistMeetingNotesAndSuggestions(sql, {
        orgId,
        meetingId,
        nodeId,
        processingGeneration: 1,
        extractionRunId: runId,
        summaryMd: 'Sprint architecture and middleware planning overview.',
        decisions: [{ text: 'Adopt custom auth middleware', evidence: [{ seq: 2, quote: 'write the authentication middleware' }] }],
        openQuestions: [{ text: 'Will this affect existing mobile sessions?', evidence: [] }],
        actionItems: actionItemsToPersist,
        model: 'claude-3-7-sonnet-latest',
        promptVersion: 'v1.0.0',
        inputTokens: 500,
        outputTokens: 200,
        costInr: 0.5,
      });

      // 1. Verify MeetingNotes persisted
      expect(result.notes).toBeDefined();
      expect(result.notes.summaryMd).toContain('Sprint architecture');
      expect(result.notes.decisions.length).toBe(1);

      // 2. Verify Strict N-1 Gate: Only 1 action item persisted (the one with evidence)
      expect(result.actionItems.length).toBe(1);
      expect(result.actionItems[0]!.text).toBe('Write authentication middleware');
      expect(result.actionItems[0]!.state).toBe('suggested');
      expect(result.actionItems[0]!.taskId).toBeNull(); // No task row linked yet!
      expect(result.actionItems[0]!.decidedBy).toBeNull();

      // 3. Verify zero rows in tasks table
      const [taskCount] = await sql<Array<{ count: string | number }>>`
        SELECT count(*) as count FROM tasks WHERE org_id = ${orgId}
      `;
      expect(parseInt(String(taskCount?.count || '0'), 10)).toBe(0);

      // 4. Verify Document synchronized in docs table
      expect(result.docId).toBeDefined();
      const [doc] = await sql`SELECT * FROM docs WHERE id = ${result.docId}`;
      expect(doc).toBeDefined();
      expect(doc!.source_meeting_id).toBe(meetingId);
      expect(doc!.node_id).toBe(nodeId);
      expect(doc!.created_by).toBeNull(); // System attribution

      // 5. Verify Meeting state transitioned to 'completed'
      const [mtg] = await sql`SELECT status FROM meetings WHERE id = ${meetingId}`;
      expect(mtg).toBeDefined();
      expect(mtg!.status).toBe('completed');

      // 6. Verify outbox events emitted
      const outboxRows = await sql`
        SELECT topic FROM outbox
        WHERE org_id = ${orgId}
        ORDER BY created_at DESC
        LIMIT 2
      `;
      const topics = outboxRows.map((r) => r.topic);
      expect(topics).toContain('meeting.notes_created');
      expect(topics).toContain('meeting.suggestions_created');

      // 7. Test getMeetingNotesAndSuggestions retrieval
      const fetched = await getMeetingNotesAndSuggestions(sql, orgId, meetingId);
      expect(fetched.notes).not.toBeNull();
      expect(fetched.actionItems.length).toBe(1);
    });

    it('skipMeetingAndCleanup cleans up notes, action items, runs, and linked docs', async () => {
      // Call skip meeting cleanup
      await skipMeetingAndCleanup(sql, {
        orgId,
        meetingId,
        reason: 'User requested purge',
      });

      // Verify meeting is skipped
      const [mtg] = await sql`SELECT status, skipped FROM meetings WHERE id = ${meetingId}`;
      expect(mtg).toBeDefined();
      expect(mtg!.status).toBe('skipped');
      expect(mtg!.skipped).toBe(true);

      // Verify meeting_notes, action_items, extraction_runs are purged
      const [notesCount] = await sql`SELECT count(*) FROM meeting_notes WHERE meeting_id = ${meetingId}`;
      const [actionsCount] = await sql`SELECT count(*) FROM action_items WHERE meeting_id = ${meetingId}`;
      const [runsCount] = await sql`SELECT count(*) FROM extraction_runs WHERE meeting_id = ${meetingId}`;
      const [docsCount] = await sql`SELECT count(*) FROM docs WHERE source_meeting_id = ${meetingId}`;

      expect(notesCount).toBeDefined();
      expect(actionsCount).toBeDefined();
      expect(runsCount).toBeDefined();
      expect(docsCount).toBeDefined();

      expect(parseInt(notesCount!.count, 10)).toBe(0);
      expect(parseInt(actionsCount!.count, 10)).toBe(0);
      expect(parseInt(runsCount!.count, 10)).toBe(0);
      expect(parseInt(docsCount!.count, 10)).toBe(0);
    });
  });
});
