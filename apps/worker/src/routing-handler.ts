import {
  type Sql,
  resolveMeetingSpeakers,
  evaluateAndRouteMeeting,
  getOrRefreshZoomCredentials,
} from '@workspace/db';
import {
  type AppPorts,
  type MeetingTranscriptIngestedPayload,
  type ZoomMeetingParticipant,
} from '@workspace/core';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Handles 'meeting.transcript_ingested' background jobs:
 * 1. Fences by processing_generation.
 * 2. Fetches Zoom meeting participants and resolves speakers (with verified email matching and LLM fallback).
 * 3. Enforces cost & processing gates (duration >= 3m, distinct speakers >= 2).
 * 4. Gathers permission-filtered project candidates for routing principal.
 * 5. Evaluates project match via fast-tier LLM with prompt injection defense.
 * 6. Auto-routes if confidence >= 0.70; enters AskHost (awaiting_project_choice) if < 0.70.
 */
export async function handleTranscriptIngestedJob(
  sql: Sql,
  ports: AppPorts,
  logger: FastifyBaseLogger | Console,
  payload: MeetingTranscriptIngestedPayload
): Promise<boolean> {
  const { orgId, meetingId, processingGeneration } = payload;

  logger.info({ orgId, meetingId }, 'Starting speaker resolution and project routing for ingested transcript');

  // 1. Fetch meeting
  const [meeting] = await sql<
    Array<{
      id: string;
      org_id: string;
      status: string;
      provider_meeting_uuid: string;
      processing_generation: number;
      connection_generation: number;
    }>
  >`
    SELECT id, org_id, status, provider_meeting_uuid, processing_generation, connection_generation
    FROM meetings
    WHERE org_id = ${orgId} AND id = ${meetingId}
  `;

  if (!meeting) {
    logger.warn({ orgId, meetingId }, 'Meeting not found for transcript_ingested job');
    return false;
  }

  // Generation fence check
  if (
    processingGeneration !== undefined &&
    meeting.processing_generation !== processingGeneration
  ) {
    logger.warn(
      { orgId, meetingId, expected: processingGeneration, actual: meeting.processing_generation },
      'Aborting transcript_ingested job due to processing generation mismatch'
    );
    return false;
  }

  // Check state
  if (
    meeting.status !== 'transcript_ready' &&
    meeting.status !== 'routing' &&
    meeting.status !== 'awaiting_project_choice'
  ) {
    logger.info(
      { orgId, meetingId, status: meeting.status },
      'Meeting status is not eligible for routing evaluation'
    );
    return false;
  }

  // Set meeting status to 'routing'
  await sql`
    UPDATE meetings
    SET status = 'routing', updated_at = NOW()
    WHERE org_id = ${orgId} AND id = ${meetingId} AND status = 'transcript_ready'
  `;

  // 2. Fetch past meeting participants from Zoom
  let participants: ZoomMeetingParticipant[] = [];
  try {
    const creds = await getOrRefreshZoomCredentials(
      sql,
      ports.secretStore,
      ports.zoomClient,
      orgId
    );
    if (creds?.accessToken) {
      participants = await ports.zoomClient.listMeetingParticipants(
        creds.accessToken,
        meeting.provider_meeting_uuid
      );
    }
  } catch (err: unknown) {
    logger.warn(
      { orgId, meetingId, err: (err as Error).message },
      'Could not fetch participants from Zoom API; proceeding with empty participant list'
    );
  }

  // 3. Resolve speakers
  try {
    const speakerRes = await resolveMeetingSpeakers(sql, {
      orgId,
      meetingId,
      participants,
      llmAdapter: ports.llm,
    });
    logger.info(
      { orgId, meetingId, resolved: speakerRes.resolvedCount, unresolved: speakerRes.unresolvedCount },
      'Speaker resolution completed'
    );
  } catch (err: unknown) {
    logger.error({ orgId, meetingId, err: (err as Error).message }, 'Speaker resolution failed');
  }

  // 4. Evaluate and route meeting
  try {
    const routingRes = await evaluateAndRouteMeeting(sql, {
      orgId,
      meetingId,
      llmAdapter: ports.llm,
      expectedProcessingGeneration: meeting.processing_generation,
    });

    logger.info(
      {
        orgId,
        meetingId,
        routed: routingRes.routed,
        status: routingRes.status,
        suggestedNodeId: routingRes.suggestedNodeId,
        confidence: routingRes.confidence,
      },
      'Meeting project routing evaluation completed'
    );

    return true;
  } catch (err: unknown) {
    logger.error({ orgId, meetingId, err: (err as Error).message }, 'Project routing evaluation failed');
    return false;
  }
}
