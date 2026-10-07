import type { FastifyBaseLogger } from 'fastify';
import { type AppPorts, type MeetingSuggestionsCreatedPayload } from '@workspace/core';
import { type Sql, enrichMeetingSuggestions } from '@workspace/db';

/**
 * Handles 'meeting.suggestions_created' queue jobs:
 * 1. Checks that meeting is active and not skipped.
 * 2. Runs strict evidence revalidation.
 * 3. Scopes open-task deduplication against the routed project (cosine similarity >= 0.85).
 * 4. Resolves owners conservatively (speaker commitments -> explicit name matching -> fast LLM disambiguation).
 * 5. Resolves due dates relative to meeting start in Asia/Kolkata.
 * 6. Atomically updates action_items and emits meeting.suggestions_enriched.
 * STRICT INVARIANT: ZERO mutations on the tasks table.
 */
export async function handleSuggestionsCreatedJob(
  sql: Sql,
  ports: AppPorts,
  logger: FastifyBaseLogger | Console,
  payload: MeetingSuggestionsCreatedPayload
): Promise<boolean> {
  const { orgId, meetingId } = payload;
  logger.info({ orgId, meetingId }, 'Starting suggestion enrichment job (dedup, owner, due date)');

  const [meeting] = await sql<Array<{ id: string; skipped: boolean }>>`
    SELECT id, skipped FROM meetings
    WHERE org_id = ${orgId} AND id = ${meetingId}
    LIMIT 1
  `;

  if (!meeting) {
    logger.warn({ orgId, meetingId }, 'Meeting not found for suggestion enrichment');
    return false;
  }

  if (meeting.skipped) {
    logger.info({ orgId, meetingId }, 'Meeting is skipped; aborting suggestion enrichment');
    return false;
  }

  try {
    const res = await enrichMeetingSuggestions(sql, {
      orgId,
      meetingId,
      llmPort: ports.llm,
    });

    logger.info(
      { orgId, meetingId, enrichedCount: res.enrichedCount, matchedCount: res.matchedCount, invalidCount: res.invalidCount },
      'Successfully enriched meeting action items'
    );
    return true;
  } catch (err) {
    logger.error({ orgId, meetingId, err }, 'Failed to enrich meeting action items');
    throw err;
  }
}
