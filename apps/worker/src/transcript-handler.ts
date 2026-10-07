import crypto from 'crypto';
import type {
  AppPorts,
  MeetingTranscriptReadyPayload,
  ZoomIntegrationStatus,
  ZoomHostConsentStatus,
  GuestConsentStatus,
  VttSourceInput,
} from '@workspace/core';
import {
  evaluateMeetingEligibility,
  normalizeTranscripts,
  generateUuidV7,
} from '@workspace/core';
import {
  ingestMeetingTranscript,
  getOrRefreshZoomCredentials,
  listPendingReadyMeetings,
  type Sql,
} from '@workspace/db';

interface RawMeetingForHandler {
  id: string;
  org_id: string;
  provider: string;
  provider_meeting_uuid: string;
  zoom_host_id: string | null;
  status: string;
  guests_present: boolean;
  skipped: boolean;
  connection_generation: number;
  processing_generation: number;
  guest_consent_status: string;
  transcript_retention_deadline: Date | string | null;
}

interface RawIntegrationRow {
  id: string;
  org_id: string;
  provider: string;
  status: string;
  connection_generation: number;
}

interface RawHostConsentRow {
  id: string;
  consent_status: string;
  admin_disabled: boolean;
}

/**
 * Handles 'meeting.transcript_ready' background queue job.
 * Gated by consent and generation checks, retrieves WebVTT files with Bearer token,
 * preserves raw source in BlobStore, normalizes segments, and commits atomically.
 */
export async function handleTranscriptReadyJob(
  sql: Sql,
  ports: AppPorts,
  logger: any,
  data: MeetingTranscriptReadyPayload
): Promise<boolean> {
  const { orgId, meetingId } = data;

  logger.info({ orgId, meetingId }, 'Processing meeting.transcript_ready queue job');

  // 1. Fetch meeting row
  const [meeting] = await sql<RawMeetingForHandler[]>`
    SELECT
      id,
      org_id,
      provider,
      provider_meeting_uuid,
      zoom_host_id,
      status,
      guests_present,
      skipped,
      connection_generation,
      processing_generation,
      guest_consent_status,
      transcript_retention_deadline
    FROM meetings
    WHERE org_id = ${orgId} AND id = ${meetingId}
    LIMIT 1
  `;

  if (!meeting) {
    logger.warn({ orgId, meetingId }, 'Meeting not found for transcript retrieval; skipping');
    return false;
  }

  if (meeting.skipped) {
    logger.info({ orgId, meetingId }, 'Meeting was explicitly skipped; ignoring transcript retrieval');
    return false;
  }

  // Idempotency: If already transcript_ready, routing, extracting, or completed, do not re-ingest
  if (['transcript_ready', 'routing', 'extracting', 'completed'].includes(meeting.status)) {
    logger.info({ orgId, meetingId, status: meeting.status }, 'Meeting already transcribed or in advanced state; skipping');
    return false;
  }

  // 2. Fetch active Zoom integration
  const [integration] = await sql<RawIntegrationRow[]>`
    SELECT id, org_id, provider, status, connection_generation
    FROM integrations
    WHERE org_id = ${orgId} AND provider = 'zoom'
    LIMIT 1
  `;

  if (!integration) {
    logger.warn({ orgId }, 'No Zoom integration configured for organization');
    await sql`
      UPDATE meetings
      SET status = 'connection_requires_reconnection',
          intake_error = 'Zoom integration not configured',
          updated_at = now()
      WHERE id = ${meetingId} AND org_id = ${orgId}
    `;
    return false;
  }

  // 3. Fetch host consent record
  let hostConsent: RawHostConsentRow | null = null;
  if (meeting.zoom_host_id) {
    const [hc] = await sql<RawHostConsentRow[]>`
      SELECT id, consent_status, admin_disabled
      FROM zoom_host_consents
      WHERE org_id = ${orgId} AND zoom_user_id = ${meeting.zoom_host_id}
      LIMIT 1
    `;
    hostConsent = hc || null;
  }

  // 4. Consent and eligibility gating before download
  const eligibility = evaluateMeetingEligibility({
    connectionStatus: integration.status as ZoomIntegrationStatus,
    hostConsent: hostConsent
      ? {
          consentStatus: hostConsent.consent_status as ZoomHostConsentStatus,
          adminDisabled: Boolean(hostConsent.admin_disabled),
        }
      : null,
    meetingExcluded: meeting.skipped,
    hasExternalParticipants: meeting.guests_present,
    guestConsentStatus: (meeting.guest_consent_status as GuestConsentStatus) || 'unknown',
    connectionGeneration: meeting.connection_generation,
    expectedConnectionGeneration: integration.connection_generation,
    retentionDeadline: meeting.transcript_retention_deadline,
  });

  if (!eligibility.eligible) {
    logger.warn({ orgId, meetingId, reason: eligibility.reason }, 'Meeting ineligible for transcript retrieval');

    let targetStatus = 'failed';
    if (meeting.guest_consent_status === 'pending' || meeting.guest_consent_status === 'unknown') {
      targetStatus = 'pending_consent';
    } else if (hostConsent?.consent_status === 'opted_out' || hostConsent?.admin_disabled) {
      targetStatus = 'skipped';
    } else if (integration.status !== 'connected' || integration.connection_generation !== meeting.connection_generation) {
      targetStatus = 'connection_requires_reconnection';
    }

    await sql`
      UPDATE meetings
      SET status = ${targetStatus},
          intake_error = ${eligibility.reason || 'Meeting ineligible for transcription'},
          updated_at = now()
      WHERE id = ${meetingId} AND org_id = ${orgId}
    `;
    return false;
  }

  // 5. Transition to ingesting
  await sql`
    UPDATE meetings
    SET status = 'ingesting',
        updated_at = now()
    WHERE id = ${meetingId} AND org_id = ${orgId}
  `;

  // 6. Retrieve credentials from Secret Store
  let creds;
  try {
    creds = await getOrRefreshZoomCredentials(
      sql,
      ports.secretStore,
      ports.zoomClient,
      orgId
    );
  } catch (err: any) {
    logger.error({ orgId, err: err.message }, 'Failed to obtain fresh Zoom credentials');
    await sql`
      UPDATE meetings
      SET status = 'connection_requires_reconnection',
          intake_error = 'Failed to refresh Zoom credentials',
          updated_at = now()
      WHERE id = ${meetingId} AND org_id = ${orgId}
    `;
    return false;
  }

  // 7. Fetch recording metadata from Zoom API
  let metadata;
  try {
    metadata = await ports.zoomClient.getMeetingRecordings(creds.accessToken, meeting.provider_meeting_uuid);
  } catch (err: any) {
    logger.error({ orgId, meetingId, err: err.message }, 'Failed to fetch meeting recordings from Zoom API');
    await sql`
      UPDATE meetings
      SET status = 'failed',
          intake_error = ${`Zoom recordings fetch error: ${err.message}`},
          updated_at = now()
      WHERE id = ${meetingId} AND org_id = ${orgId}
    `;
    return false;
  }

  // 8. Select completed transcript files
  const transcriptFiles = (metadata.recordingFiles || []).filter((f) => {
    const isTranscript =
      f.fileType === 'TRANSCRIPT' ||
      f.recordingType === 'audio_transcript' ||
      f.fileExtension?.toUpperCase() === 'VTT' ||
      f.downloadUrl?.includes('.vtt');
    const isCompleted = f.status === 'completed' || !f.status || f.status === 'COMPLETED';
    return isTranscript && isCompleted && Boolean(f.downloadUrl);
  });

  if (transcriptFiles.length === 0) {
    logger.warn({ orgId, meetingId }, 'No completed transcript file found in Zoom recordings');
    await sql`
      UPDATE meetings
      SET status = 'waiting_for_transcript',
          intake_error = 'No completed transcript file found in Zoom recordings metadata',
          updated_at = now()
      WHERE id = ${meetingId} AND org_id = ${orgId}
    `;
    return false;
  }

  // 9. Download transcript file(s)
  const sourceInputs: VttSourceInput[] = [];
  try {
    for (const file of transcriptFiles) {
      const vttText = await ports.zoomClient.downloadTranscriptFile(creds.accessToken, file.downloadUrl!);

      let fileOffsetMs = 0;
      if (file.recordingStart && metadata.startTime) {
        const fileStart = new Date(file.recordingStart).getTime();
        const meetingStart = new Date(metadata.startTime).getTime();
        if (!isNaN(fileStart) && !isNaN(meetingStart) && fileStart > meetingStart) {
          fileOffsetMs = fileStart - meetingStart;
        }
      }

      sourceInputs.push({
        vttContent: vttText,
        fileOffsetMs,
        filename: `${file.id}.vtt`,
      });
    }
  } catch (downloadErr: any) {
    logger.error({ orgId, meetingId, err: downloadErr.message }, 'Failed to download transcript file from Zoom');
    await sql`
      UPDATE meetings
      SET status = 'failed',
          intake_error = ${`Transcript download failed: ${downloadErr.message}`},
          updated_at = now()
      WHERE id = ${meetingId} AND org_id = ${orgId}
    `;
    return false;
  }

  // 10. Store raw transcript in BlobStore
  const attemptId = generateUuidV7();
  const rawTranscriptObjectKey = `raw-transcripts/${orgId}/${meetingId}/${attemptId}.vtt`;
  const combinedRaw = sourceInputs.map((s) => s.vttContent).join('\n\n--- FILE_BOUNDARY ---\n\n');
  const rawBytes = Buffer.from(combinedRaw, 'utf-8');
  const rawChecksum = crypto.createHash('sha256').update(combinedRaw).digest('hex');

  try {
    await ports.blobStore.putObject({
      key: rawTranscriptObjectKey,
      body: new Uint8Array(rawBytes),
      contentType: 'text/vtt; charset=utf-8',
      metadata: {
        orgId,
        meetingId,
        attemptId,
      },
    });
  } catch (blobErr: any) {
    logger.error({ orgId, meetingId, err: blobErr.message }, 'Failed to store raw transcript in BlobStore');
    await sql`
      UPDATE meetings
      SET status = 'failed',
          intake_error = 'Failed to store raw transcript in storage',
          updated_at = now()
      WHERE id = ${meetingId} AND org_id = ${orgId}
    `;
    return false;
  }

  // 11. Normalize WebVTT into evidence anchors
  const { segments, manifest } = normalizeTranscripts(sourceInputs, rawTranscriptObjectKey);

  // 12. Atomic commit with compensation cleanup
  try {
    await ingestMeetingTranscript(sql, {
      orgId,
      meetingId,
      expectedProcessingGeneration: meeting.processing_generation,
      rawTranscriptObjectKey,
      rawTranscriptChecksum: rawChecksum,
      rawTranscriptByteCount: rawBytes.byteLength,
      sourceManifest: manifest,
      segments,
    });

    logger.info(
      { orgId, meetingId, segmentsCount: segments.length, durationMs: manifest.durationMs },
      'Successfully ingested and normalized meeting transcript'
    );
    return true;
  } catch (commitErr: any) {
    logger.error(
      { orgId, meetingId, err: commitErr.message },
      'Failed to commit transcript segments to database; initiating compensation cleanup'
    );

    // Compensation: delete stored raw blob object if database commit failed
    try {
      await ports.blobStore.deleteObject(rawTranscriptObjectKey);
      logger.info({ rawTranscriptObjectKey }, 'Compensation deletion of raw transcript object succeeded');
    } catch (cleanupErr: any) {
      logger.error({ rawTranscriptObjectKey, cleanupErr }, 'Compensation blob cleanup failed');
    }

    throw commitErr;
  }
}

/**
 * Recovers meetings that were previously set to ready_for_transcript_retrieval
 * but have not yet been consumed.
 */
export async function recoverReadyMeetings(
  sql: Sql,
  ports: AppPorts,
  logger: any,
  limit: number = 20
): Promise<number> {
  const pending = await listPendingReadyMeetings(sql, limit);
  let processed = 0;

  for (const m of pending) {
    try {
      const ok = await handleTranscriptReadyJob(sql, ports, logger, {
        orgId: m.orgId,
        meetingId: m.id,
        providerMeetingUuid: m.providerMeetingUuid,
        connectionGeneration: m.connectionGeneration,
        processingGeneration: m.processingGeneration,
        emittedAt: new Date().toISOString(),
      });
      if (ok) processed++;
    } catch (err: any) {
      logger.error({ meetingId: m.id, err: err.message }, 'Error in recovery sweep for ready meeting');
    }
  }

  return processed;
}
