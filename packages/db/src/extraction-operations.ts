import crypto from 'node:crypto';
import type postgres from 'postgres';
import {
  generateUuidV7,
  NotFoundError,
  ValidationError,
  ConflictError,
  BudgetExceededError,
  type EvidenceSegmentDTO,
  type DecisionDTO,
  type OpenQuestionDTO,
  type ActionItemDTO,
  type MeetingNotesDTO,
  type ExtractionRunDTO,
  type RankedAlternativeDTO,
  type LLMPort,
} from '@workspace/core';
import type { DbOrSql } from './node-operations.js';
import { insertOutboxEvent } from './outbox-operations.js';
import { listMeetingActionItems, type ActionItemViewer } from './approval-operations.js';
import {
  maskPiiForEmbedding,
  ensureProjectTaskEmbeddings,
  findMatchingOpenTasks,
  DEFAULT_EMBEDDING_SPACE,
  TASK_DEDUP_SIMILARITY_THRESHOLD,
} from './task-embedding-operations.js';
import {
  resolveActionItemOwner,
  resolveActionItemDueDate,
  type SpeakerContext,
  type ProjectMemberCandidate,
} from './resolution-operations.js';
import type {
  ExtractionOutput,
  SuggestedActionItem,
  Decision,
  OpenQuestion,
  EvidenceSegment,
} from '@workspace/prompts';

function getSql(target: DbOrSql): postgres.Sql {
  if (target && typeof target === 'object' && '$client' in target) {
    return (target as any).$client as postgres.Sql;
  }
  return target as postgres.Sql;
}

export interface TranscriptSegmentItem {
  seq: number;
  speakerLabel?: string | null;
  startMs: number;
  endMs: number;
  text: string;
}

export interface ExtractionWindow {
  windowIndex: number;
  totalWindows: number;
  startMs: number;
  endMs: number;
  segments: TranscriptSegmentItem[];
  estimatedTokens: number;
}

export function parseJsonArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Normalizes text for robust evidence quote substring comparison.
 * Strips punctuation, collapses whitespace, and lowercases.
 */
export function normalizeEvidenceQuote(str: string): string {
  return str
    .toLowerCase()
    .replace(/['".,!?;:()[\]{}—–\-_/\\<>@#$%^&*`~+=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type ActionItemLike = { text: string; evidence: Array<{ seq: number }> };

/** Same commitment: identical normalised text, or a shared evidence cue with >= 50% token overlap. */
function isSameActionItem(a: ActionItemLike, b: ActionItemLike): boolean {
  const normA = normalizeEvidenceQuote(a.text);
  const normB = normalizeEvidenceQuote(b.text);
  if (normA === normB) return true;
  const seqsA = new Set(a.evidence.map((e) => e.seq));
  if (!b.evidence.some((e) => seqsA.has(e.seq))) return false;
  const wordsA = new Set(normA.split(/\s+/));
  const wordsB = normB.split(/\s+/);
  const overlap = wordsB.filter((w) => wordsA.has(w)).length;
  return overlap / Math.max(wordsA.size, wordsB.length) >= 0.5;
}

/**
 * Estimates token count for raw text (roughly 4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Splits transcript segments into token-aware windows:
 * - Single window if total tokens <= 30,000.
 * - 20-minute windows with 2-minute overlap if > 30,000 tokens.
 * - Sub-splits dense windows if any 20-min window exceeds 25,000 tokens.
 * - Global segment sequence numbers (`seq`) are strictly preserved.
 */
export function buildExtractionWindows(segments: TranscriptSegmentItem[]): ExtractionWindow[] {
  if (segments.length === 0) {
    return [];
  }

  const totalText = segments.map((s) => s.text).join(' ');
  const totalEstimatedTokens = estimateTokens(totalText);

  // If under or equal to 30,000 tokens, process in a single unified window
  if (totalEstimatedTokens <= 30_000) {
    return [
      {
        windowIndex: 0,
        totalWindows: 1,
        startMs: segments[0]!.startMs,
        endMs: segments[segments.length - 1]!.endMs,
        segments,
        estimatedTokens: totalEstimatedTokens,
      },
    ];
  }

  // Multi-window: 20 minutes (1,200,000 ms) with 2 minutes overlap (120,000 ms)
  const windowDurationMs = 20 * 60 * 1000;
  const overlapMs = 2 * 60 * 1000;
  const stepMs = windowDurationMs - overlapMs; // 18 minutes

  const meetingStartMs = segments[0]!.startMs;
  const meetingEndMs = segments[segments.length - 1]!.endMs;

  const rawWindows: Array<{ startMs: number; endMs: number; segments: TranscriptSegmentItem[]; tokens: number }> = [];

  let currentStartMs = meetingStartMs;
  while (currentStartMs <= meetingEndMs) {
    const currentEndMs = currentStartMs + windowDurationMs;
    const windowSegments = segments.filter(
      (s) => s.startMs < currentEndMs && s.endMs > currentStartMs
    );

    if (windowSegments.length > 0) {
      const windowTokens = estimateTokens(windowSegments.map((s) => s.text).join(' '));
      // Dense window sub-split: if window exceeds 25,000 tokens, divide in half with 1-min overlap
      if (windowTokens > 25_000) {
        const halfDuration = windowDurationMs / 2;
        const subOverlap = 60 * 1000;
        const midPoint = currentStartMs + halfDuration;

        const sub1Segments = segments.filter(
          (s) => s.startMs < midPoint + subOverlap && s.endMs > currentStartMs
        );
        const sub2Segments = segments.filter(
          (s) => s.startMs < currentEndMs && s.endMs > midPoint - subOverlap
        );

        if (sub1Segments.length > 0) {
          rawWindows.push({
            startMs: currentStartMs,
            endMs: midPoint + subOverlap,
            segments: sub1Segments,
            tokens: estimateTokens(sub1Segments.map((s) => s.text).join(' ')),
          });
        }
        if (sub2Segments.length > 0) {
          rawWindows.push({
            startMs: midPoint - subOverlap,
            endMs: currentEndMs,
            segments: sub2Segments,
            tokens: estimateTokens(sub2Segments.map((s) => s.text).join(' ')),
          });
        }
      } else {
        rawWindows.push({
          startMs: currentStartMs,
          endMs: currentEndMs,
          segments: windowSegments,
          tokens: windowTokens,
        });
      }
    }

    if (currentEndMs >= meetingEndMs) {
      break;
    }
    currentStartMs += stepMs;
  }

  const totalWindows = rawWindows.length;
  return rawWindows.map((rw, index) => ({
    windowIndex: index,
    totalWindows,
    startMs: rw.startMs,
    endMs: rw.endMs,
    segments: rw.segments,
    estimatedTokens: rw.tokens,
  }));
}

export interface EvidenceSpanResult {
  charStart: number;
  charEnd: number;
  canonicalExcerpt: string;
}

/**
 * Searches for a quote inside a canonical segment text.
 * Strictly requires the quote to appear as a contiguous substring or contiguous token sequence
 * within the canonical segment under narrow normalization (preserving numbers, dates, negation words,
 * and punctuation).
 * Returns null if the quote does not appear contiguously within the segment, preventing
 * fabricated quotes with invented prefixes or suffixes or altered negation/dates/amounts.
 */
export function findQuoteSpanInSegment(
  segmentText: string,
  quote: string
): EvidenceSpanResult | null {
  const trimmedQuote = quote.trim();
  if (!trimmedQuote || trimmedQuote.length < 2) {
    return null;
  }

  // 1. Direct case-insensitive substring match
  const lowerSeg = segmentText.toLowerCase();
  const lowerQuote = trimmedQuote.toLowerCase();
  const directIdx = lowerSeg.indexOf(lowerQuote);
  if (directIdx !== -1) {
    const endIdx = directIdx + trimmedQuote.length;
    return {
      charStart: directIdx,
      charEnd: endIdx,
      canonicalExcerpt: segmentText.slice(directIdx, endIdx),
    };
  }

  // 2. Token-based contiguous subarray match with character span preservation
  // Token pattern preserves words, numbers, currency symbols, and hyphenated/contracted words
  const tokenRegex = /[A-Za-z0-9$%€£]+(?:['’-][A-Za-z0-9]+)*/g;
  const segTokens: Array<{ raw: string; normalized: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(segmentText)) !== null) {
    segTokens.push({
      raw: m[0],
      normalized: m[0].toLowerCase(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  const quoteTokens: string[] = [];
  while ((m = tokenRegex.exec(trimmedQuote)) !== null) {
    quoteTokens.push(m[0].toLowerCase());
  }

  // Must have at least 1 token, and quote cannot have more tokens than the segment itself
  if (quoteTokens.length === 0 || quoteTokens.length > segTokens.length) {
    return null;
  }

  // Search for contiguous subarray
  for (let i = 0; i <= segTokens.length - quoteTokens.length; i++) {
    let allMatch = true;
    for (let j = 0; j < quoteTokens.length; j++) {
      if (segTokens[i + j]!.normalized !== quoteTokens[j]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      const startChar = segTokens[i]!.start;
      const endChar = segTokens[i + quoteTokens.length - 1]!.end;
      return {
        charStart: startChar,
        charEnd: endChar,
        canonicalExcerpt: segmentText.slice(startChar, endChar),
      };
    }
  }

  return null;
}

/**
 * Validates a list of raw evidence segments against the actual transcript segments.
 * Strictly verifies seq existence, contiguous quote match within the canonical segment,
 * and extracts character spans and canonical excerpts.
 */
export function validateEvidenceSegments(
  segmentsBySeq: Map<number, { text: string; startMs: number; endMs: number }>,
  rawEvidence: Array<{ seq: number; quote: string }>
): EvidenceSegmentDTO[] {
  const valid: EvidenceSegmentDTO[] = [];
  const seenSeqs = new Set<number>();

  for (const ev of rawEvidence) {
    if (seenSeqs.has(ev.seq)) continue;

    const segment = segmentsBySeq.get(ev.seq);
    if (!segment) {
      // Invalid: sequence number does not exist
      continue;
    }

    const span = findQuoteSpanInSegment(segment.text, ev.quote);
    if (!span) {
      // Rejected: quote must occur contiguously within the canonical segment
      continue;
    }

    seenSeqs.add(ev.seq);
    valid.push({
      seq: ev.seq,
      quote: ev.quote.trim(),
      startMs: segment.startMs,
      endMs: segment.endMs,
      canonicalExcerpt: span.canonicalExcerpt,
      charStart: span.charStart,
      charEnd: span.charEnd,
    });
  }

  return valid;
}

/**
 * Merges extraction outputs from multiple windows.
 * Collapses duplicate suggestions from the overlap window, unions valid evidence,
 * and preserves uncertainty for conflicting spoken owners or dates.
 */
export function mergeWindowOutputs(outputs: ExtractionOutput[]): ExtractionOutput {
  if (outputs.length === 0) {
    return {
      summary_md: '',
      decisions: [],
      open_questions: [],
      action_items: [],
    };
  }

  if (outputs.length === 1) {
    return outputs[0]!;
  }

  // Combine summaries
  const summaries = outputs
    .map((o, idx) => `### Part ${idx + 1}\n${o.summary_md.trim()}`)
    .filter(Boolean)
    .join('\n\n');

  // Deduplicate decisions
  const decisionsMap = new Map<string, { text: string; evidence: EvidenceSegment[] }>();
  for (const out of outputs) {
    for (const dec of out.decisions) {
      const key = normalizeEvidenceQuote(dec.text);
      if (!key) continue;
      const decEvidence: EvidenceSegment[] = Array.isArray(dec.evidence) ? dec.evidence : [];
      if (!decisionsMap.has(key)) {
        decisionsMap.set(key, { text: dec.text, evidence: [...decEvidence] });
      } else {
        const existing = decisionsMap.get(key)!;
        const existingSeqs = new Set(existing.evidence.map((e) => e.seq));
        for (const ev of decEvidence) {
          if (!existingSeqs.has(ev.seq)) {
            existing.evidence.push(ev);
            existingSeqs.add(ev.seq);
          }
        }
      }
    }
  }

  // Deduplicate open questions
  const questionsMap = new Map<string, { text: string; evidence: EvidenceSegment[] }>();
  for (const out of outputs) {
    for (const q of out.open_questions) {
      const key = normalizeEvidenceQuote(q.text);
      if (!key) continue;
      const qEvidence: EvidenceSegment[] = Array.isArray(q.evidence) ? q.evidence : [];
      if (!questionsMap.has(key)) {
        questionsMap.set(key, { text: q.text, evidence: [...qEvidence] });
      }
    }
  }

  // Deduplicate and merge action items
  const mergedActionItems: SuggestedActionItem[] = [];

  for (const out of outputs) {
    for (const item of out.action_items) {
      // Check if existing merged item is a match (high text similarity or shared evidence seq)
      const existingMatch = mergedActionItems.find((existing) => isSameActionItem(item, existing));

      if (!existingMatch) {
        mergedActionItems.push({
          text: item.text,
          owner_name: item.owner_name ?? null,
          due_phrase: item.due_phrase ?? null,
          evidence: [...item.evidence],
          confidence: item.confidence,
        });
      } else {
        // Union evidence
        const existingSeqs = new Set(existingMatch.evidence.map((e) => e.seq));
        for (const ev of item.evidence) {
          if (!existingSeqs.has(ev.seq)) {
            existingMatch.evidence.push(ev);
            existingSeqs.add(ev.seq);
          }
        }

        // Preserve uncertainty for conflicting owner or due phrase
        if (
          existingMatch.owner_name &&
          item.owner_name &&
          existingMatch.owner_name.toLowerCase() !== item.owner_name.toLowerCase()
        ) {
          // Conflicting spoken owners: preserve uncertainty
          existingMatch.owner_name = null;
        } else if (!existingMatch.owner_name && item.owner_name) {
          existingMatch.owner_name = item.owner_name;
        }

        if (
          existingMatch.due_phrase &&
          item.due_phrase &&
          existingMatch.due_phrase.toLowerCase() !== item.due_phrase.toLowerCase()
        ) {
          // Conflicting due dates: preserve uncertainty
          existingMatch.due_phrase = null;
        } else if (!existingMatch.due_phrase && item.due_phrase) {
          existingMatch.due_phrase = item.due_phrase;
        }

        existingMatch.confidence = Math.max(existingMatch.confidence, item.confidence);
      }
    }
  }

  return {
    summary_md: summaries,
    decisions: Array.from(decisionsMap.values()),
    open_questions: Array.from(questionsMap.values()),
    action_items: mergedActionItems,
  };
}

/**
 * Checks organization budget capacity before making LLM calls.
 * Throws BudgetExceededError if monthly consumption + estimated cost exceeds quota.
 */
export async function checkBudgetCapacity(
  db: DbOrSql,
  orgId: string,
  estimatedCostInr: number
): Promise<{ permitted: boolean; budgetInr: number; usedInr: number; remainingInr: number }> {
  const sql = getSql(db);

  // 1. Fetch organization budget limit (default 5,000 INR if not set)
  const [org] = await sql`
    SELECT id, ai_budget_inr
    FROM orgs
    WHERE id = ${orgId}
  `;

  if (!org) {
    throw new NotFoundError(`Organization with ID ${orgId} not found`);
  }

  const budgetInr = org.ai_budget_inr ? Number(org.ai_budget_inr) : 5000.0;

  // 2. Query current calendar month AI usage
  const [usage] = await sql`
    SELECT COALESCE(SUM(cost_inr), 0) as total_used
    FROM ai_usage_ledger
    WHERE org_id = ${orgId}
      AND created_at >= date_trunc('month', now())
      AND status = 'succeeded'
  `;

  const usedInr = usage ? Number(usage.total_used) : 0;
  const remainingInr = Math.max(0, budgetInr - usedInr);

  if (usedInr + estimatedCostInr > budgetInr) {
    throw new BudgetExceededError(
      `AI budget exceeded for organization. Monthly Budget: ${budgetInr} INR, Current month usage: ${usedInr.toFixed(2)} INR, Estimated call cost: ${estimatedCostInr.toFixed(2)} INR`,
      { orgId, budgetInr, usedInr, estimatedCostInr }
    );
  }

  return {
    permitted: true,
    budgetInr,
    usedInr,
    remainingInr,
  };
}

/**
 * Records an entry into the ai_usage_ledger table.
 */
export async function recordAiUsageLedgerEntry(
  db: DbOrSql,
  entry: {
    orgId: string;
    meetingId?: string | null;
    extractionRunId?: string | null;
    operation: string;
    provider: string;
    model: string;
    promptId: string;
    promptVersion: string;
    inputTokens: number;
    outputTokens: number;
    costInr: number;
    estimated: boolean;
    durationMs: number;
    status: 'succeeded' | 'failed' | 'refused';
    errorMessage?: string | null;
  }
): Promise<void> {
  const sql = getSql(db);
  const id = generateUuidV7();

  await sql`
    INSERT INTO ai_usage_ledger (
      id,
      org_id,
      meeting_id,
      extraction_run_id,
      operation,
      provider,
      model,
      prompt_id,
      prompt_version,
      input_tokens,
      output_tokens,
      cost_inr,
      estimated,
      duration_ms,
      status,
      error_message,
      created_at
    ) VALUES (
      ${id},
      ${entry.orgId},
      ${entry.meetingId || null},
      ${entry.extractionRunId || null},
      ${entry.operation},
      ${entry.provider},
      ${entry.model},
      ${entry.promptId},
      ${entry.promptVersion},
      ${entry.inputTokens},
      ${entry.outputTokens},
      ${entry.costInr},
      ${entry.estimated},
      ${entry.durationMs},
      ${entry.status},
      ${entry.errorMessage || null},
      now()
    )
  `;
}

/**
 * Generates a deterministic run key to prevent duplicate runs from queue redeliveries.
 */
export function generateExtractionRunKey(params: {
  meetingId: string;
  transcriptChecksum: string;
  nodeId: string;
  processingGeneration: number;
  promptVersion: string;
}): string {
  const raw = `${params.meetingId}:${params.transcriptChecksum}:${params.nodeId}:${params.processingGeneration}:${params.promptVersion}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function toIso(val: any): string {
  if (!val) return '';
  return new Date(val).toISOString();
}

function toIsoOrNull(val: any): string | null {
  if (!val) return null;
  return new Date(val).toISOString();
}

/**
 * Creates or retrieves an extraction run record.
 * Returns isExistingCompleted = true if a completed run for the same key already exists.
 */
export async function createOrFindExtractionRun(
  db: DbOrSql,
  params: {
    orgId: string;
    meetingId: string;
    nodeId: string;
    processingGeneration: number;
    transcriptChecksum: string;
    promptVersion: string;
    model: string;
    totalWindows: number;
  }
): Promise<{ run: ExtractionRunDTO; isExistingCompleted: boolean }> {
  const sql = getSql(db);
  const runKey = generateExtractionRunKey(params);

  const [existing] = await sql<any[]>`
    SELECT *
    FROM extraction_runs
    WHERE org_id = ${params.orgId}
      AND meeting_id = ${params.meetingId}
      AND run_key = ${runKey}
  `;

  if (existing) {
    const isCompleted = existing.status === 'completed';
    return {
      run: {
        id: existing.id,
        orgId: existing.org_id,
        meetingId: existing.meeting_id,
        nodeId: existing.node_id,
        runKey: existing.run_key,
        processingGeneration: existing.processing_generation,
        transcriptChecksum: existing.transcript_checksum,
        promptVersion: existing.prompt_version,
        model: existing.model,
        status: existing.status,
        totalWindows: existing.total_windows,
        completedWindows: existing.completed_windows,
        windowProgress: existing.window_progress || [],
        inputTokens: existing.input_tokens,
        outputTokens: existing.output_tokens,
        costInr: Number(existing.cost_inr),
        errorMessage: existing.error_message,
        startedAt: toIsoOrNull(existing.started_at),
        completedAt: toIsoOrNull(existing.completed_at),
        createdAt: toIso(existing.created_at),
        updatedAt: toIso(existing.updated_at),
      },
      isExistingCompleted: isCompleted,
    };
  }

  const runId = generateUuidV7();
  const [created] = await sql<any[]>`
    INSERT INTO extraction_runs (
      id,
      org_id,
      meeting_id,
      node_id,
      run_key,
      processing_generation,
      transcript_checksum,
      prompt_version,
      model,
      status,
      total_windows,
      completed_windows,
      window_progress,
      input_tokens,
      output_tokens,
      cost_inr,
      started_at,
      created_at,
      updated_at
    ) VALUES (
      ${runId},
      ${params.orgId},
      ${params.meetingId},
      ${params.nodeId},
      ${runKey},
      ${params.processingGeneration},
      ${params.transcriptChecksum},
      ${params.promptVersion},
      ${params.model},
      'running',
      ${params.totalWindows},
      0,
      ${JSON.stringify([])}::jsonb,
      0,
      0,
      0,
      now(),
      now(),
      now()
    )
    RETURNING *
  `;

  return {
    run: {
      id: created.id,
      orgId: created.org_id,
      meetingId: created.meeting_id,
      nodeId: created.node_id,
      runKey: created.run_key,
      processingGeneration: created.processing_generation,
      transcriptChecksum: created.transcript_checksum,
      promptVersion: created.prompt_version,
      model: created.model,
      status: created.status,
      totalWindows: created.total_windows,
      completedWindows: created.completed_windows,
      windowProgress: [],
      inputTokens: created.input_tokens,
      outputTokens: created.output_tokens,
      costInr: Number(created.cost_inr),
      errorMessage: null,
      startedAt: toIsoOrNull(created.started_at),
      completedAt: null,
      createdAt: toIso(created.created_at),
      updatedAt: toIso(created.updated_at),
    },
    isExistingCompleted: false,
  };
}

/**
 * Formats structured notes into clean Markdown for document storage.
 */
export function formatMeetingNotesMarkdown(
  title: string,
  summaryMd: string,
  decisions: Decision[],
  openQuestions: OpenQuestion[]
): string {
  const parts: string[] = [];
  parts.push(`# Meeting Notes: ${title}\n`);
  parts.push(`## Summary\n${summaryMd.trim()}\n`);

  if (decisions.length > 0) {
    parts.push(`## Key Decisions`);
    for (const d of decisions) {
      parts.push(`- **${d.text}**`);
    }
    parts.push('');
  }

  if (openQuestions.length > 0) {
    parts.push(`## Open Questions`);
    for (const q of openQuestions) {
      parts.push(`- ${q.text}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

export interface PersistMeetingNotesParams {
  orgId: string;
  meetingId: string;
  nodeId: string;
  processingGeneration: number;
  extractionRunId: string;
  summaryMd: string;
  decisions: Decision[];
  openQuestions: OpenQuestion[];
  actionItems: SuggestedActionItem[];
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costInr: number;
}

export interface PersistMeetingNotesResult {
  notes: MeetingNotesDTO;
  actionItems: ActionItemDTO[];
  docId: string;
}

/**
 * Persists meeting notes, staged action items, doc synchronization, and updates status in a single atomic transaction.
 *
 * CRITICAL REQUIREMENTS:
 * 1. Strictly enforces Requirement N-1: Any action item with 0 valid evidence segments is DISCARDED.
 * 2. Zero task rows are created. Action items are strictly staged with state='suggested', task_id=null, decided_by=null.
 * 3. Idempotently creates or updates document in `docs` table, respecting user-edited versions (never overwrites user edits).
 * 4. Advances meeting state from 'routed' to 'completed'.
 * 5. Emits `meeting.notes_created` and `meeting.suggestions_created` transactional outbox events.
 */
export async function persistMeetingNotesAndSuggestions(
  db: DbOrSql,
  params: PersistMeetingNotesParams
): Promise<PersistMeetingNotesResult> {
  const sql = getSql(db);

  return await sql.begin(async (txn: any) => {
    // 1. Lock and verify meeting record
    const [meeting] = await txn`
      SELECT id, org_id, node_id, title, status, processing_generation, version
      FROM meetings
      WHERE org_id = ${params.orgId}
        AND id = ${params.meetingId}
      FOR UPDATE
    `;

    if (!meeting) {
      throw new NotFoundError(`Meeting with ID ${params.meetingId} not found`);
    }

    if (meeting.processing_generation !== params.processingGeneration) {
      throw new ConflictError(
        `Meeting processing generation mismatch (expected: ${meeting.processing_generation}, received: ${params.processingGeneration})`
      );
    }

    if (!meeting.node_id || meeting.node_id !== params.nodeId) {
      throw new ValidationError(
        `Meeting routed node mismatch (meeting node: ${meeting.node_id}, params node: ${params.nodeId})`
      );
    }

    // 2. Purge any previous staged notes and suggestions for this meeting (idempotency within same generation)
    await txn`
      DELETE FROM meeting_notes
      WHERE org_id = ${params.orgId} AND meeting_id = ${params.meetingId}
    `;
    // Human-decided items (approved/edited/rejected) are durable decision records and are never purged here.
    await txn`
      DELETE FROM action_items
      WHERE org_id = ${params.orgId} AND meeting_id = ${params.meetingId} AND state = 'suggested'
    `;

    // 3. Document synchronization in `docs` table
    const formattedNotesMd = formatMeetingNotesMarkdown(
      meeting.title || 'Meeting',
      params.summaryMd,
      params.decisions,
      params.openQuestions
    );

    const [existingDoc] = await txn`
      SELECT id, version, created_by, updated_by
      FROM docs
      WHERE org_id = ${params.orgId}
        AND source_meeting_id = ${params.meetingId}
    `;

    let docId: string;

    if (existingDoc) {
      docId = existingDoc.id;
      // If user has modified the doc (created_by is set or version > 1), DO NOT overwrite user edits
      if (!existingDoc.created_by && existingDoc.version <= 1) {
        const nextVersion = existingDoc.version + 1;
        await txn`
          UPDATE docs
          SET
            title = ${`Notes: ${meeting.title || 'Meeting'}`},
            body_md = ${formattedNotesMd},
            version = ${nextVersion},
            updated_at = now()
          WHERE org_id = ${params.orgId} AND id = ${docId}
        `;

        await txn`
          INSERT INTO doc_versions (
            id, org_id, doc_id, version, title, body_md, created_by, created_at
          ) VALUES (
            ${generateUuidV7()}, ${params.orgId}, ${docId}, ${nextVersion},
            ${`Notes: ${meeting.title || 'Meeting'}`}, ${formattedNotesMd}, NULL, now()
          )
        `;

        // Retain maximum 30 versions
        await txn`
          DELETE FROM doc_versions
          WHERE org_id = ${params.orgId}
            AND doc_id = ${docId}
            AND version < (
              SELECT version FROM doc_versions
              WHERE org_id = ${params.orgId} AND doc_id = ${docId}
              ORDER BY version DESC
              OFFSET 30 LIMIT 1
            )
        `;
      }
    } else {
      docId = generateUuidV7();
      await txn`
        INSERT INTO docs (
          id, org_id, node_id, title, body_md, version, created_by, updated_by, source_meeting_id, created_at, updated_at
        ) VALUES (
          ${docId}, ${params.orgId}, ${params.nodeId}, ${`Notes: ${meeting.title || 'Meeting'}`},
          ${formattedNotesMd}, 1, NULL, NULL, ${params.meetingId}, now(), now()
        )
      `;

      await txn`
        INSERT INTO doc_versions (
          id, org_id, doc_id, version, title, body_md, created_by, created_at
        ) VALUES (
          ${generateUuidV7()}, ${params.orgId}, ${docId}, 1,
          ${`Notes: ${meeting.title || 'Meeting'}`}, ${formattedNotesMd}, NULL, now()
        )
      `;
    }

    // 4. Insert meeting_notes
    const notesId = generateUuidV7();
    const [notesRow] = await txn`
      INSERT INTO meeting_notes (
        id,
        org_id,
        meeting_id,
        summary_md,
        decisions,
        open_questions,
        evidence,
        model,
        prompt_version,
        cost_inr,
        extraction_run_id,
        doc_id,
        created_at,
        updated_at
      ) VALUES (
        ${notesId},
        ${params.orgId},
        ${params.meetingId},
        ${params.summaryMd},
        ${JSON.stringify(params.decisions)}::jsonb,
        ${JSON.stringify(params.openQuestions)}::jsonb,
        ${JSON.stringify([])}::jsonb,
        ${params.model},
        ${params.promptVersion},
        ${params.costInr},
        ${params.extractionRunId},
        ${docId},
        now(),
        now()
      )
      RETURNING *
    `;

    // 5. Insert staged action_items: Strictly Enforce Requirement N-1
    // Filter out any action item that does not have at least 1 valid evidence segment.
    // A re-extraction in the same generation must not re-stage a suggestion a human already decided
    // (same matching rule as the cross-window merge above).
    const decided: ActionItemLike[] = (
      await txn`
        SELECT text, evidence FROM action_items
        WHERE org_id = ${params.orgId} AND meeting_id = ${params.meetingId} AND state <> 'suggested'
      `
    ).map((r: any) => ({ text: r.text, evidence: parseJsonArray<{ seq: number }>(r.evidence) }));
    const validActionItems = params.actionItems.filter(
      (item) =>
        item.evidence &&
        item.evidence.length >= 1 &&
        !decided.some((d) => isSameActionItem(item, d))
    );

    const savedActionItems: ActionItemDTO[] = [];
    for (const item of validActionItems) {
      const itemId = generateUuidV7();
      const [itemRow] = await txn`
        INSERT INTO action_items (
          id,
          org_id,
          meeting_id,
          text,
          owner_name,
          due_phrase,
          suggested_owner_id,
          suggested_due,
          evidence,
          confidence,
          state,
          proposal_type,
          task_id,
          decided_by,
          decided_at,
          extraction_run_id,
          created_at,
          updated_at
        ) VALUES (
          ${itemId},
          ${params.orgId},
          ${params.meetingId},
          ${item.text},
          ${item.owner_name || null},
          ${item.due_phrase || null},
          NULL,
          NULL,
          ${JSON.stringify(item.evidence)}::jsonb,
          ${item.confidence},
          'suggested',
          'create_task',
          NULL,
          NULL,
          NULL,
          ${params.extractionRunId},
          now(),
          now()
        )
        RETURNING *
      `;

      savedActionItems.push({
        id: itemRow.id,
        orgId: itemRow.org_id,
        meetingId: itemRow.meeting_id,
        text: itemRow.text,
        ownerName: itemRow.owner_name,
        duePhrase: itemRow.due_phrase,
        suggestedOwnerId: itemRow.suggested_owner_id,
        suggestedDue: toIsoOrNull(itemRow.suggested_due),
        evidence: parseJsonArray<EvidenceSegmentDTO>(itemRow.evidence),
        confidence: Number(itemRow.confidence),
        state: itemRow.state,
        proposalType: itemRow.proposal_type || 'create_task',
        targetTaskId: itemRow.target_task_id,
        targetTaskVersion: itemRow.target_task_version != null ? Number(itemRow.target_task_version) : null,
        targetTaskHash: itemRow.target_task_hash,
        similarityScore: itemRow.similarity_score != null ? Number(itemRow.similarity_score) : null,
        rankedAlternatives: parseJsonArray(itemRow.ranked_alternatives),
        embeddingSpace: itemRow.embedding_space,
        dedupStatus: itemRow.dedup_status || 'pending',
        dedupedAt: toIsoOrNull(itemRow.deduped_at),
        ownerResolutionMethod: itemRow.owner_resolution_method,
        ownerResolutionConfidence: itemRow.owner_resolution_confidence != null ? Number(itemRow.owner_resolution_confidence) : null,
        ownerResolutionEvidence: itemRow.owner_resolution_evidence,
        dueResolutionExplanation: itemRow.due_resolution_explanation,
        dueResolutionStatus: itemRow.due_resolution_status,
        validationStatus: itemRow.validation_status || 'valid',
        taskId: itemRow.task_id,
        decidedBy: itemRow.decided_by,
        decidedAt: toIsoOrNull(itemRow.decided_at),
        extractionRunId: itemRow.extraction_run_id,
        createdAt: toIso(itemRow.created_at),
        updatedAt: toIso(itemRow.updated_at),
      });
    }

    // 6. Update extraction_runs status to completed
    await txn`
      UPDATE extraction_runs
      SET
        status = 'completed',
        completed_windows = total_windows,
        input_tokens = ${params.inputTokens},
        output_tokens = ${params.outputTokens},
        cost_inr = ${params.costInr},
        completed_at = now(),
        updated_at = now()
      WHERE org_id = ${params.orgId}
        AND id = ${params.extractionRunId}
    `;

    // 7. Transition meeting status from 'routed' to 'completed'
    await txn`
      UPDATE meetings
      SET
        status = 'completed',
        version = version + 1,
        updated_at = now()
      WHERE org_id = ${params.orgId}
        AND id = ${params.meetingId}
    `;

    // 8. Enqueue downstream outbox events
    await insertOutboxEvent(txn, {
      orgId: params.orgId,
      topic: 'meeting.notes_created',
      payload: {
        orgId: params.orgId,
        meetingId: params.meetingId,
        notesId,
        nodeId: params.nodeId,
        docId,
        emittedAt: new Date().toISOString(),
      },
    });

    await insertOutboxEvent(txn, {
      orgId: params.orgId,
      topic: 'meeting.suggestions_created',
      payload: {
        orgId: params.orgId,
        meetingId: params.meetingId,
        actionItemCount: savedActionItems.length,
        actionItemIds: savedActionItems.map((a) => a.id),
        emittedAt: new Date().toISOString(),
      },
    });

    const notesDTO: MeetingNotesDTO = {
      id: notesRow.id,
      orgId: notesRow.org_id,
      meetingId: notesRow.meeting_id,
      summaryMd: notesRow.summary_md,
      decisions: parseJsonArray<DecisionDTO>(notesRow.decisions),
      openQuestions: parseJsonArray<OpenQuestionDTO>(notesRow.open_questions),
      evidence: parseJsonArray<EvidenceSegmentDTO>(notesRow.evidence),
      model: notesRow.model,
      promptVersion: notesRow.prompt_version,
      costInr: Number(notesRow.cost_inr),
      extractionRunId: notesRow.extraction_run_id,
      docId: notesRow.doc_id,
      createdAt: toIso(notesRow.created_at),
      updatedAt: toIso(notesRow.updated_at),
    };

    return {
      notes: notesDTO,
      actionItems: savedActionItems,
      docId,
    };
  });
}

/**
 * Revalidates undecided staged suggestions against the canonical transcript segments in the database.
 * If evidence segments do not strictly match contiguous spans, the item is marked as invalid_evidence.
 * Invalid suggestions are excluded from review without being recorded as human rejections.
 */
export async function revalidateMeetingActionItems(
  db: DbOrSql,
  orgId: string,
  meetingId: string
): Promise<{ validCount: number; invalidCount: number }> {
  const sql = getSql(db);

  // 1. Fetch all transcript segments for the meeting
  const segmentRows = await sql<Array<{ seq: number; text: string; start_ms: number; end_ms: number }>>`
    SELECT seq, text, start_ms, end_ms
    FROM transcript_segments
    WHERE org_id = ${orgId} AND meeting_id = ${meetingId}
    ORDER BY seq ASC
  `;

  const segmentsBySeq = new Map<number, { text: string; startMs: number; endMs: number }>();
  for (const row of segmentRows) {
    segmentsBySeq.set(row.seq, {
      text: row.text,
      startMs: row.start_ms,
      endMs: row.end_ms,
    });
  }

  // 2. Fetch all undecided action items
  const items = await sql<Array<{ id: string; evidence: unknown; state: string }>>`
    SELECT id, evidence, state
    FROM action_items
    WHERE org_id = ${orgId}
      AND meeting_id = ${meetingId}
      AND state = 'suggested'
  `;

  let validCount = 0;
  let invalidCount = 0;

  for (const item of items) {
    const rawEvidence = parseJsonArray<{ seq: number; quote: string }>(item.evidence);
    const validEvidence = validateEvidenceSegments(segmentsBySeq, rawEvidence);

    if (validEvidence.length === 0) {
      invalidCount++;
      await sql`
        UPDATE action_items
        SET validation_status = 'invalid_evidence',
            version = version + 1,
            updated_at = now()
        WHERE org_id = ${orgId} AND id = ${item.id} AND state = 'suggested'
      `;
    } else {
      validCount++;
      await sql`
        UPDATE action_items
        SET validation_status = 'valid',
            evidence = ${JSON.stringify(validEvidence)}::jsonb,
            version = version + 1,
            updated_at = now()
        WHERE org_id = ${orgId} AND id = ${item.id} AND state = 'suggested'
      `;
    }
  }

  return { validCount, invalidCount };
}

/**
 * Retrieves persisted meeting notes and action items (with decision state, version, linked task and
 * update-target preview) for a given meeting. Callers must have authorized meeting access; pass the
 * viewer so `canDecide` and cross-project task visibility are evaluated for that user.
 */
export async function getMeetingNotesAndSuggestions(
  db: DbOrSql,
  orgId: string,
  meetingId: string,
  viewer?: ActionItemViewer
): Promise<{ notes: MeetingNotesDTO | null; actionItems: ActionItemDTO[] }> {
  const sql = getSql(db);

  const [notesRow] = await sql<any[]>`
    SELECT *
    FROM meeting_notes
    WHERE org_id = ${orgId}
      AND meeting_id = ${meetingId}
  `;

  const actionItems = await listMeetingActionItems(sql, orgId, meetingId, viewer);

  const notes: MeetingNotesDTO | null = notesRow
    ? {
        id: notesRow.id,
        orgId: notesRow.org_id,
        meetingId: notesRow.meeting_id,
        summaryMd: notesRow.summary_md,
        decisions: parseJsonArray<DecisionDTO>(notesRow.decisions),
        openQuestions: parseJsonArray<OpenQuestionDTO>(notesRow.open_questions),
        evidence: parseJsonArray<EvidenceSegmentDTO>(notesRow.evidence),
        model: notesRow.model,
        promptVersion: notesRow.prompt_version,
        costInr: Number(notesRow.cost_inr),
        extractionRunId: notesRow.extraction_run_id,
        docId: notesRow.doc_id,
        createdAt: toIso(notesRow.created_at),
        updatedAt: toIso(notesRow.updated_at),
      }
    : null;

  return { notes, actionItems };
}

export interface EnrichMeetingSuggestionsParams {
  orgId: string;
  meetingId: string;
  embeddingSpace?: string;
  llmPort: LLMPort;
}

export interface EnrichMeetingSuggestionsResult {
  meetingId: string;
  enrichedCount: number;
  matchedCount: number;
  invalidCount: number;
}

/**
 * Enriches staged action items for human review (Stage 16):
 * 1. Revalidates all undecided suggestions against canonical transcript segments.
 * 2. Scoped deduplication against open tasks in the routed project (cosine similarity >= 0.85).
 * 3. Conservative owner resolution (speaker commitment -> explicit name -> fast LLM disambiguation).
 * 4. Due date resolution based on spoken phrases referenced to meeting start date in Asia/Kolkata.
 * 5. Atomically persists enrichment results and emits meeting.suggestions_enriched outbox event.
 * STRICT INVARIANT: ZERO mutations on the tasks table. Action items stay in state='suggested', task_id=null.
 */
export async function enrichMeetingSuggestions(
  db: DbOrSql,
  params: EnrichMeetingSuggestionsParams
): Promise<EnrichMeetingSuggestionsResult> {
  const sql = getSql(db);
  const { orgId, meetingId, embeddingSpace = DEFAULT_EMBEDDING_SPACE, llmPort } = params;

  // 1. Revalidate undecided action items against transcript segments
  const { invalidCount } = await revalidateMeetingActionItems(sql, orgId, meetingId);

  // 2. Fetch meeting details
  const [meeting] = await sql<Array<{
    id: string;
    org_id: string;
    node_id: string | null;
    scheduled_start_at: Date | null;
    actual_start_at: Date | null;
    created_at: Date;
    processing_generation: number;
    skipped: boolean;
  }>>`
    SELECT id, org_id, node_id, scheduled_start_at, actual_start_at, created_at, processing_generation, skipped
    FROM meetings
    WHERE org_id = ${orgId} AND id = ${meetingId}
    LIMIT 1
  `;

  if (!meeting || meeting.skipped) {
    return {
      meetingId,
      enrichedCount: 0,
      matchedCount: 0,
      invalidCount,
    };
  }

  // new Date(): drizzle-wrapped postgres clients (API/worker) return timestamptz as strings.
  const meetingStartIso = new Date(
    meeting.actual_start_at ||
    meeting.scheduled_start_at ||
    meeting.created_at
  ).toISOString();

  // 3. Fetch permitted project members if routed
  let projectMembers: ProjectMemberCandidate[] = [];
  // A failed backfill leaves some open tasks unsearchable: then "no match" is unproven (ADR 17).
  let taskIndexComplete = true;
  if (meeting.node_id) {
    try {
      await ensureProjectTaskEmbeddings(sql, llmPort, {
        orgId,
        nodeId: meeting.node_id,
        embeddingSpace,
      });
    } catch {
      // Embedding provider failure (e.g. missing credentials, rate limit): items without a match become 'incomplete'.
      taskIndexComplete = false;
    }

    const memberRows = await sql<Array<{ user_id: string; name: string; email: string }>>`
      SELECT DISTINCT u.id AS user_id, u.name, u.email
      FROM users u
      JOIN memberships m ON m.user_id = u.id AND m.org_id = ${orgId}
      WHERE (
        EXISTS (
          SELECT 1 FROM nodes n
          WHERE n.id = ${meeting.node_id} AND n.org_id = ${orgId} AND n.visibility = 'public' AND n.archived_at IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM node_members nm
          JOIN nodes n ON n.id = nm.node_id AND n.org_id = ${orgId} AND n.archived_at IS NULL
          WHERE nm.org_id = ${orgId} AND nm.node_id = ${meeting.node_id} AND nm.user_id = u.id
        )
      )
    `;
    projectMembers = memberRows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      email: r.email,
    }));
  }

  // 4. Fetch transcript segments and speaker mapping context
  const segmentRows = await sql<Array<{
    seq: number;
    speaker_label: string;
    user_id: string | null;
    display_name: string | null;
  }>>`
    SELECT ts.seq, ts.speaker_label,
           ts.user_id, u.name AS display_name
    FROM transcript_segments ts
    LEFT JOIN users u ON u.id = ts.user_id
    WHERE ts.org_id = ${orgId} AND ts.meeting_id = ${meetingId}
    ORDER BY ts.seq ASC
  `;

  const speakersBySeq = new Map<number, SpeakerContext>();
  for (const s of segmentRows) {
    speakersBySeq.set(s.seq, {
      seq: s.seq,
      speakerLabel: s.speaker_label,
      resolvedUserId: s.user_id,
      displayName: s.display_name,
    });
  }

  // 5. Fetch valid undecided action items
  const validItems = await sql<Array<{
    id: string;
    text: string;
    owner_name: string | null;
    due_phrase: string | null;
    evidence: unknown;
  }>>`
    SELECT id, text, owner_name, due_phrase, evidence
    FROM action_items
    WHERE org_id = ${orgId}
      AND meeting_id = ${meetingId}
      AND state = 'suggested'
      AND validation_status = 'valid'
    ORDER BY created_at ASC
  `;

  let matchedCount = 0;

  // 6. Enrich each valid action item atomically
  await sql.begin(async (txn) => {
    for (const item of validItems) {
      const parsedEvidence = parseJsonArray<EvidenceSegmentDTO>(item.evidence);

      // 6a. Resolve Due Date in Asia/Kolkata
      const dueRes = resolveActionItemDueDate({
        duePhrase: item.due_phrase,
        meetingStartIso,
      });

      // 6b. Resolve Owner
      const ownerRes = await resolveActionItemOwner({
        actionText: item.text,
        ownerName: item.owner_name,
        evidence: parsedEvidence,
        speakersBySeq,
        projectMembers,
        llmPort,
      });

      // 6c. Deduplicate against open tasks in project
      let proposalType: 'create_task' | 'update_task' = 'create_task';
      let targetTaskId: string | null = null;
      let targetTaskVersion: number | null = null;
      let targetTaskHash: string | null = null;
      let similarityScore: number | null = null;
      let rankedAlternatives: RankedAlternativeDTO[] = [];
      let dedupStatus: 'matched' | 'no_match' | 'incomplete' | 'skipped' = 'no_match';

      if (meeting.node_id) {
        try {
          const textToEmbed = maskPiiForEmbedding(item.text);
          const embedRes = await llmPort.embed({ texts: [textToEmbed] });
          const queryVector = embedRes.embeddings[0];

          if (queryVector && queryVector.length === 1024) {
            const matches = await findMatchingOpenTasks(txn, {
              orgId,
              nodeId: meeting.node_id,
              queryVector,
              embeddingSpace,
              minSimilarity: 0.50,
              limit: 5,
            });

            rankedAlternatives = matches.map((m) => ({
              taskId: m.taskId,
              taskKey: m.key,
              taskTitle: m.title,
              similarityScore: m.similarityScore,
            }));

            if (matches[0] && matches[0].similarityScore >= TASK_DEDUP_SIMILARITY_THRESHOLD) {
              proposalType = 'update_task';
              targetTaskId = matches[0].taskId;
              targetTaskVersion = matches[0].version;
              targetTaskHash = matches[0].contentHash;
              similarityScore = matches[0].similarityScore;
              dedupStatus = 'matched';
              matchedCount++;
            } else {
              proposalType = 'create_task';
              targetTaskId = null;
              targetTaskVersion = null;
              targetTaskHash = null;
              similarityScore = matches[0]?.similarityScore ?? null;
              dedupStatus = taskIndexComplete ? 'no_match' : 'incomplete';
            }
          } else {
            dedupStatus = 'incomplete';
          }
        } catch {
          dedupStatus = 'incomplete';
        }
      } else {
        dedupStatus = 'skipped';
      }

      // 6d. Update action_items row (ZERO MUTATION to tasks table)
      await txn`
        UPDATE action_items
        SET
          proposal_type = ${proposalType},
          target_task_id = ${targetTaskId},
          target_task_version = ${targetTaskVersion},
          target_task_hash = ${targetTaskHash},
          similarity_score = ${similarityScore},
          ranked_alternatives = ${JSON.stringify(rankedAlternatives)}::jsonb,
          embedding_space = ${embeddingSpace},
          dedup_status = ${dedupStatus},
          deduped_at = now(),
          suggested_owner_id = ${ownerRes.suggestedOwnerId},
          owner_resolution_method = ${ownerRes.resolutionMethod},
          owner_resolution_confidence = ${ownerRes.confidence},
          owner_resolution_evidence = ${ownerRes.explanation},
          suggested_due = ${dueRes.suggestedDue ? sql`${dueRes.suggestedDue}::timestamptz` : null},
          due_resolution_explanation = ${dueRes.explanation},
          due_resolution_status = ${dueRes.status},
          -- The proposal shown to a human changed: stale If-Match decisions must get 412 (Stage 17).
          version = version + 1,
          updated_at = now()
        WHERE org_id = ${orgId}
          AND id = ${item.id}
          AND state = 'suggested'
      `;
    }

    // 7. Emit meeting.suggestions_enriched outbox event
    await insertOutboxEvent(txn, {
      orgId,
      topic: 'meeting.suggestions_enriched',
      payload: {
        orgId,
        meetingId,
        enrichedCount: validItems.length,
        matchedCount,
        invalidCount,
        timestamp: new Date().toISOString(),
      },
    });
  });

  return {
    meetingId,
    enrichedCount: validItems.length,
    matchedCount,
    invalidCount,
  };
}
