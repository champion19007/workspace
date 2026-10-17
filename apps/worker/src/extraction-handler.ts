import type { FastifyBaseLogger } from 'fastify';
import {
  type AppPorts,
  type MeetingRoutedPayload,
  BudgetExceededError,
} from '@workspace/core';
import {
  type Sql,
  buildExtractionWindows,
  validateEvidenceSegments,
  mergeWindowOutputs,
  checkBudgetCapacity,
  recordAiUsageLedgerEntry,
  createOrFindExtractionRun,
  persistMeetingNotesAndSuggestions,
  tenantSql,
} from '@workspace/db';
import {
  PROMPT_VERSIONS,
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  ExtractionOutputSchema,
  type ExtractionOutput,
} from '@workspace/prompts';

/**
 * Handles 'meeting.routed' background jobs:
 * 1. Fences execution by processing generation and verifies committed project route.
 * 2. Token-aware windowing: single window if <= 30k tokens; 20-min windows with 2-min overlap if > 30k tokens.
 * 3. Enforces AI budget limits before making provider calls.
 * 4. Executes strong-tier LLM extraction with prompt injection defense and temperature 0.0.
 * 5. Strictly enforces Requirement N-1: Validates verbatim quotes against stored transcript segments,
 *    and discards any action item with 0 valid evidence segments.
 * 6. Merges multi-window outputs and collapses overlap duplicates.
 * 7. Persists meeting notes, staged action items, synchronized doc, and emits outbox events atomically.
 */
export async function handleMeetingRoutedJob(
  db: Sql,
  ports: AppPorts,
  logger: FastifyBaseLogger | Console,
  payload: MeetingRoutedPayload
): Promise<boolean> {
  const { orgId, meetingId, nodeId, processingGeneration } = payload;
  // Background job for one organization: every statement runs as workspace_system under its org context.
  const sql = tenantSql(db, { orgId, system: true });
  const startTime = Date.now();

  logger.info({ orgId, meetingId, nodeId }, 'Starting meeting notes & action suggestion extraction');

  // 1. Fetch meeting and verify prerequisites
  const [meeting] = await sql<
    Array<{
      id: string;
      org_id: string;
      title: string;
      status: string;
      node_id: string | null;
      processing_generation: number;
      raw_transcript_checksum: string | null;
      skipped: boolean;
    }>
  >`
    SELECT id, org_id, title, status, node_id, processing_generation, raw_transcript_checksum, skipped
    FROM meetings
    WHERE org_id = ${orgId} AND id = ${meetingId}
  `;

  if (!meeting) {
    logger.warn({ orgId, meetingId }, 'Meeting not found for routed extraction job');
    return false;
  }

  // Generation fence check
  if (
    processingGeneration !== undefined &&
    meeting.processing_generation !== processingGeneration
  ) {
    logger.warn(
      { orgId, meetingId, expected: processingGeneration, actual: meeting.processing_generation },
      'Aborting extraction job due to processing generation mismatch'
    );
    return false;
  }

  // Meeting state checks
  if (meeting.skipped) {
    logger.info({ orgId, meetingId }, 'Meeting is skipped; aborting extraction');
    return false;
  }

  if (meeting.status !== 'routed' && meeting.status !== 'completed') {
    logger.warn(
      { orgId, meetingId, status: meeting.status },
      'Meeting status is not routed or completed; aborting extraction'
    );
    return false;
  }

  if (!meeting.node_id || meeting.node_id !== nodeId) {
    logger.warn(
      { orgId, meetingId, meetingNode: meeting.node_id, payloadNode: nodeId },
      'Meeting node mismatch; aborting extraction'
    );
    return false;
  }

  // Fetch project node name
  const [node] = await sql<Array<{ id: string; name: string }>>`
    SELECT id, name
    FROM nodes
    WHERE org_id = ${orgId} AND id = ${nodeId} AND archived_at IS NULL
  `;

  if (!node) {
    logger.warn({ orgId, nodeId }, 'Routed project node not found or archived');
    return false;
  }

  // 2. Fetch transcript segments
  const rawSegments = await sql<
    Array<{
      seq: number;
      speaker_label: string | null;
      start_ms: number;
      end_ms: number;
      text: string;
    }>
  >`
    SELECT seq, speaker_label, start_ms, end_ms, text
    FROM transcript_segments
    WHERE org_id = ${orgId} AND meeting_id = ${meetingId}
    ORDER BY seq ASC
  `;

  if (rawSegments.length === 0) {
    logger.warn({ orgId, meetingId }, 'No transcript segments found for meeting');
    return false;
  }

  const segments = rawSegments.map((s) => ({
    seq: s.seq,
    speakerLabel: s.speaker_label,
    startMs: s.start_ms,
    endMs: s.end_ms,
    text: s.text,
  }));

  const segmentsBySeq = new Map(
    segments.map((s) => [s.seq, { text: s.text, startMs: s.startMs, endMs: s.endMs }])
  );

  // 3. Build token-aware windows
  const windows = buildExtractionWindows(segments);
  const totalWindows = windows.length;
  logger.info({ meetingId, totalWindows }, `Divided transcript into ${totalWindows} extraction window(s)`);

  const model = 'claude-3-7-sonnet-latest';
  const promptVersion = PROMPT_VERSIONS.extraction;
  const transcriptChecksum = meeting.raw_transcript_checksum || 'sha256:unknown';

  // 4. Durable run management
  const { run, isExistingCompleted } = await createOrFindExtractionRun(sql, {
    orgId,
    meetingId,
    nodeId,
    processingGeneration: meeting.processing_generation,
    transcriptChecksum,
    promptVersion,
    model,
    totalWindows,
  });

  if (isExistingCompleted) {
    logger.info(
      { meetingId, runKey: run.runKey },
      'Extraction run already completed for this version/generation; skipping duplicate execution'
    );
    return true;
  }

  // 5. Pre-flight budget capacity verification
  const totalEstimatedInputTokens = windows.reduce((acc, w) => acc + w.estimatedTokens, 0);
  const estimatedOutputTokens = 2048 * totalWindows;
  // Strong tier pricing estimate: ~$3.0/M input, ~$15.0/M output at 86 INR/USD
  const estimatedCostInr =
    ((totalEstimatedInputTokens / 1_000_000) * 3.0 +
      (estimatedOutputTokens / 1_000_000) * 15.0) *
    86.0;

  try {
    await checkBudgetCapacity(sql, orgId, estimatedCostInr);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      logger.error({ orgId, meetingId, err: err.message }, 'AI budget check failed');
      await sql`
        UPDATE extraction_runs
        SET status = 'failed', error_message = ${err.message}, updated_at = now()
        WHERE id = ${run.id}
      `;
      await recordAiUsageLedgerEntry(sql, {
        orgId,
        meetingId,
        extractionRunId: run.id,
        operation: 'extract.notes_and_actions',
        provider: 'anthropic',
        model,
        promptId: 'extract.notes_and_actions',
        promptVersion,
        inputTokens: 0,
        outputTokens: 0,
        costInr: 0,
        estimated: true,
        durationMs: 0,
        status: 'failed',
        errorMessage: err.message,
      });
      return false;
    }
    throw err;
  }

  // 6. Execute windowed LLM extractions (with max concurrency 3)
  const windowOutputs: ExtractionOutput[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostInr = 0;

  // Process windows in chunks of 3 for concurrency control
  const chunkSize = 3;
  for (let i = 0; i < windows.length; i += chunkSize) {
    const chunk = windows.slice(i, i + chunkSize);

    const chunkResults = await Promise.all(
      chunk.map(async (win) => {
        const promptInput = buildExtractionPrompt({
          meetingTitle: meeting.title || 'Meeting',
          projectTitle: node.name,
          segments: win.segments,
          windowIndex: win.windowIndex,
          totalWindows: win.totalWindows,
        });

        try {
          const result = await ports.llm.complete<ExtractionOutput>({
            promptId: 'extract.notes_and_actions',
            promptVersion,
            tier: 'strong',
            input: promptInput,
            schema: ExtractionOutputSchema,
            systemPrefix: EXTRACTION_SYSTEM_PROMPT,
            temperature: 0.0,
          });

          // Record usage ledger entry
          await recordAiUsageLedgerEntry(sql, {
            orgId,
            meetingId,
            extractionRunId: run.id,
            operation: 'extract.notes_and_actions',
            provider: 'anthropic',
            model: result.model,
            promptId: 'extract.notes_and_actions',
            promptVersion,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costInr: result.costInr,
            estimated: false,
            durationMs: result.durationMs,
            status: 'succeeded',
          });

          // Validate evidence segments for decisions
          const validatedDecisions = result.data.decisions.map((dec) => ({
            text: dec.text,
            evidence: validateEvidenceSegments(segmentsBySeq, dec.evidence || []),
          }));

          // Strict N-1 Gate: Validate evidence segments for each action item.
          // Discard any action item with 0 valid evidence segments!
          const validatedActionItems: typeof result.data.action_items = [];
          for (const item of result.data.action_items) {
            const validEvidence = validateEvidenceSegments(segmentsBySeq, item.evidence || []);
            if (validEvidence.length >= 1) {
              validatedActionItems.push({
                ...item,
                evidence: validEvidence,
              });
            } else {
              logger.warn(
                { meetingId, itemText: item.text },
                'N-1 Gate: Discarding action item with 0 valid evidence segments'
              );
            }
          }

          return {
            windowOutput: {
              summary_md: result.data.summary_md,
              decisions: validatedDecisions,
              open_questions: result.data.open_questions,
              action_items: validatedActionItems,
            },
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costInr: result.costInr,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error({ winIndex: win.windowIndex, err: errMsg }, 'LLM extraction failed for window');

          await recordAiUsageLedgerEntry(sql, {
            orgId,
            meetingId,
            extractionRunId: run.id,
            operation: 'extract.notes_and_actions',
            provider: 'anthropic',
            model,
            promptId: 'extract.notes_and_actions',
            promptVersion,
            inputTokens: 0,
            outputTokens: 0,
            costInr: 0,
            estimated: true,
            durationMs: 0,
            status: 'failed',
            errorMessage: errMsg,
          });

          throw err;
        }
      })
    );

    for (const res of chunkResults) {
      windowOutputs.push(res.windowOutput);
      totalInputTokens += res.inputTokens;
      totalOutputTokens += res.outputTokens;
      totalCostInr += res.costInr;
    }
  }

  // 7. Merge outputs across windows
  const mergedOutput = mergeWindowOutputs(windowOutputs);

  // Apply final N-1 verification on merged action items
  const finalActionItems = mergedOutput.action_items.filter(
    (item) => item.evidence && item.evidence.length >= 1
  );

  // 8. Atomic persistence in database
  const persistResult = await persistMeetingNotesAndSuggestions(sql, {
    orgId,
    meetingId,
    nodeId,
    processingGeneration: meeting.processing_generation,
    extractionRunId: run.id,
    summaryMd: mergedOutput.summary_md,
    decisions: mergedOutput.decisions,
    openQuestions: mergedOutput.open_questions,
    actionItems: finalActionItems,
    model,
    promptVersion,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    costInr: totalCostInr,
  });

  const durationMs = Date.now() - startTime;
  logger.info(
    {
      orgId,
      meetingId,
      notesId: persistResult.notes.id,
      docId: persistResult.docId,
      actionItemCount: persistResult.actionItems.length,
      durationMs,
      costInr: totalCostInr,
    },
    'Completed meeting notes and action suggestion extraction successfully'
  );

  return true;
}
