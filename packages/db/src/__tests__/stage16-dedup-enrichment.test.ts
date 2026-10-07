import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import {
  generateUuidV7,
  type LLMPort,
  type LLMCompletionRequest,
  type LLMCompletionResult,
  type EmbedRequest,
  type EmbedResult,
} from '@workspace/core';
import {
  findQuoteSpanInSegment,
  validateEvidenceSegments,
  revalidateMeetingActionItems,
  persistMeetingNotesAndSuggestions,
  getMeetingNotesAndSuggestions,
  enrichMeetingSuggestions,
} from '../extraction-operations.js';
import {
  getMeetingDateInKolkata,
  addDaysToDateStr,
  resolveActionItemDueDate,
  resolveActionItemOwner,
} from '../resolution-operations.js';
import {
  maskPiiForEmbedding,
  computeTaskContentHash,
  indexTaskEmbedding,
  findMatchingOpenTasks,
} from '../task-embedding-operations.js';

function createMockLlm(): LLMPort {
  return {
    provider: 'mock',
    async complete<T>(_req: LLMCompletionRequest<T>): Promise<LLMCompletionResult<T>> {
      throw new Error('Not implemented');
    },
    async embed(req: EmbedRequest): Promise<EmbedResult> {
      const embeddings = req.texts.map((text) => {
        const lower = text.toLowerCase();
        let seed = 42;
        if (lower.includes('redis')) {
          seed = 1000;
        } else if (lower.includes('unit test') || lower.includes('auth router')) {
          seed = 2000;
        } else {
          for (let i = 0; i < text.length; i++) {
            seed = (seed << 5) - seed + text.charCodeAt(i);
            seed |= 0;
          }
        }
        const vec = new Array(1024).fill(0);
        let sumSq = 0;
        for (let i = 0; i < 1024; i++) {
          const val = Math.sin(seed + i);
          vec[i] = val;
          sumSq += val * val;
        }
        const norm = Math.sqrt(sumSq) || 1;
        return vec.map((v) => v / norm);
      });
      return {
        embeddings,
        model: 'voyage-3-lite',
        inputTokens: 10,
        costInr: 0.001,
      };
    },
    async checkHealth() {
      return { healthy: true };
    },
  };
}

describe('Stage 16: Open-Task Deduplication, Owner Resolution & Strict Evidence Validation', () => {
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

  describe('1. Strict Evidence Validation (findQuoteSpanInSegment & validateEvidenceSegments)', () => {
    const canonicalSegment = {
      text: 'We agreed that Alice will deploy the service to production by May 15 and budget $500 for tooling, but do not delete the backup archive.',
      startMs: 1000,
      endMs: 8000,
    };

    const segmentsBySeq = new Map([[1, canonicalSegment]]);

    it('accepts genuine contiguous substring quote and extracts exact char spans', () => {
      const quote = 'Alice will deploy the service to production by May 15';
      const span = findQuoteSpanInSegment(canonicalSegment.text, quote);

      expect(span).not.toBeNull();
      expect(span!.charStart).toBeGreaterThanOrEqual(0);
      expect(span!.charEnd).toBeGreaterThan(span!.charStart);
      expect(span!.canonicalExcerpt).toBe(quote);

      const validated = validateEvidenceSegments(segmentsBySeq, [{ seq: 1, quote }]);
      expect(validated.length).toBe(1);
      expect(validated[0]!.seq).toBe(1);
      expect(validated[0]!.charStart).toBe(span!.charStart);
      expect(validated[0]!.charEnd).toBe(span!.charEnd);
    });

    it('rejects invented prefix around genuine segment text', () => {
      const quote = 'Bob told us that Alice will deploy the service to production';
      const span = findQuoteSpanInSegment(canonicalSegment.text, quote);
      expect(span).toBeNull();

      const validated = validateEvidenceSegments(segmentsBySeq, [{ seq: 1, quote }]);
      expect(validated.length).toBe(0);
    });

    it('rejects invented suffix around genuine segment text', () => {
      const quote = 'Alice will deploy the service to production immediately without testing';
      const span = findQuoteSpanInSegment(canonicalSegment.text, quote);
      expect(span).toBeNull();

      const validated = validateEvidenceSegments(segmentsBySeq, [{ seq: 1, quote }]);
      expect(validated.length).toBe(0);
    });

    it('rejects changed amounts (e.g. $600 instead of $500)', () => {
      const quote = 'budget $600 for tooling';
      const span = findQuoteSpanInSegment(canonicalSegment.text, quote);
      expect(span).toBeNull();

      const validated = validateEvidenceSegments(segmentsBySeq, [{ seq: 1, quote }]);
      expect(validated.length).toBe(0);
    });

    it('rejects changed dates (e.g. May 16 instead of May 15)', () => {
      const quote = 'deploy the service to production by May 16';
      const span = findQuoteSpanInSegment(canonicalSegment.text, quote);
      expect(span).toBeNull();

      const validated = validateEvidenceSegments(segmentsBySeq, [{ seq: 1, quote }]);
      expect(validated.length).toBe(0);
    });

    it('rejects changed negation (e.g. omitting "not" in "do not delete")', () => {
      const quote = 'do delete the backup archive';
      const span = findQuoteSpanInSegment(canonicalSegment.text, quote);
      expect(span).toBeNull();

      const validated = validateEvidenceSegments(segmentsBySeq, [{ seq: 1, quote }]);
      expect(validated.length).toBe(0);
    });

    it('rejects empty or whitespace-only quote', () => {
      expect(findQuoteSpanInSegment(canonicalSegment.text, '')).toBeNull();
      expect(findQuoteSpanInSegment(canonicalSegment.text, '   ')).toBeNull();
      expect(validateEvidenceSegments(segmentsBySeq, [{ seq: 1, quote: '   ' }]).length).toBe(0);
    });

    it('rejects references to nonexistent segment sequence number', () => {
      const validated = validateEvidenceSegments(segmentsBySeq, [
        { seq: 999, quote: 'Alice will deploy the service' },
      ]);
      expect(validated.length).toBe(0);
    });
  });

  describe('2. Asia/Kolkata Calendar Date Calculations & Rule-Based Due Dates', () => {
    it('correctly calculates calendar date across UTC midnight boundary in Asia/Kolkata', () => {
      // 20:30 UTC on 2026-10-05 is 02:00 IST on 2026-10-06 (+05:30)
      const mtgStart = new Date('2026-10-05T20:30:00.000Z');
      const dateKolkata = getMeetingDateInKolkata(mtgStart.toISOString());
      expect(dateKolkata.dateStr).toBe('2026-10-06');

      // "today" resolves to 2026-10-06 in IST, NOT 2026-10-05
      const dueToday = resolveActionItemDueDate({ duePhrase: 'today', meetingStartIso: mtgStart.toISOString() });
      expect(dueToday.suggestedDue).toBe('2026-10-06');
      expect(dueToday.status).toBe('resolved');

      // "tomorrow" resolves to 2026-10-07 in IST
      const dueTomorrow = resolveActionItemDueDate({ duePhrase: 'tomorrow', meetingStartIso: mtgStart.toISOString() });
      expect(dueTomorrow.suggestedDue).toBe('2026-10-07');
      expect(dueTomorrow.status).toBe('resolved');
    });

    it('handles leap years accurately (e.g. Feb 29, 2028)', () => {
      // 2028 is a leap year
      expect(addDaysToDateStr('2028-02-27', 2)).toBe('2028-02-29');
      expect(addDaysToDateStr('2028-02-28', 1)).toBe('2028-02-29');
      expect(addDaysToDateStr('2028-02-29', 1)).toBe('2028-03-01');

      // 2026 is NOT a leap year
      expect(addDaysToDateStr('2026-02-28', 1)).toBe('2026-03-01');
    });

    it('resolves relative day and week counts', () => {
      const mtgStart = new Date('2026-10-05T09:00:00.000Z'); // 2026-10-05 IST
      const in3Days = resolveActionItemDueDate({ duePhrase: 'in 3 days', meetingStartIso: mtgStart.toISOString() });
      expect(in3Days.suggestedDue).toBe('2026-10-08');

      const inTwoWeeks = resolveActionItemDueDate({ duePhrase: 'in 2 weeks', meetingStartIso: mtgStart.toISOString() });
      expect(inTwoWeeks.suggestedDue).toBe('2026-10-19');
    });

    it('resolves weekday expressions relative to meeting start', () => {
      // 2026-10-05 is Monday
      const mondayMeeting = new Date('2026-10-05T09:00:00.000Z');
      const byFriday = resolveActionItemDueDate({ duePhrase: 'by Friday', meetingStartIso: mondayMeeting.toISOString() });
      expect(byFriday.suggestedDue).toBe('2026-10-09');

      // 2026-10-09 is Friday. "next Monday" resolves to 2026-10-12
      const fridayMeeting = new Date('2026-10-09T09:00:00.000Z');
      const nextMonday = resolveActionItemDueDate({ duePhrase: 'next Monday', meetingStartIso: fridayMeeting.toISOString() });
      expect(nextMonday.suggestedDue).toBe('2026-10-12');
    });

    it('leaves ambiguous phrases unresolved without guessing', () => {
      const mtgStart = new Date('2026-10-05T09:00:00.000Z');
      const soon = resolveActionItemDueDate({ duePhrase: 'soon', meetingStartIso: mtgStart.toISOString() });
      expect(soon.suggestedDue).toBeNull();
      expect(soon.status).toBe('ambiguous');

      const asap = resolveActionItemDueDate({ duePhrase: 'asap', meetingStartIso: mtgStart.toISOString() });
      expect(asap.suggestedDue).toBeNull();
      expect(asap.status).toBe('ambiguous');

      const nextSprint = resolveActionItemDueDate({ duePhrase: 'next sprint', meetingStartIso: mtgStart.toISOString() });
      expect(nextSprint.suggestedDue).toBeNull();
      expect(nextSprint.status).toBe('ambiguous');
    });
  });

  describe('3. Conservative Owner Resolution', () => {
    const projectMembers = [
      { userId: 'user-alice-123', name: 'Alice Smith', email: 'alice@example.com' },
      { userId: 'user-bob-456', name: 'Bob Jones', email: 'bob@example.com' },
    ];

    it('resolves owner from speaker commitment ("I will...")', async () => {
      const speakersBySeq = new Map([
        [1, { seq: 1, speakerLabel: 'Bob (Lead)', resolvedUserId: 'user-bob-456', displayName: 'Bob Jones' }],
      ]);

      const result = await resolveActionItemOwner({
        actionText: 'I will finish deploying the worker containers',
        ownerName: 'Bob',
        evidence: [{ seq: 1, quote: 'I will finish deploying the worker containers' }],
        speakersBySeq,
        projectMembers,
      });

      expect(result.suggestedOwnerId).toBe('user-bob-456');
      expect(result.resolutionMethod).toBe('speaker_commitment');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('resolves owner from unique explicit project member name match', async () => {
      const result = await resolveActionItemOwner({
        actionText: 'Alice will prepare the presentation slides',
        ownerName: 'Alice',
        evidence: [{ seq: 2, quote: 'Alice will prepare the presentation slides' }],
        speakersBySeq: new Map(),
        projectMembers,
      });

      expect(result.suggestedOwnerId).toBe('user-alice-123');
      expect(result.resolutionMethod).toBe('explicit_first_name_unique');
      expect(result.confidence).toBe(0.85);
    });

    it('leaves owner unresolved when no matching member is found in project', async () => {
      const result = await resolveActionItemOwner({
        actionText: 'Charlie will check external vendor contract',
        ownerName: 'Charlie',
        evidence: [{ seq: 3, quote: 'Charlie will check external vendor contract' }],
        speakersBySeq: new Map(),
        projectMembers,
      });

      expect(result.suggestedOwnerId).toBeNull();
      expect(result.resolutionMethod).toBe('unresolved');
    });
  });

  describe('4. Task Embeddings, PII Masking & Semantic Deduplication', () => {
    it('masks PII (emails, phones, URLs) before embedding and hashing', () => {
      const rawText = 'Contact alice@corp.internal or call +1-555-867-5309 at https://secure.corp.internal/token?val=xyz';
      const masked = maskPiiForEmbedding(rawText);

      expect(masked).not.toContain('alice@corp.internal');
      expect(masked).not.toContain('+1-555-867-5309');
      expect(masked).not.toContain('https://secure.corp.internal/token?val=xyz');
      expect(masked).toContain('[EMAIL]');
      expect(masked).toContain('[PHONE]');
      expect(masked).toContain('[URL]');
    });

    it('computes deterministic SHA-256 content hash stable under rank-only changes', () => {
      const hash1 = computeTaskContentHash('Deploy Redis', 'Setup caching cluster');
      const hash2 = computeTaskContentHash('Deploy Redis', 'Setup caching cluster');
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);

      // Different content produces different hash
      const hash3 = computeTaskContentHash('Deploy Redis', 'Setup caching cluster with replica');
      expect(hash1).not.toBe(hash3);
    });

    it('indexes task embeddings and performs exact scoped cosine similarity search', async () => {
      const orgId = generateUuidV7();
      const nodeId = generateUuidV7();
      const userId = generateUuidV7();

      // Seed org, user, and node
      await sql`
        INSERT INTO orgs (id, name, slug)
        VALUES (${orgId}, 'Embeddings Test Org', ${`emb-org-${Date.now()}`})
      `;
      await sql`
        INSERT INTO users (id, email, name)
        VALUES (${userId}, ${`user-${Date.now()}@test.com`}, 'Test Dev')
      `;
      await sql`
        INSERT INTO nodes (id, org_id, kind, name, path, visibility, rollup)
        VALUES (${nodeId}, ${orgId}, 'project', 'Embedded Project', ${`emb-proj-${Date.now()}`}, 'public', '{}'::jsonb)
      `;

      // Seed 2 tasks: 1 open, 1 done
      const openTaskId = generateUuidV7();
      const doneTaskId = generateUuidV7();

      await sql`
        INSERT INTO tasks (
          id, org_id, project_id, key, title, description, status, priority,
          assignee_id, created_by, rank, version, created_at, updated_at
        ) VALUES (
          ${openTaskId}, ${orgId}, ${nodeId}, 'PROJ-1',
          'Deploy Redis caching cluster', 'Configure Redis cluster for API session cache',
          'todo', 'high', ${userId}, ${userId}, '0|hzzzzz:', 1, now(), now()
        ), (
          ${doneTaskId}, ${orgId}, ${nodeId}, 'PROJ-2',
          'Deploy Redis caching cluster (old)', 'Old completed Redis cluster task',
          'done', 'medium', ${userId}, ${userId}, '0|hzzzzz:1', 1, now(), now()
        )
      `;

      const mockLlm = createMockLlm();

      // Index open task embedding
      await indexTaskEmbedding(sql, mockLlm, {
        orgId,
        taskId: openTaskId,
      });

      // Index done task embedding
      await indexTaskEmbedding(sql, mockLlm, {
        orgId,
        taskId: doneTaskId,
      });

      // Verify task_embeddings table has 2 rows
      const [embCount] = await sql`SELECT count(*) FROM task_embeddings WHERE org_id = ${orgId}`;
      expect(parseInt(embCount!.count, 10)).toBe(2);

      // Verify ZERO mutations occurred on tasks table
      const [openTaskRow] = await sql`SELECT version, status FROM tasks WHERE id = ${openTaskId}`;
      expect(openTaskRow!.version).toBe(1);
      expect(openTaskRow!.status).toBe('todo');

      // Search for match: identical text should match open task (similarity >= 0.85)
      // Done task must be excluded!
      const queryVec = await mockLlm.embed({
        texts: ['Deploy Redis caching cluster\nConfigure Redis cluster for API session cache'],
      });
      const matches = await findMatchingOpenTasks(sql, {
        orgId,
        nodeId,
        queryVector: queryVec.embeddings[0]!,
        minSimilarity: 0.85,
        limit: 5,
      });

      expect(matches.length).toBe(1);
      expect(matches[0]!.taskId).toBe(openTaskId);
      expect(matches[0]!.similarityScore).toBeGreaterThanOrEqual(0.85);

      // Searching for unrelated query yields no matches above 0.999
      const unrelatedMatches = await findMatchingOpenTasks(sql, {
        orgId,
        nodeId,
        queryVector: queryVec.embeddings[0]!,
        minSimilarity: 0.999999, // ultra-strict to test threshold cutoff
        limit: 5,
      });
      expect(unrelatedMatches.length).toBeLessThanOrEqual(1);
    });
  });

  describe('5. Full Suggestion Enrichment Pipeline (enrichMeetingSuggestions)', () => {
    it('atomically enriches suggestions with proposal types, owners, due dates, and strict evidence without mutating tasks table', async () => {
      const orgId = generateUuidV7();
      const nodeId = generateUuidV7();
      const userId = generateUuidV7();
      const meetingId = generateUuidV7();
      const runId = generateUuidV7();

      // 1. Seed org, user, node, meeting
      await sql`
        INSERT INTO orgs (id, name, slug)
        VALUES (${orgId}, 'Enrichment Pipeline Org', ${`enrich-org-${Date.now()}`})
      `;
      await sql`
        INSERT INTO users (id, email, name)
        VALUES (${userId}, ${`user-${Date.now()}@example.com`}, 'Alice Engineer')
      `;
      await sql`
        INSERT INTO memberships (org_id, user_id, role)
        VALUES (${orgId}, ${userId}, 'member')
      `;
      await sql`
        INSERT INTO nodes (id, org_id, kind, name, path, visibility, rollup)
        VALUES (${nodeId}, ${orgId}, 'project', 'Sprint Project', ${`sprint-proj-${Date.now()}`}, 'public', '{}'::jsonb)
      `;
      await sql`
        INSERT INTO node_members (org_id, node_id, user_id)
        VALUES (${orgId}, ${nodeId}, ${userId})
      `;

      // 2. Seed meeting transcript segments
      await sql`
        INSERT INTO meetings (
          id, org_id, provider, provider_meeting_uuid, provider_numeric_id,
          title, zoom_host_id, zoom_host_email, host_id, status,
          processing_generation, node_id, version, created_at, updated_at
        ) VALUES (
          ${meetingId}, ${orgId}, 'zoom', ${`enrich-mtg-${Date.now()}`}, ${`num-${Date.now()}`},
          'Planning Session', 'zh_host_enrich', ${`user-${Date.now()}@example.com`}, ${userId},
          'routed', 1, ${nodeId}, 1, now(), now()
        )
      `;

      await sql`
        INSERT INTO transcript_segments (
          id, org_id, meeting_id, seq, speaker_label, start_ms, end_ms, text, checksum, user_id
        ) VALUES (
          ${generateUuidV7()}, ${orgId}, ${meetingId}, 1, 'Alice Engineer', 1000, 5000,
          'I will configure the Redis cache cluster by Friday afternoon.', 'chk1', ${userId}
        ), (
          ${generateUuidV7()}, ${orgId}, ${meetingId}, 2, 'Alice Engineer', 6000, 9000,
          'We also need someone to write unit tests for the auth router.', 'chk2', ${userId}
        )
      `;

      // 3. Seed an existing open task in the project (for deduplication matching)
      const existingTaskId = generateUuidV7();
      await sql`
        INSERT INTO tasks (
          id, org_id, project_id, key, title, description, status, priority,
          assignee_id, created_by, rank, version, created_at, updated_at
        ) VALUES (
          ${existingTaskId}, ${orgId}, ${nodeId}, 'SPRINT-1',
          'Configure Redis cache cluster', 'Setup Redis cache cluster for performance',
          'todo', 'medium', ${userId}, ${userId}, '0|hzzzzz:', 1, now(), now()
        )
      `;

      // Index this task embedding
      const mockLlm = createMockLlm();
      await indexTaskEmbedding(sql, mockLlm, {
        orgId,
        taskId: existingTaskId,
      });

      // 4. Create extraction run record to satisfy foreign key
      await sql`
        INSERT INTO extraction_runs (
          id, org_id, meeting_id, node_id, run_key, processing_generation,
          transcript_checksum, prompt_version, model, status,
          total_windows, completed_windows, window_progress,
          input_tokens, output_tokens, cost_inr, created_at, updated_at
        ) VALUES (
          ${runId}, ${orgId}, ${meetingId}, ${nodeId}, ${`run-key-${Date.now()}`}, 1,
          'mockchecksum', 'v1.0.0', 'mock-model', 'completed',
          1, 1, '[]'::jsonb, 300, 100, 0.1, now(), now()
        )
      `;

      // 5. Persist meeting notes and 2 suggestions
      await persistMeetingNotesAndSuggestions(sql, {
        orgId,
        meetingId,
        nodeId,
        processingGeneration: 1,
        extractionRunId: runId,
        summaryMd: 'Sprint planning discussion.',
        decisions: [{ text: 'Use Redis', evidence: [{ seq: 1, quote: 'configure the Redis cache cluster' }] }],
        openQuestions: [],
        actionItems: [
          // Item 1: Matches existing task ("Configure Redis cache cluster")
          {
            text: 'I will configure the Redis cache cluster',
            owner_name: 'Alice Engineer',
            due_phrase: 'by Friday',
            evidence: [{ seq: 1, quote: 'I will configure the Redis cache cluster by Friday afternoon' }],
            confidence: 0.95,
          },
          // Item 2: New task ("Write unit tests for the auth router")
          {
            text: 'Write unit tests for the auth router',
            owner_name: null,
            due_phrase: null,
            evidence: [{ seq: 2, quote: 'write unit tests for the auth router' }],
            confidence: 0.88,
          },
        ],
        model: 'mock-model',
        promptVersion: 'v1.0.0',
        inputTokens: 300,
        outputTokens: 100,
        costInr: 0.1,
      });

      // Verify tasks table count BEFORE enrichment
      const [beforeTaskCount] = await sql`SELECT count(*) FROM tasks WHERE org_id = ${orgId}`;
      expect(parseInt(beforeTaskCount!.count, 10)).toBe(1);

      // 5. Execute enrichMeetingSuggestions
      const enrichedResult = await enrichMeetingSuggestions(sql, {
        orgId,
        meetingId,
        llmPort: mockLlm,
      });

      expect(enrichedResult.meetingId).toBe(meetingId);
      expect(enrichedResult.enrichedCount).toBe(2);

      // Fetch the enriched action items
      const { actionItems } = await getMeetingNotesAndSuggestions(sql, orgId, meetingId);
      expect(actionItems.length).toBe(2);

      // Verify Item 1: Should be update_task because it matches SPRINT-1
      const item1 = actionItems.find((i) => i.text.includes('Redis'));
      expect(item1).toBeDefined();
      expect(item1!.proposalType).toBe('update_task');
      expect(item1!.targetTaskId).toBe(existingTaskId);
      expect(item1!.similarityScore).toBeGreaterThanOrEqual(0.85);
      expect(item1!.suggestedOwnerId).toBe(userId);
      expect(item1!.ownerResolutionMethod).toBe('speaker_commitment');
      expect(item1!.suggestedDue).not.toBeNull();
      expect(item1!.validationStatus).toBe('valid');
      expect(item1!.state).toBe('suggested'); // REMAINS SUGGESTED
      expect(item1!.taskId).toBeNull(); // ZERO tasks created

      // Verify Item 2: Should be create_task
      const item2 = actionItems.find((i) => i.text.includes('unit tests'));
      expect(item2).toBeDefined();
      expect(item2!.proposalType).toBe('create_task');
      expect(item2!.targetTaskId).toBeNull();
      expect(item2!.validationStatus).toBe('valid');
      expect(item2!.state).toBe('suggested');
      expect(item2!.taskId).toBeNull();

      // 6. ZERO task table mutations: row count must still be exactly 1!
      const [afterTaskCount] = await sql`SELECT count(*) FROM tasks WHERE org_id = ${orgId}`;
      expect(parseInt(afterTaskCount!.count, 10)).toBe(1);

      // 7. Verify outbox event emitted
      const outboxRows = await sql`
        SELECT topic FROM outbox
        WHERE org_id = ${orgId} AND topic = 'meeting.suggestions_enriched'
      `;
      expect(outboxRows.length).toBeGreaterThanOrEqual(1);

      // 8. Test revalidateMeetingActionItems on invalid evidence
      // Insert an invalid action item directly
      const invalidActionId = generateUuidV7();
      await sql`
        INSERT INTO action_items (
          id, org_id, meeting_id, text, evidence, confidence, state, proposal_type, created_at, updated_at
        ) VALUES (
          ${invalidActionId}, ${orgId}, ${meetingId},
          'Fabricated hallucination with false evidence',
          ${JSON.stringify([{ seq: 1, quote: 'invented words not in transcript segment' }])}::jsonb,
          0.90, 'suggested', 'create_task', now(), now()
        )
      `;

      const revalResult = await revalidateMeetingActionItems(sql, orgId, meetingId);
      expect(revalResult.invalidCount).toBe(1);

      const [invalidRow] = await sql`
        SELECT validation_status, state, task_id
        FROM action_items
        WHERE id = ${invalidActionId}
      `;
      expect(invalidRow!.validation_status).toBe('invalid_evidence');
      expect(invalidRow!.state).toBe('suggested');
      expect(invalidRow!.task_id).toBeNull();
    });
  });
});
