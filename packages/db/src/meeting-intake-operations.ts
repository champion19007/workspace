import type { Sql } from 'postgres';
import type {
  SecretStorePort,
  ZoomClientPort,
  MeetingDTO,
  ZoomMeetingStatus,
  OrgRole,
} from '@workspace/core';
import {
  evaluateMeetingEligibility,
  canTransitionMeetingStatus,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  isReadOnlyRole,
} from '@workspace/core';
import { getOrRefreshZoomCredentials } from './zoom-operations.js';
import { getMeetingById } from './transcript-operations.js';
import { loginSql, tenantSql } from './client.js';

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
    guestConsentStatus: (row.guest_consent_status as any) || 'unknown',
    rawTranscriptObjectKey: row.raw_transcript_object_key,
    rawTranscriptChecksum: row.raw_transcript_checksum,
    rawTranscriptByteCount: row.raw_transcript_byte_count,
    transcriptRetentionDeadline: row.transcript_retention_deadline ? new Date(row.transcript_retention_deadline).toISOString() : null,
    sourceManifest: row.source_manifest,
    cleanupStatus: (row.cleanup_status as any) || 'none',
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

/**
 * Processes authentic Zoom webhook events in a single atomic database transaction.
 * Enforces end-to-end idempotency, state regression protection, and zero credential leakage.
 */
export async function processZoomWebhookEvent(
  db: Sql,
  secretStore: SecretStorePort,
  params: {
    event: string;
    eventTs: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any;
  }
): Promise<{
  received: boolean;
  status: string;
  orgId?: string;
  meetingId?: string;
  meetingStatus?: ZoomMeetingStatus;
}> {
  const { event, eventTs, payload } = params;
  const accountId = payload?.account_id;

  if (!accountId) {
    return { received: true, status: 'ignored_missing_account_id' };
  }

  // 1. Handle app_deauthorized event. The account is resolved across organizations, so the whole state change
  //    (receipt, disconnect + generation bump, parked meetings, outbox event) runs in sys_zoom_deauthorize.
  if (event === 'app_deauthorized') {
    const deauthTime = payload?.deauthorization_time || new Date(eventTs).toISOString();
    const eventId = `deauth_${accountId}_${eventTs}`;

    const [result] = await loginSql(db)<Array<{ outcome: string; org_id: string | null; secret_arn: string | null }>>`
      SELECT * FROM sys_zoom_deauthorize(${accountId}, ${eventId}, ${new Date(eventTs).toISOString()}, ${deauthTime})
    `;

    if (result?.outcome !== 'deauthorized') {
      return { received: true, status: result?.outcome ?? 'ignored_unmapped_account' };
    }

    // Invalidate and delete secret from SecretStore immediately
    try {
      await secretStore.deleteSecret(result.secret_arn!);
    } catch {
      // Best-effort cleanup
    }

    return { received: true, status: 'deauthorized', orgId: result.org_id! };
  }

  // 2. Handle meeting recording events: recording.completed and recording.transcript_completed
  if (event === 'recording.completed' || event === 'recording.transcript_completed') {
    const obj = payload?.object;
    if (!obj || !obj.uuid) {
      return { received: true, status: 'ignored_missing_meeting_object' };
    }

    const meetingUuid = String(obj.uuid);
    const numericId = obj.id ? String(obj.id) : null;
    const hostId = obj.host_id ? String(obj.host_id) : null;
    const hostEmail = obj.host_email ? String(obj.host_email) : null;
    const topic = obj.topic ? String(obj.topic) : 'Untitled Zoom Meeting';
    const startTimeISO = obj.start_time ? new Date(obj.start_time).toISOString() : new Date().toISOString();
    const durationSeconds = typeof obj.duration === 'number' ? obj.duration * 60 : null;
    const timezone = obj.timezone ? String(obj.timezone) : null;
    const eventId = `${event}_${meetingUuid}_${eventTs}`;

    // The organization behind this Zoom account (resolved across organizations)
    const integrations = await loginSql(db)<Array<{
      id: string;
      org_id: string;
      status: string;
      connection_generation: number;
    }>>`
      SELECT id, org_id, status, connection_generation FROM sys_zoom_account_integration(${accountId})
    `;

    if (integrations.length === 0) {
      // Record intake receipt without exposing account mapping
      await loginSql(db)`
        SELECT sys_zoom_record_unmapped_event(${accountId}, ${event}, ${eventId}, ${meetingUuid})
      `;
      return { received: true, status: 'ignored_unmapped_account' };
    }

    const integration = integrations[0]!;
    // Intake on behalf of the integration (no acting user); the poller passes its system-scoped client.
    const sql = tenantSql(db, { orgId: integration.org_id });

    // Check host consent
    const hostConsents = await sql<Array<{
      consent_status: string;
      admin_disabled: boolean;
      consent_timestamp: Date | string | null;
      user_id: string | null;
    }>>`
      SELECT consent_status, admin_disabled, consent_timestamp, user_id
      FROM zoom_host_consents
      WHERE org_id = ${integration.org_id}
        AND zoom_user_id = ${hostId || ''}
      LIMIT 1
    `;

    const hostConsent = hostConsents.length > 0 ? hostConsents[0]! : null;
    // Verified identity binding: the workspace user who claimed this Zoom host through authenticated
    // self-service consent. Never derived from an email comparison.
    const boundHostUserId = hostConsent?.user_id ?? null;

    // Check if transcript file exists in recording_files
    const recordingFiles = Array.isArray(obj.recording_files) ? obj.recording_files : [];
    const hasTranscriptFile =
      event === 'recording.transcript_completed' ||
      recordingFiles.some(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (f: any) =>
          f.file_type === 'TRANSCRIPT' ||
          (typeof f.file_extension === 'string' && f.file_extension.toUpperCase() === 'VTT')
      );

    // Evaluate host eligibility
    const eligibility = evaluateMeetingEligibility({
      connectionStatus: integration.status as 'connected' | 'disconnected' | 'needs_reauthorization' | 'degraded',
      hostConsent: hostConsent
        ? {
            consentStatus: hostConsent.consent_status as 'opted_in' | 'opted_out' | 'unknown',
            adminDisabled: hostConsent.admin_disabled,
          }
        : null,
    });

    // Check pre-opt-in boundary
    let isPreOptIn = false;
    if (hostConsent?.consent_timestamp && obj.start_time) {
      const meetingStart = new Date(obj.start_time).getTime();
      const consentTime = new Date(hostConsent.consent_timestamp).getTime();
      if (meetingStart < consentTime) {
        isPreOptIn = true;
      }
    }

    // Determine target lifecycle status
    let targetStatus: ZoomMeetingStatus;
    let intakeError: string | null = null;

    if (!eligibility.eligible) {
      if (hostConsent?.consent_status === 'opted_out' || hostConsent?.admin_disabled) {
        targetStatus = 'skipped';
        intakeError = eligibility.reason || 'Host opted out or administrative processing disabled';
      } else {
        targetStatus = 'pending_consent';
        intakeError = eligibility.reason || 'Pending host consent';
      }
    } else if (isPreOptIn) {
      targetStatus = 'skipped';
      intakeError = 'Meeting occurred prior to host opt-in consent';
    } else if (hasTranscriptFile) {
      targetStatus = 'ready_for_transcript_retrieval';
    } else {
      targetStatus = 'waiting_for_transcript';
    }

    // Execute atomic upsert and outbox insertion in one database transaction
    const savedMeeting = await sql.begin(async (txn) => {
      // 1. Deduplication check in receipt table
      const receiptRows = await txn<Array<{ id: string }>>`
        INSERT INTO zoom_webhook_events (org_id, account_id, event_type, event_id, provider_meeting_uuid)
        VALUES (${integration.org_id}, ${accountId}, ${event}, ${eventId}, ${meetingUuid})
        ON CONFLICT (account_id, event_type, event_id) DO NOTHING
        RETURNING id
      `;

      const isDuplicateReceipt = receiptRows.length === 0;

      // 2. Lock existing meeting row if present
      const existingRows = await txn<RawMeetingRow[]>`
        SELECT * FROM meetings
        WHERE org_id = ${integration.org_id}
          AND provider = 'zoom'
          AND provider_meeting_uuid = ${meetingUuid}
        FOR UPDATE
      `;

      let finalStatus: ZoomMeetingStatus = targetStatus;
      let shouldEmitReadyOutbox = false;

      let resultRow: RawMeetingRow;

      if (existingRows.length > 0) {
        const existing = existingRows[0]!;

        // State machine guard: Do NOT regress advanced state or revive skipped tombstones
        if (!canTransitionMeetingStatus(existing.status as ZoomMeetingStatus, targetStatus)) {
          finalStatus = existing.status as ZoomMeetingStatus;
        }

        // If advancing to ready_for_transcript_retrieval for the first time
        if (finalStatus === 'ready_for_transcript_retrieval' && existing.status !== 'ready_for_transcript_retrieval') {
          shouldEmitReadyOutbox = true;
        }

        const updatedRows = await txn<RawMeetingRow[]>`
          UPDATE meetings
          SET
            title = COALESCE(${topic}, title),
            provider_numeric_id = COALESCE(${numericId}, provider_numeric_id),
            zoom_host_id = COALESCE(${hostId}, zoom_host_id),
            zoom_host_email = COALESCE(${hostEmail}, zoom_host_email),
            host_id = COALESCE(${boundHostUserId}, host_id),
            actual_start_at = COALESCE(${startTimeISO}, actual_start_at),
            duration_seconds = COALESCE(${durationSeconds}, duration_seconds),
            timezone = COALESCE(${timezone}, timezone),
            has_transcript = (has_transcript OR ${hasTranscriptFile}),
            recording_completed_at = CASE
              WHEN ${event === 'recording.completed'} THEN now()
              ELSE recording_completed_at
            END,
            transcript_completed_at = CASE
              WHEN ${event === 'recording.transcript_completed' || hasTranscriptFile} THEN now()
              ELSE transcript_completed_at
            END,
            status = ${finalStatus},
            skipped = ${finalStatus === 'skipped'},
            intake_error = ${intakeError},
            connection_generation = ${integration.connection_generation},
            updated_at = now()
          WHERE id = ${existing.id}
          RETURNING *
        `;
        resultRow = updatedRows[0]!;
      } else {
        // Insert new meeting row
        if (finalStatus === 'ready_for_transcript_retrieval') {
          shouldEmitReadyOutbox = true;
        }

        const insertedRows = await txn<RawMeetingRow[]>`
          INSERT INTO meetings (
            org_id,
            provider,
            provider_meeting_uuid,
            provider_numeric_id,
            title,
            zoom_host_id,
            zoom_host_email,
            host_id,
            actual_start_at,
            duration_seconds,
            timezone,
            has_transcript,
            has_recording,
            recording_completed_at,
            transcript_completed_at,
            status,
            skipped,
            intake_error,
            connection_generation
          ) VALUES (
            ${integration.org_id},
            'zoom',
            ${meetingUuid},
            ${numericId},
            ${topic},
            ${hostId},
            ${hostEmail},
            ${boundHostUserId},
            ${startTimeISO},
            ${durationSeconds},
            ${timezone},
            ${hasTranscriptFile},
            true,
            CASE WHEN ${event === 'recording.completed'} THEN now() ELSE NULL END,
            CASE WHEN ${event === 'recording.transcript_completed' || hasTranscriptFile} THEN now() ELSE NULL END,
            ${finalStatus},
            ${finalStatus === 'skipped'},
            ${intakeError},
            ${integration.connection_generation}
          )
          RETURNING *
        `;
        resultRow = insertedRows[0]!;
      }

      // 3. Emit downstream outbox command only when transitioning to ready_for_transcript_retrieval
      if (shouldEmitReadyOutbox && !isDuplicateReceipt) {
        await txn`
          INSERT INTO outbox (org_id, topic, payload)
          VALUES (
            ${integration.org_id},
            'meeting.transcript_ready',
            ${JSON.stringify({
              meetingId: resultRow.id,
              orgId: integration.org_id,
              provider: 'zoom',
              providerMeetingUuid: resultRow.provider_meeting_uuid,
              providerNumericId: resultRow.provider_numeric_id,
              zoomHostId: resultRow.zoom_host_id,
              connectionGeneration: integration.connection_generation,
              readyAt: new Date().toISOString(),
            })}::jsonb
          )
        `;
      }

      return resultRow;
    });

    return {
      received: true,
      status: 'processed',
      orgId: integration.org_id,
      meetingId: savedMeeting.id,
      meetingStatus: savedMeeting.status as ZoomMeetingStatus,
    };
  }

  return { received: true, status: 'ignored_unsupported_event_type' };
}

/**
 * Organizations with a connected Zoom integration, for the fallback poller (sys_zoom_poll_orgs entry point,
 * worker only). Each organization is then scanned in its own system context by pollZoomRecordingsForOrg.
 */
export async function listConnectedZoomOrgs(sql: Sql): Promise<string[]> {
  const rows = await loginSql(sql)<Array<{ org_id: string }>>`SELECT sys_zoom_poll_orgs() AS org_id`;
  return rows.map((r) => r.org_id);
}

export interface PollZoomRecordingsResult {
  scanned: boolean;
  discoveredCount: number;
  advancedCount: number;
  reason?: string;
}

/**
 * Thirty-minute polling fallback scan for an organization's active Zoom integration.
 * Queries recent recordings within an incremental window with 2-hour overlap,
 * rechecks meetings whose transcripts were pending, and advances checkpoints durably.
 */
export async function pollZoomRecordingsForOrg(
  db: Sql,
  secretStore: SecretStorePort,
  zoomClient: ZoomClientPort,
  params: {
    orgId: string;
    workerId: string;
  }
): Promise<PollZoomRecordingsResult> {
  const { orgId, workerId } = params;
  const sql = tenantSql(db, { orgId, system: true });

  // 1. Transaction-level advisory lock to serialize workers for this organization
  const lockRows = await sql<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(hashtext('zoom_poll:' || ${orgId})) AS locked
  `;

  if (!lockRows[0]?.locked) {
    return { scanned: false, discoveredCount: 0, advancedCount: 0, reason: 'concurrent_poll_in_progress' };
  }

  // 2. Fetch active Zoom integration
  const integrations = await sql<Array<{
    id: string;
    org_id: string;
    account_id: string;
    status: string;
    connection_generation: number;
  }>>`
    SELECT id, org_id, account_id, status, connection_generation
    FROM integrations
    WHERE org_id = ${orgId}
      AND provider = 'zoom'
      AND status = 'connected'
    LIMIT 1
  `;

  if (integrations.length === 0) {
    return { scanned: false, discoveredCount: 0, advancedCount: 0, reason: 'integration_not_connected' };
  }

  const integration = integrations[0]!;

  // 3. Obtain valid credentials via automated refresh coordinator
  let credentials;
  try {
    credentials = await getOrRefreshZoomCredentials(sql, secretStore, zoomClient, orgId);
  } catch (credErr) {
    return { scanned: false, discoveredCount: 0, advancedCount: 0, reason: (credErr as Error).message };
  }

  // 4. Read or initialize poll checkpoint
  const checkpoints = await sql<Array<{
    id: string;
    last_scanned_at: Date;
    cursor: string | null;
  }>>`
    INSERT INTO zoom_poll_checkpoints (org_id, account_id, last_scanned_at, lease_owner)
    VALUES (${orgId}, ${integration.account_id}, now() - interval '24 hours', ${workerId})
    ON CONFLICT (org_id, account_id) DO UPDATE SET
      lease_owner = ${workerId},
      updated_at = now()
    RETURNING id, last_scanned_at, cursor
  `;

  const checkpoint = checkpoints[0]!;

  // 5. Compute incremental scan window with 2-hour overlap
  const now = new Date();
  const lastScanned = new Date(checkpoint.last_scanned_at);
  const scanFromDate = new Date(lastScanned.getTime() - 2 * 60 * 60 * 1000); // 2 hours overlap
  const fromStr = scanFromDate.toISOString().slice(0, 10); // YYYY-MM-DD
  const toStr = now.toISOString().slice(0, 10);

  // 6. List opted-in hosts
  const optedInHosts = await sql<Array<{ zoom_user_id: string; zoom_email: string }>>`
    SELECT zoom_user_id, zoom_email
    FROM zoom_host_consents
    WHERE org_id = ${orgId}
      AND consent_status = 'opted_in'
      AND admin_disabled = false
  `;

  let discoveredCount = 0;
  let advancedCount = 0;

  // 7. Query recordings for each eligible host
  for (const host of optedInHosts) {
    try {
      const recordingsRes = await zoomClient.listUserRecordings(credentials.accessToken, host.zoom_user_id, {
        from: fromStr,
        to: toStr,
        pageSize: 30,
        nextPageToken: checkpoint.cursor || undefined,
      });

      for (const mtg of recordingsRes.meetings) {
        const fakePayload = {
          account_id: integration.account_id,
          object: {
            id: mtg.id,
            uuid: mtg.uuid,
            host_id: host.zoom_user_id,
            host_email: host.zoom_email,
            topic: mtg.topic,
            start_time: mtg.startTime,
            duration: mtg.duration,
            timezone: mtg.timezone,
            recording_files: mtg.recordingFiles,
          },
        };

        const result = await processZoomWebhookEvent(sql, secretStore, {
          event: mtg.recordingFiles.some((f) => f.fileType === 'TRANSCRIPT' || f.fileExtension === 'VTT')
            ? 'recording.transcript_completed'
            : 'recording.completed',
          eventTs: Date.now(),
          payload: fakePayload,
        });

        if (result.status === 'processed') {
          discoveredCount++;
          if (result.meetingStatus === 'ready_for_transcript_retrieval') {
            advancedCount++;
          }
        }
      }
    } catch (pollErr) {
      // Record error on checkpoint
      await sql`
        UPDATE zoom_poll_checkpoints
        SET error_count = error_count + 1,
            last_error = ${(pollErr as Error).message},
            updated_at = now()
        WHERE id = ${checkpoint.id}
      `;
    }
  }

  // 8. Recheck existing meetings whose transcripts are still pending
  const pendingMeetings = await sql<Array<{
    id: string;
    provider_meeting_uuid: string;
  }>>`
    SELECT id, provider_meeting_uuid
    FROM meetings
    WHERE org_id = ${orgId}
      AND provider = 'zoom'
      AND status = 'waiting_for_transcript'
      AND created_at > now() - interval '7 days'
    LIMIT 20
  `;

  for (const pending of pendingMeetings) {
    try {
      const rec = await zoomClient.getMeetingRecordings(credentials.accessToken, pending.provider_meeting_uuid);
      const hasTranscript = rec.recordingFiles.some(
        (f) => f.fileType === 'TRANSCRIPT' || f.fileExtension.toUpperCase() === 'VTT'
      );

      if (hasTranscript) {
        await sql.begin(async (txn) => {
          await txn`
            UPDATE meetings
            SET status = 'ready_for_transcript_retrieval',
                has_transcript = true,
                transcript_completed_at = now(),
                updated_at = now()
            WHERE id = ${pending.id}
          `;

          await txn`
            INSERT INTO outbox (org_id, topic, payload)
            VALUES (
              ${orgId},
              'meeting.transcript_ready',
              ${JSON.stringify({
                meetingId: pending.id,
                orgId,
                provider: 'zoom',
                providerMeetingUuid: pending.provider_meeting_uuid,
                readyAt: new Date().toISOString(),
              })}::jsonb
            )
          `;
        });
        advancedCount++;
      }
    } catch {
      // Ignore not ready
    }
  }

  // 9. Advance checkpoint durably
  await sql`
    UPDATE zoom_poll_checkpoints
    SET last_scanned_at = now(),
        cursor = NULL,
        lease_owner = NULL,
        error_count = 0,
        last_error = NULL,
        updated_at = now()
    WHERE id = ${checkpoint.id}
  `;

  return {
    scanned: true,
    discoveredCount,
    advancedCount,
  };
}

/**
 * Lists meetings for an organization enforcing RBAC boundaries.
 * Organization Owners and Admins can see all meetings.
 * Regular Members can only view meetings where they are the verified host.
 */
export async function listOrgMeetings(
  db: Sql,
  params: {
    orgId: string;
    userId: string;
    role: OrgRole;
    status?: string;
    query?: string;
    limit?: number;
    offset?: number;
  }
): Promise<MeetingDTO[]> {
  const { orgId, userId, role, status, query, limit = 50, offset = 0 } = params;
  const sql = tenantSql(db, { orgId, userId, role });

  // Viewers cannot inspect unrouted meeting intake records
  if (isReadOnlyRole(role)) {
    return [];
  }

  const queryPattern = query ? `%${query.trim().toLowerCase()}%` : null;

  let rows: RawMeetingRow[];

  if (role === 'owner' || role === 'admin') {
    if (status && queryPattern) {
      rows = await sql<RawMeetingRow[]>`
        SELECT * FROM meetings
        WHERE org_id = ${orgId}
          AND status = ${status}
          AND (LOWER(title) LIKE ${queryPattern} OR provider_numeric_id LIKE ${queryPattern})
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (status) {
      rows = await sql<RawMeetingRow[]>`
        SELECT * FROM meetings
        WHERE org_id = ${orgId}
          AND status = ${status}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (queryPattern) {
      rows = await sql<RawMeetingRow[]>`
        SELECT * FROM meetings
        WHERE org_id = ${orgId}
          AND (LOWER(title) LIKE ${queryPattern} OR provider_numeric_id LIKE ${queryPattern})
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      rows = await sql<RawMeetingRow[]>`
        SELECT * FROM meetings
        WHERE org_id = ${orgId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }
  } else {
    // Member & Viewer: See routed meetings with project access, or unrouted meetings if verified host
    if (status && queryPattern) {
      rows = await sql<RawMeetingRow[]>`
        SELECT m.* FROM meetings m
        WHERE m.org_id = ${orgId}
          AND m.status = ${status}
          AND (LOWER(m.title) LIKE ${queryPattern} OR m.provider_numeric_id LIKE ${queryPattern})
          AND (
            (m.node_id IS NULL AND m.host_id = ${userId})
            OR
            (m.node_id IS NOT NULL AND (
              EXISTS (
                SELECT 1 FROM nodes n
                WHERE n.org_id = ${orgId} AND n.id = m.node_id AND n.visibility = 'public' AND n.archived_at IS NULL
              )
              OR EXISTS (
                SELECT 1 FROM node_members nm
                JOIN nodes n ON n.id = nm.node_id AND n.org_id = ${orgId} AND n.archived_at IS NULL
                WHERE nm.org_id = ${orgId} AND nm.node_id = m.node_id AND nm.user_id = ${userId}
              )
            ))
          )
        ORDER BY m.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (status) {
      rows = await sql<RawMeetingRow[]>`
        SELECT m.* FROM meetings m
        WHERE m.org_id = ${orgId}
          AND m.status = ${status}
          AND (
            (m.node_id IS NULL AND m.host_id = ${userId})
            OR
            (m.node_id IS NOT NULL AND (
              EXISTS (
                SELECT 1 FROM nodes n
                WHERE n.org_id = ${orgId} AND n.id = m.node_id AND n.visibility = 'public' AND n.archived_at IS NULL
              )
              OR EXISTS (
                SELECT 1 FROM node_members nm
                JOIN nodes n ON n.id = nm.node_id AND n.org_id = ${orgId} AND n.archived_at IS NULL
                WHERE nm.org_id = ${orgId} AND nm.node_id = m.node_id AND nm.user_id = ${userId}
              )
            ))
          )
        ORDER BY m.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (queryPattern) {
      rows = await sql<RawMeetingRow[]>`
        SELECT m.* FROM meetings m
        WHERE m.org_id = ${orgId}
          AND (LOWER(m.title) LIKE ${queryPattern} OR m.provider_numeric_id LIKE ${queryPattern})
          AND (
            (m.node_id IS NULL AND m.host_id = ${userId})
            OR
            (m.node_id IS NOT NULL AND (
              EXISTS (
                SELECT 1 FROM nodes n
                WHERE n.org_id = ${orgId} AND n.id = m.node_id AND n.visibility = 'public' AND n.archived_at IS NULL
              )
              OR EXISTS (
                SELECT 1 FROM node_members nm
                JOIN nodes n ON n.id = nm.node_id AND n.org_id = ${orgId} AND n.archived_at IS NULL
                WHERE nm.org_id = ${orgId} AND nm.node_id = m.node_id AND nm.user_id = ${userId}
              )
            ))
          )
        ORDER BY m.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      rows = await sql<RawMeetingRow[]>`
        SELECT m.* FROM meetings m
        WHERE m.org_id = ${orgId}
          AND (
            (m.node_id IS NULL AND m.host_id = ${userId})
            OR
            (m.node_id IS NOT NULL AND (
              EXISTS (
                SELECT 1 FROM nodes n
                WHERE n.org_id = ${orgId} AND n.id = m.node_id AND n.visibility = 'public' AND n.archived_at IS NULL
              )
              OR EXISTS (
                SELECT 1 FROM node_members nm
                JOIN nodes n ON n.id = nm.node_id AND n.org_id = ${orgId} AND n.archived_at IS NULL
                WHERE nm.org_id = ${orgId} AND nm.node_id = m.node_id AND nm.user_id = ${userId}
              )
            ))
          )
        ORDER BY m.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }
  }

  return rows.map(mapMeeting);
}

/**
 * Re-evaluates meeting intake eligibility and retries transition.
 */
export async function retryMeetingIntake(
  db: Sql,
  params: {
    orgId: string;
    meetingId: string;
    userId: string;
    role: OrgRole;
  }
): Promise<MeetingDTO> {
  const { orgId, meetingId, role } = params;
  const sql = tenantSql(db, { orgId, userId: params.userId, role });

  if (role !== 'owner' && role !== 'admin') {
    throw new ForbiddenError('Only organization Owners or Admins can retry meeting intake');
  }

  const existingRows = await sql<RawMeetingRow[]>`
    SELECT * FROM meetings
    WHERE org_id = ${orgId} AND id = ${meetingId}
    LIMIT 1
  `;

  if (existingRows.length === 0) {
    throw new NotFoundError('Meeting not found');
  }

  const meeting = existingRows[0]!;

  // Check host consent
  const hostConsents = await sql<Array<{ consent_status: string; admin_disabled: boolean }>>`
    SELECT consent_status, admin_disabled
    FROM zoom_host_consents
    WHERE org_id = ${orgId} AND zoom_user_id = ${meeting.zoom_host_id || ''}
    LIMIT 1
  `;

  const hostConsent = hostConsents.length > 0 ? hostConsents[0]! : null;

  if (!hostConsent || hostConsent.consent_status !== 'opted_in' || hostConsent.admin_disabled) {
    throw new ValidationError('Meeting host is not opted in or has been disabled by administrator');
  }

  const updatedRows = await sql.begin(async (txn) => {
    let nextStatus: ZoomMeetingStatus;
    if (meeting.node_id && meeting.has_transcript) {
      nextStatus = 'routed';
    } else {
      nextStatus = meeting.has_transcript
        ? 'ready_for_transcript_retrieval'
        : 'waiting_for_transcript';
    }

    const rows = await txn<RawMeetingRow[]>`
      UPDATE meetings
      SET status = ${nextStatus},
          intake_error = NULL,
          retry_count = retry_count + 1,
          updated_at = now()
      WHERE id = ${meetingId}
      RETURNING *
    `;

    if (nextStatus === 'routed') {
      await txn`
        INSERT INTO outbox (org_id, topic, payload)
        VALUES (
          ${orgId},
          'meeting.routed',
          ${JSON.stringify({
            meetingId: meeting.id,
            orgId,
            nodeId: meeting.node_id,
            processingGeneration: meeting.processing_generation,
            retriedAt: new Date().toISOString(),
          })}::jsonb
        )
      `;
    } else if (nextStatus === 'ready_for_transcript_retrieval') {
      await txn`
        INSERT INTO outbox (org_id, topic, payload)
        VALUES (
          ${orgId},
          'meeting.transcript_ready',
          ${JSON.stringify({
            meetingId: meeting.id,
            orgId,
            provider: 'zoom',
            providerMeetingUuid: meeting.provider_meeting_uuid,
            retriedAt: new Date().toISOString(),
          })}::jsonb
        )
      `;
    }

    return rows;
  });

  return mapMeeting(updatedRows[0]!);
}

export type MeetingAccessAction = 'read' | 'decide' | 'mutate';

export interface AuthorizeMeetingAccessParams {
  orgId: string;
  meetingId: string;
  userId: string;
  userRole: OrgRole;
  action: MeetingAccessAction;
}

export interface AuthorizeMeetingAccessResult {
  authorized: boolean;
  httpStatus: 200 | 403 | 404;
  errorCode?: 'NOT_FOUND' | 'FORBIDDEN';
  errorMessage?: string;
  meeting?: MeetingDTO;
}

/**
 * Centralized authorization for meetings, transcripts, speaker mapping, notes, and suggestions.
 * Matrix:
 * - Owners/Admins retain established organization-wide access.
 * - Routed meetings: strictly governed by project privacy (node visibility='public' OR membership in node_members).
 *   Hosting a meeting does NOT bypass private-project access.
 * - Inaccessible private resources return 404 (zero leakage).
 * - Unrouted meetings: follow the verified host / admin boundary (meeting.hostId === userId).
 * - Viewers may read permitted content ('read'), but cannot decide or mutate proposals ('decide', 'mutate' -> 403).
 */
export async function authorizeMeetingAccess(
  db: Sql,
  params: AuthorizeMeetingAccessParams
): Promise<AuthorizeMeetingAccessResult> {
  const { orgId, meetingId, userId, userRole, action } = params;
  const sql = tenantSql(db, { orgId, userId, role: userRole });

  const meeting = await getMeetingById(sql, orgId, meetingId);
  if (!meeting) {
    return {
      authorized: false,
      httpStatus: 404,
      errorCode: 'NOT_FOUND',
      errorMessage: `Meeting ${meetingId} not found`,
    };
  }

  // 1. Owners and Admins have full access across the organization
  if (userRole === 'owner' || userRole === 'admin') {
    return {
      authorized: true,
      httpStatus: 200,
      meeting,
    };
  }

  // 2. Routed meetings: project privacy governs meeting content.
  // Hosting a meeting must NOT bypass private-project access.
  if (meeting.nodeId) {
    const nodeRows = await sql<Array<{ visibility: string; archived_at: Date | null }>>`
      SELECT visibility, archived_at
      FROM nodes
      WHERE org_id = ${orgId} AND id = ${meeting.nodeId}
      LIMIT 1
    `;

    const node = nodeRows[0];
    if (!node || node.archived_at !== null) {
      return {
        authorized: false,
        httpStatus: 404,
        errorCode: 'NOT_FOUND',
        errorMessage: `Meeting ${meetingId} not found`,
      };
    }

    let hasProjectAccess = false;
    if (node.visibility === 'public') {
      hasProjectAccess = true;
    } else {
      const membershipRows = await sql`
        SELECT 1 FROM node_members
        WHERE org_id = ${orgId}
          AND node_id = ${meeting.nodeId}
          AND user_id = ${userId}
        LIMIT 1
      `;
      if (membershipRows.length > 0) {
        hasProjectAccess = true;
      }
    }

    if (!hasProjectAccess) {
      // Inaccessible private project returns 404 to prevent metadata leakage
      return {
        authorized: false,
        httpStatus: 404,
        errorCode: 'NOT_FOUND',
        errorMessage: `Meeting ${meetingId} not found`,
      };
    }

    // Project access granted.
    // Viewers may read permitted content, but cannot decide or mutate
    if (action === 'read') {
      return {
        authorized: true,
        httpStatus: 200,
        meeting,
      };
    }

    if (isReadOnlyRole(userRole)) {
      return {
        authorized: false,
        httpStatus: 403,
        errorCode: 'FORBIDDEN',
        errorMessage: 'Viewers cannot decide or mutate proposals',
      };
    }

    return {
      authorized: true,
      httpStatus: 200,
      meeting,
    };
  }

  // 3. Unrouted meetings: follow the verified host boundary
  // Only a verified identity binding (meetings.host_id) counts; no email comparison fallback.
  if (meeting.hostId !== userId) {
    const errorMessage =
      isReadOnlyRole(userRole)
        ? 'Viewers cannot access meeting transcripts for meetings they did not host'
        : 'You can only view transcripts for meetings you hosted';
    return {
      authorized: false,
      httpStatus: 403,
      errorCode: 'FORBIDDEN',
      errorMessage,
    };
  }

  if (action === 'read') {
    return {
      authorized: true,
      httpStatus: 200,
      meeting,
    };
  }

  if (isReadOnlyRole(userRole)) {
    return {
      authorized: false,
      httpStatus: 403,
      errorCode: 'FORBIDDEN',
      errorMessage: 'Viewers cannot decide or mutate proposals',
    };
  }

  return {
    authorized: true,
    httpStatus: 200,
    meeting,
  };
}
