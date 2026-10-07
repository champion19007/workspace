import type { Sql } from 'postgres';
import type {
  BlobStorePort,
  MeetingDTO,
  ZoomMeetingStatus,
  GuestConsentStatus,
  NormalizedTranscriptSegment,
  TranscriptManifest,
} from '@workspace/core';
import {
  NotFoundError,
  ValidationError,
  PreconditionFailedError,
  canTransitionMeetingStatus,
} from '@workspace/core';

interface RawMeetingRow {
  id: string;
  org_id: string;
  node_id: string | null;
  provider: string;
  provider_meeting_uuid: string;
  provider_numeric_id: string | null;
  title: string | null;
  host_id: string | null;
  zoom_host_id: string | null;
  zoom_host_email: string | null;
  scheduled_start_at: Date | string | null;
  actual_start_at: Date | string | null;
  duration_seconds: number | null;
  timezone: string | null;
  recording_completed_at: Date | string | null;
  transcript_completed_at: Date | string | null;
  has_transcript: boolean;
  has_recording: boolean;
  status: string;
  guests_present: boolean;
  consent_sent: boolean;
  skipped: boolean;
  intake_error: string | null;
  connection_generation: number;
  last_polled_at: Date | string | null;
  retry_count: number;
  version: number;
  processing_generation: number;
  guest_consent_status: string;
  raw_transcript_object_key: string | null;
  raw_transcript_checksum: string | null;
  raw_transcript_byte_count: number | null;
  transcript_retention_deadline: Date | string | null;
  source_manifest: any;
  cleanup_status: string;
  cleaned_up_at: Date | string | null;
  suggested_node_id?: string | null;
  routing_confidence?: number | string | null;
  routing_reason?: string | null;
  routing_alternatives?: any;
  routing_actor_id?: string | null;
  routing_decided_at?: Date | string | null;
  speakers_resolved?: boolean;
  speaker_resolution_metadata?: any;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RawSegmentRow {
  id: string;
  org_id: string;
  meeting_id: string;
  seq: number;
  speaker_label: string;
  user_id: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  checksum: string | null;
  source_cue_id: string | null;
  resolution_method?: string | null;
  resolution_confidence?: number | string | null;
  created_at: Date | string;
}

function mapMeeting(row: RawMeetingRow): MeetingDTO {
  return {
    id: row.id,
    orgId: row.org_id,
    nodeId: row.node_id,
    provider: 'zoom',
    providerMeetingUuid: row.provider_meeting_uuid,
    providerNumericId: row.provider_numeric_id,
    title: row.title,
    hostId: row.host_id,
    zoomHostId: row.zoom_host_id,
    zoomHostEmail: row.zoom_host_email,
    scheduledStartAt: row.scheduled_start_at ? new Date(row.scheduled_start_at).toISOString() : null,
    actualStartAt: row.actual_start_at ? new Date(row.actual_start_at).toISOString() : null,
    durationSeconds: row.duration_seconds,
    timezone: row.timezone,
    recordingCompletedAt: row.recording_completed_at ? new Date(row.recording_completed_at).toISOString() : null,
    transcriptCompletedAt: row.transcript_completed_at ? new Date(row.transcript_completed_at).toISOString() : null,
    hasTranscript: Boolean(row.has_transcript),
    hasRecording: Boolean(row.has_recording),
    status: row.status as ZoomMeetingStatus,
    guestsPresent: Boolean(row.guests_present),
    consentSent: Boolean(row.consent_sent),
    skipped: Boolean(row.skipped),
    intakeError: row.intake_error,
    connectionGeneration: row.connection_generation,
    lastPolledAt: row.last_polled_at ? new Date(row.last_polled_at).toISOString() : null,
    retryCount: row.retry_count,
    version: row.version ?? 1,
    processingGeneration: row.processing_generation ?? 1,
    guestConsentStatus: (row.guest_consent_status as GuestConsentStatus) || 'unknown',
    rawTranscriptObjectKey: row.raw_transcript_object_key,
    rawTranscriptChecksum: row.raw_transcript_checksum,
    rawTranscriptByteCount: row.raw_transcript_byte_count,
    transcriptRetentionDeadline: row.transcript_retention_deadline
      ? new Date(row.transcript_retention_deadline).toISOString()
      : null,
    sourceManifest: row.source_manifest,
    cleanupStatus: (row.cleanup_status as 'none' | 'pending' | 'completed') || 'none',
    cleanedUpAt: row.cleaned_up_at ? new Date(row.cleaned_up_at).toISOString() : null,
    suggestedNodeId: row.suggested_node_id || null,
    suggestedNodeTitle: null,
    routingConfidence: row.routing_confidence !== null && row.routing_confidence !== undefined ? Number(row.routing_confidence) : null,
    routingReason: row.routing_reason || null,
    routingAlternatives: Array.isArray(row.routing_alternatives) ? row.routing_alternatives : [],
    routingActorId: row.routing_actor_id || null,
    routingDecidedAt: row.routing_decided_at ? new Date(row.routing_decided_at).toISOString() : null,
    speakersResolved: Boolean(row.speakers_resolved),
    speakerResolutionMetadata: row.speaker_resolution_metadata || {},
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export interface IngestMeetingTranscriptParams {
  orgId: string;
  meetingId: string;
  expectedProcessingGeneration: number;
  rawTranscriptObjectKey: string;
  rawTranscriptChecksum: string;
  rawTranscriptByteCount: number;
  sourceManifest: TranscriptManifest;
  segments: NormalizedTranscriptSegment[];
}

/**
 * Persists normalized transcript segments and source manifest in a short atomic transaction.
 * Fenced by processing generation and meeting state.
 */
export async function ingestMeetingTranscript(
  sql: Sql,
  params: IngestMeetingTranscriptParams
): Promise<{ meeting: MeetingDTO; segmentsCount: number }> {
  const {
    orgId,
    meetingId,
    expectedProcessingGeneration,
    rawTranscriptObjectKey,
    rawTranscriptChecksum,
    rawTranscriptByteCount,
    sourceManifest,
    segments,
  } = params;

  return await sql.begin(async (txn) => {
    // 1. Lock meeting row for update
    const [meetingRow] = await txn<RawMeetingRow[]>`
      SELECT * FROM meetings
      WHERE org_id = ${orgId} AND id = ${meetingId}
      FOR UPDATE
    `;

    if (!meetingRow) {
      throw new NotFoundError(`Meeting with ID ${meetingId} not found in org ${orgId}`);
    }

    if (meetingRow.skipped) {
      throw new ValidationError('Meeting has been skipped; aborting transcript commit');
    }

    if (meetingRow.processing_generation !== expectedProcessingGeneration) {
      throw new ValidationError(
        `Processing generation conflict: attempt generation ${expectedProcessingGeneration} does not match current meeting generation ${meetingRow.processing_generation}`
      );
    }

    if (!canTransitionMeetingStatus(meetingRow.status as ZoomMeetingStatus, 'transcript_ready')) {
      throw new ValidationError(
        `Cannot transition meeting from status ${meetingRow.status} to transcript_ready`
      );
    }

    // 2. Delete any prior segments for this meeting (clean idempotent commit)
    await txn`
      DELETE FROM transcript_segments
      WHERE org_id = ${orgId} AND meeting_id = ${meetingId}
    `;

    // 3. Insert normalized segments
    for (const seg of segments) {
      await txn`
        INSERT INTO transcript_segments (
          org_id,
          meeting_id,
          seq,
          speaker_label,
          start_ms,
          end_ms,
          text,
          checksum,
          source_cue_id
        ) VALUES (
          ${orgId},
          ${meetingId},
          ${seg.seq},
          ${seg.speakerLabel},
          ${seg.startMs},
          ${seg.endMs},
          ${seg.text},
          ${seg.checksum},
          ${seg.sourceCueId || null}
        )
      `;
    }

    // 4. Compute 180-day retention deadline
    const retentionDeadline = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

    // 5. Update meeting record
    const [updatedRow] = await txn<RawMeetingRow[]>`
      UPDATE meetings
      SET
        status = 'transcript_ready',
        has_transcript = true,
        transcript_completed_at = now(),
        raw_transcript_object_key = ${rawTranscriptObjectKey},
        raw_transcript_checksum = ${rawTranscriptChecksum},
        raw_transcript_byte_count = ${rawTranscriptByteCount},
        transcript_retention_deadline = ${retentionDeadline.toISOString()},
        source_manifest = ${JSON.stringify(sourceManifest)}::jsonb,
        version = version + 1,
        updated_at = now()
      WHERE org_id = ${orgId} AND id = ${meetingId}
      RETURNING *
    `;

    // 6. Emit downstream transactional outbox event
    const outboxPayload = {
      orgId,
      meetingId,
      providerMeetingUuid: updatedRow!.provider_meeting_uuid,
      processingGeneration: updatedRow!.processing_generation,
      segmentCount: segments.length,
      durationMs: sourceManifest.durationMs,
      rawTranscriptObjectKey,
      emittedAt: new Date().toISOString(),
    };
    await txn`
      INSERT INTO outbox (org_id, topic, payload)
      VALUES (
        ${orgId},
        'meeting.transcript_ingested',
        ${JSON.stringify(outboxPayload)}::jsonb
      )
    `;

    return {
      meeting: mapMeeting(updatedRow!),
      segmentsCount: segments.length,
    };
  });
}

export interface SkipMeetingAndCleanupParams {
  orgId: string;
  meetingId: string;
  ifMatchVersion?: number;
  reason?: string;
  blobStore?: BlobStorePort;
}

/**
 * Skips a meeting, increments processing generation to fence active workers,
 * purges database segments and AI notes, and deletes raw transcript from blob store.
 */
export async function skipMeetingAndCleanup(
  sql: Sql,
  params: SkipMeetingAndCleanupParams
): Promise<MeetingDTO> {
  const { orgId, meetingId, ifMatchVersion, reason, blobStore } = params;

  let rawKeyToDelete: string | null = null;

  const result = await sql.begin(async (txn) => {
    // 1. Lock meeting row for update
    const [meetingRow] = await txn<RawMeetingRow[]>`
      SELECT * FROM meetings
      WHERE org_id = ${orgId} AND id = ${meetingId}
      FOR UPDATE
    `;

    if (!meetingRow) {
      throw new NotFoundError(`Meeting with ID ${meetingId} not found in org ${orgId}`);
    }

    // 2. Strong ETag OCC comparison if version specified
    if (ifMatchVersion !== undefined && meetingRow.version !== ifMatchVersion) {
      throw new PreconditionFailedError('Meeting version mismatch', {
        currentVersion: meetingRow.version,
        expectedVersion: ifMatchVersion,
        meeting: mapMeeting(meetingRow),
      });
    }

    rawKeyToDelete = meetingRow.raw_transcript_object_key;
    const nextGeneration = (meetingRow.processing_generation || 1) + 1;

    // 3. Purge database transcript segments
    await txn`
      DELETE FROM transcript_segments
      WHERE org_id = ${orgId} AND meeting_id = ${meetingId}
    `;

    // 4. Purge AI meeting notes, action items, and extraction runs if present
    await txn`
      DELETE FROM meeting_notes
      WHERE org_id = ${orgId} AND meeting_id = ${meetingId}
    `;
    await txn`
      DELETE FROM action_items
      WHERE org_id = ${orgId} AND meeting_id = ${meetingId}
    `;
    await txn`
      DELETE FROM extraction_runs
      WHERE org_id = ${orgId} AND meeting_id = ${meetingId}
    `;
    // Clean up purely system-generated notes doc, unlink any user-edited docs
    await txn`
      DELETE FROM docs
      WHERE org_id = ${orgId} AND source_meeting_id = ${meetingId} AND created_by IS NULL
    `;
    await txn`
      UPDATE docs
      SET source_meeting_id = NULL
      WHERE org_id = ${orgId} AND source_meeting_id = ${meetingId}
    `;

    // 5. Update meeting to skipped with completed cleanup
    const [updatedRow] = await txn<RawMeetingRow[]>`
      UPDATE meetings
      SET
        skipped = true,
        status = 'skipped',
        processing_generation = ${nextGeneration},
        cleanup_status = 'completed',
        cleaned_up_at = now(),
        raw_transcript_object_key = NULL,
        raw_transcript_checksum = NULL,
        raw_transcript_byte_count = NULL,
        source_manifest = NULL,
        version = version + 1,
        updated_at = now()
      WHERE org_id = ${orgId} AND id = ${meetingId}
      RETURNING *
    `;

    // 6. Record outbox event
    const skipPayload = {
      orgId,
      meetingId,
      processingGeneration: nextGeneration,
      cleanupStatus: 'completed',
      reason: reason || null,
      cleanedUpAt: new Date().toISOString(),
    };
    await txn`
      INSERT INTO outbox (org_id, topic, payload)
      VALUES (
        ${orgId},
        'meeting.skipped',
        ${JSON.stringify(skipPayload)}::jsonb
      )
    `;

    return mapMeeting(updatedRow!);
  });

  // 7. Delete raw transcript blob from storage outside the DB transaction
  if (rawKeyToDelete && blobStore) {
    try {
      await blobStore.deleteObject(rawKeyToDelete);
    } catch (err) {
      // Blob store deletion error should be logged but does not abort skip commit
      console.error(`Failed to delete raw transcript object ${rawKeyToDelete}:`, err);
    }
  }

  return result;
}

export interface GetMeetingTranscriptParams {
  orgId: string;
  meetingId: string;
  limit?: number;
  offset?: number;
  search?: string;
}

export interface GetMeetingTranscriptResult {
  segments: NormalizedTranscriptSegment[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Retrieves normalized evidence segments for a meeting with pagination and search.
 */
export async function getMeetingTranscript(
  sql: Sql,
  params: GetMeetingTranscriptParams
): Promise<GetMeetingTranscriptResult> {
  const { orgId, meetingId, limit = 100, offset = 0, search } = params;

  // 1. Verify meeting exists
  const [meetingRow] = await sql<RawMeetingRow[]>`
    SELECT id, status, skipped FROM meetings
    WHERE org_id = ${orgId} AND id = ${meetingId}
    LIMIT 1
  `;

  if (!meetingRow) {
    throw new NotFoundError(`Meeting with ID ${meetingId} not found`);
  }

  let rows: RawSegmentRow[];
  let countResult: Array<{ count: string | number }>;

  if (search && search.trim().length > 0) {
    const pattern = `%${search.trim()}%`;
    rows = await sql<RawSegmentRow[]>`
      SELECT * FROM transcript_segments
      WHERE org_id = ${orgId}
        AND meeting_id = ${meetingId}
        AND (text ILIKE ${pattern} OR speaker_label ILIKE ${pattern})
      ORDER BY seq ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    countResult = await sql<Array<{ count: string | number }>>`
      SELECT count(*) as count FROM transcript_segments
      WHERE org_id = ${orgId}
        AND meeting_id = ${meetingId}
        AND (text ILIKE ${pattern} OR speaker_label ILIKE ${pattern})
    `;
  } else {
    rows = await sql<RawSegmentRow[]>`
      SELECT * FROM transcript_segments
      WHERE org_id = ${orgId} AND meeting_id = ${meetingId}
      ORDER BY seq ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    countResult = await sql<Array<{ count: string | number }>>`
      SELECT count(*) as count FROM transcript_segments
      WHERE org_id = ${orgId} AND meeting_id = ${meetingId}
    `;
  }

  const total = parseInt(String(countResult[0]?.count || '0'), 10);

  const segments: NormalizedTranscriptSegment[] = rows.map((r) => ({
    seq: r.seq,
    speakerLabel: r.speaker_label,
    startMs: r.start_ms,
    endMs: r.end_ms,
    text: r.text,
    checksum: r.checksum || '',
    sourceCueId: r.source_cue_id || undefined,
  }));

  return {
    segments,
    total,
    limit,
    offset,
    hasMore: offset + segments.length < total,
  };
}

/**
 * Retrieves single meeting by ID.
 */
export async function getMeetingById(
  sql: Sql,
  orgId: string,
  meetingId: string
): Promise<MeetingDTO | null> {
  const [row] = await sql<RawMeetingRow[]>`
    SELECT * FROM meetings
    WHERE org_id = ${orgId} AND id = ${meetingId}
    LIMIT 1
  `;

  return row ? mapMeeting(row) : null;
}

/**
 * Discovers meetings that are currently ready_for_transcript_retrieval and not skipped.
 * Used for worker startup recovery.
 */
export async function listPendingReadyMeetings(
  sql: Sql,
  limit: number = 50
): Promise<MeetingDTO[]> {
  const rows = await sql<RawMeetingRow[]>`
    SELECT * FROM meetings
    WHERE status = 'ready_for_transcript_retrieval'
      AND skipped = false
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;

  return rows.map(mapMeeting);
}
