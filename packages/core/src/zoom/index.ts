import { z } from 'zod';
import crypto from 'crypto';

/**
 * Granular Zoom scopes required by the transcript-only product.
 * - recording:read:admin: Reading cloud recording and transcript metadata
 * - meeting:read:admin: Reading relevant meeting and past-participant information
 * - user:read:admin: Resolving authorized Zoom user/account identities and necessary email mappings
 */
export const ZOOM_REQUIRED_SCOPES = [
  'recording:read:admin',
  'meeting:read:admin',
  'user:read:admin',
] as const;

export type ZoomScope = (typeof ZOOM_REQUIRED_SCOPES)[number];

export type ZoomIntegrationStatus =
  | 'connected'
  | 'disconnected'
  | 'needs_reauthorization'
  | 'degraded';

export type ZoomHostConsentStatus = 'opted_in' | 'opted_out' | 'unknown';

export interface ZoomIntegrationDTO {
  id: string;
  orgId: string;
  provider: 'zoom';
  accountId: string;
  accountName?: string | null;
  accountEmail?: string | null;
  scopes: string[];
  status: ZoomIntegrationStatus;
  connectionGeneration: number;
  installedAt: string;
  installedBy?: string | null;
  lastRefreshedAt?: string | null;
  lastErrorCategory?: string | null;
  lastErrorMessage?: string | null;
}

export interface ZoomHostConsentDTO {
  id: string;
  orgId: string;
  integrationId: string;
  zoomUserId: string;
  zoomEmail: string;
  zoomName?: string | null;
  userId?: string | null;
  consentStatus: ZoomHostConsentStatus;
  consentTimestamp?: string | null;
  policyVersion: string;
  adminDisabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// Request validation schemas
export const AuthorizeZoomRequestSchema = z.object({
  redirectUri: z.string().url().optional(),
});
export type AuthorizeZoomRequest = z.infer<typeof AuthorizeZoomRequestSchema>;

export const ZoomCallbackRequestSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().min(1, 'OAuth state parameter is required'),
});
export type ZoomCallbackRequest = z.infer<typeof ZoomCallbackRequestSchema>;

export const UpdateZoomHostConsentSchema = z.object({
  consentStatus: z.enum(['opted_in', 'opted_out', 'unknown']).optional(),
  adminDisabled: z.boolean().optional(),
});
export type UpdateZoomHostConsentInput = z.infer<typeof UpdateZoomHostConsentSchema>;

export type GuestConsentStatus = 'absent' | 'consented' | 'unknown' | 'pending';

// Shared meeting eligibility contract
export interface MeetingEligibilityParams {
  connectionStatus: ZoomIntegrationStatus;
  hostConsent?: {
    consentStatus: ZoomHostConsentStatus;
    adminDisabled: boolean;
  } | null;
  meetingExcluded?: boolean;
  hasExternalParticipants?: boolean;
  guestConsentGranted?: boolean;
  guestConsentStatus?: GuestConsentStatus;
  connectionGeneration?: number;
  expectedConnectionGeneration?: number;
  retentionDeadline?: string | Date | null;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Shared meeting eligibility evaluator for Workspace v1 ingestion pipeline.
 * Guarantees that no recording or transcript is processed unless:
 * 1. Integration is active and authenticated
 * 2. Meeting host is verified and explicitly opted in
 * 3. Workspace administrator has not disabled the host
 * 4. Meeting is not marked as excluded
 * 5. External guest participant consent is satisfied if guests are present
 * 6. Connection generation matches active integration
 * 7. Transcript retention deadline has not expired
 */
export function evaluateMeetingEligibility(params: MeetingEligibilityParams): EligibilityResult {
  if (params.connectionStatus !== 'connected') {
    return {
      eligible: false,
      reason: `Zoom integration is not connected (current status: ${params.connectionStatus})`,
    };
  }

  if (
    params.expectedConnectionGeneration !== undefined &&
    params.connectionGeneration !== undefined &&
    params.connectionGeneration !== params.expectedConnectionGeneration
  ) {
    return {
      eligible: false,
      reason: `Integration connection generation mismatch (expected: ${params.expectedConnectionGeneration}, got: ${params.connectionGeneration})`,
    };
  }

  if (!params.hostConsent) {
    return {
      eligible: false,
      reason: 'Meeting host has not been registered or opted in for transcription',
    };
  }

  if (params.hostConsent.adminDisabled) {
    return {
      eligible: false,
      reason: 'Transcription processing for this host is disabled by workspace administrator',
    };
  }

  if (params.hostConsent.consentStatus !== 'opted_in') {
    return {
      eligible: false,
      reason: `Meeting host has not granted explicit opt-in consent (status: ${params.hostConsent.consentStatus})`,
    };
  }

  if (params.meetingExcluded) {
    return {
      eligible: false,
      reason: 'Meeting is explicitly excluded from ingestion',
    };
  }

  if (params.retentionDeadline) {
    const deadlineMs = new Date(params.retentionDeadline).getTime();
    if (!isNaN(deadlineMs) && deadlineMs < Date.now()) {
      return {
        eligible: false,
        reason: 'Meeting transcript retention period has expired',
      };
    }
  }

  if (params.guestConsentStatus === 'pending') {
    return {
      eligible: false,
      reason: 'Meeting guest consent is pending confirmation',
    };
  }

  if (params.guestConsentStatus === 'unknown' && (params.hasExternalParticipants || params.guestConsentGranted === false)) {
    return {
      eligible: false,
      reason: 'Meeting contains external participants without verified guest consent',
    };
  }

  if (params.hasExternalParticipants && !params.guestConsentGranted && params.guestConsentStatus !== 'consented') {
    return {
      eligible: false,
      reason: 'Meeting contains external participants without verified guest consent',
    };
  }

  return { eligible: true };
}

// Stage 12, 13 & 14: Webhook and Meeting Intake Contracts
export type ZoomMeetingStatus =
  | 'scheduled'
  | 'waiting_for_transcript'
  | 'pending_consent'
  | 'ready_for_transcript_retrieval'
  | 'ingesting'
  | 'transcript_ready'
  | 'routing'
  | 'awaiting_project_choice'
  | 'routed'
  | 'extracting'
  | 'completed'
  | 'failed'
  | 'intake_failed'
  | 'connection_requires_reconnection'
  | 'skipped';

const STATUS_RANK: Record<ZoomMeetingStatus, number> = {
  scheduled: 0,
  waiting_for_transcript: 1,
  pending_consent: 1,
  ready_for_transcript_retrieval: 2,
  ingesting: 3,
  transcript_ready: 4,
  routing: 5,
  awaiting_project_choice: 5,
  routed: 6,
  extracting: 7,
  completed: 8,
  failed: 10,
  intake_failed: 10,
  connection_requires_reconnection: 10,
  skipped: 10,
};

/**
 * Determines whether a meeting status can transition to a new status.
 * Prevents out-of-order events (such as late recording.completed) from resetting
 * an advanced state (like ready_for_transcript_retrieval, ingesting, or completed),
 * and prevents reviving explicitly skipped meetings.
 */
export function canTransitionMeetingStatus(current: ZoomMeetingStatus, next: ZoomMeetingStatus): boolean {
  if (current === next) return true;
  if (current === 'skipped') return false; // Tombstone: skipped cannot be revived automatically
  if (next === 'skipped') return true;
  if (next === 'connection_requires_reconnection') return true;
  if (next === 'intake_failed') return true;

  // If current is already ready_for_transcript_retrieval or downstream,
  // do NOT regress back to waiting_for_transcript or pending_consent!
  if (STATUS_RANK[current] >= 2 && (next === 'waiting_for_transcript' || next === 'pending_consent')) {
    return false;
  }

  // Once routed or extracting or completed, don't regress to awaiting_project_choice automatically
  if (STATUS_RANK[current] >= 6 && next === 'awaiting_project_choice') {
    return false;
  }

  return true;
}

export interface VerifySignatureResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verifies Zoom webhook HMAC-SHA256 signature against official specification:
 * Message: `v0:{x-zm-request-timestamp}:{rawBody}`
 * Signature Header: `v0={hex_hash}`
 * Reject timestamps outside ±300s window.
 * Use constant-time comparison.
 */
export function verifyZoomWebhookSignature(params: {
  secretToken: string;
  timestampHeader?: string | string[];
  signatureHeader?: string | string[];
  rawBody: string;
  nowMs?: number;
}): VerifySignatureResult {
  const { secretToken, rawBody, nowMs = Date.now() } = params;
  const timestamp = Array.isArray(params.timestampHeader) ? params.timestampHeader[0] : params.timestampHeader;
  const signature = Array.isArray(params.signatureHeader) ? params.signatureHeader[0] : params.signatureHeader;

  if (!timestamp) {
    return { valid: false, reason: 'Missing x-zm-request-timestamp header' };
  }

  if (!signature) {
    return { valid: false, reason: 'Missing x-zm-signature header' };
  }

  const tsNum = parseInt(timestamp, 10);
  if (isNaN(tsNum)) {
    return { valid: false, reason: 'Invalid non-numeric x-zm-request-timestamp' };
  }

  // Window: ±300 seconds (5 minutes past/future)
  const nowSec = Math.floor(nowMs / 1000);
  if (Math.abs(nowSec - tsNum) > 300) {
    return { valid: false, reason: `Timestamp outside acceptable 5-minute window (diff: ${Math.abs(nowSec - tsNum)}s)` };
  }

  // Signature format: v0=<64 hex chars>
  if (!/^v0=[a-f0-9]{64}$/i.test(signature)) {
    return { valid: false, reason: 'Malformed x-zm-signature format' };
  }

  const message = `v0:${timestamp}:${rawBody}`;
  const computedHash = crypto.createHmac('sha256', secretToken).update(message).digest('hex');
  const expectedSignature = `v0=${computedHash}`;

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);

  if (sigBuf.length !== expBuf.length) {
    return { valid: false, reason: 'Signature length mismatch' };
  }

  const isMatch = crypto.timingSafeEqual(sigBuf, expBuf);
  if (!isMatch) {
    return { valid: false, reason: 'Signature hash mismatch' };
  }

  return { valid: true };
}

/**
 * Builds Zoom endpoint.url_validation challenge response.
 */
export function buildZoomValidationResponse(
  plainToken: string,
  secretToken: string
): { plainToken: string; encryptedToken: string } {
  const encryptedToken = crypto.createHmac('sha256', secretToken).update(plainToken).digest('hex');
  return {
    plainToken,
    encryptedToken,
  };
}

export interface MeetingDTO {
  id: string;
  orgId: string;
  nodeId?: string | null;
  nodeTitle?: string | null;
  provider: 'zoom';
  providerMeetingUuid: string;
  providerNumericId?: string | null;
  title?: string | null;
  hostId?: string | null;
  zoomHostId?: string | null;
  zoomHostEmail?: string | null;
  scheduledStartAt?: string | null;
  actualStartAt?: string | null;
  durationSeconds?: number | null;
  timezone?: string | null;
  recordingCompletedAt?: string | null;
  transcriptCompletedAt?: string | null;
  hasTranscript: boolean;
  hasRecording: boolean;
  status: ZoomMeetingStatus;
  guestsPresent: boolean;
  consentSent: boolean;
  skipped: boolean;
  intakeError?: string | null;
  connectionGeneration: number;
  lastPolledAt?: string | null;
  retryCount: number;
  version: number;
  processingGeneration: number;
  guestConsentStatus: GuestConsentStatus;
  rawTranscriptObjectKey?: string | null;
  rawTranscriptChecksum?: string | null;
  rawTranscriptByteCount?: number | null;
  transcriptRetentionDeadline?: string | null;
  sourceManifest?: any;
  cleanupStatus: 'none' | 'pending' | 'completed';
  cleanedUpAt?: string | null;
  suggestedNodeId?: string | null;
  suggestedNodeTitle?: string | null;
  routingConfidence?: number | null;
  routingReason?: string | null;
  routingAlternatives?: string[];
  routingActorId?: string | null;
  routingDecidedAt?: string | null;
  speakersResolved: boolean;
  speakerResolutionMetadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export type ZoomMeetingDTO = MeetingDTO;

export const ListMeetingsQuerySchema = z.object({
  status: z.string().optional(),
  query: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListMeetingsQuery = z.infer<typeof ListMeetingsQuerySchema>;

export const SkipMeetingRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type SkipMeetingRequest = z.infer<typeof SkipMeetingRequestSchema>;

export const GetTranscriptQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type GetTranscriptQuery = z.infer<typeof GetTranscriptQuerySchema>;

// Stage 14: Project Routing and Host Decision Schemas
export const RouteMeetingRequestSchema = z
  .object({
    nodeId: z.string().uuid().optional(),
    targetProjectId: z.string().uuid().optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((data) => Boolean(data.nodeId || data.targetProjectId), {
    message: 'Either nodeId or targetProjectId must be provided',
    path: ['nodeId'],
  });
export type RouteMeetingRequest = z.infer<typeof RouteMeetingRequestSchema>;

export const UpdateSpeakerMappingSchema = z.object({
  speakerLabel: z.string().min(1),
  userId: z.string().uuid().nullable(),
});
export type UpdateSpeakerMapping = z.infer<typeof UpdateSpeakerMappingSchema>;

export const ResolveGuestConsentSchema = z.object({
  guestConsentStatus: z.enum(['consented', 'absent']),
  attestationNotes: z.string().max(500).optional(),
});
export type ResolveGuestConsent = z.infer<typeof ResolveGuestConsentSchema>;

export const UpdateMyConsentSchema = z.object({
  consentStatus: z.enum(['opted_in', 'opted_out']),
});
export type UpdateMyConsent = z.infer<typeof UpdateMyConsentSchema>;

export interface ProjectRoutingCandidate {
  id: string;
  name: string;
  path: string;
  description?: string | null;
  teamName?: string | null;
}

export const ProjectRoutingResultSchema = z.object({
  selectedProjectId: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  alternatives: z.array(z.string().uuid()).default([]),
});
export type ProjectRoutingResult = z.infer<typeof ProjectRoutingResultSchema>;

export const SpeakerResolutionResultSchema = z.object({
  resolutions: z.array(
    z.object({
      speakerLabel: z.string(),
      matchedUserId: z.string().uuid().nullable(),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
    })
  ),
});
export type SpeakerResolutionResult = z.infer<typeof SpeakerResolutionResultSchema>;

// Stage 15: AI Notes & Action Suggestions Contracts (Requirement N-1)
export interface EvidenceSegmentDTO {
  seq: number;
  quote: string;
  startMs?: number;
  endMs?: number;
  canonicalExcerpt?: string;
  charStart?: number;
  charEnd?: number;
}

export interface DecisionDTO {
  text: string;
  evidence: EvidenceSegmentDTO[];
}

export interface OpenQuestionDTO {
  text: string;
  evidence?: EvidenceSegmentDTO[];
}

export interface RankedAlternativeDTO {
  taskId: string;
  taskKey: string;
  taskTitle: string;
  similarityScore: number;
}

export interface ActionItemDTO {
  id: string;
  orgId: string;
  meetingId: string;
  text: string;
  ownerName?: string | null;
  duePhrase?: string | null;
  suggestedOwnerId?: string | null;
  suggestedDue?: string | null;
  evidence: EvidenceSegmentDTO[];
  confidence: number;
  state: 'suggested' | 'approved' | 'edited' | 'rejected';
  proposalType: 'create_task' | 'update_task';
  targetTaskId?: string | null;
  targetTaskVersion?: number | null;
  targetTaskHash?: string | null;
  similarityScore?: number | null;
  rankedAlternatives?: RankedAlternativeDTO[];
  embeddingSpace?: string | null;
  dedupStatus?: 'pending' | 'matched' | 'no_match' | 'incomplete' | 'skipped';
  dedupedAt?: string | null;
  ownerResolutionMethod?: string | null;
  ownerResolutionConfidence?: number | null;
  ownerResolutionEvidence?: string | null;
  dueResolutionExplanation?: string | null;
  dueResolutionStatus?: string | null;
  validationStatus?: 'valid' | 'invalid_evidence' | 'unvalidated';
  taskId?: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  extractionRunId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingNotesDTO {
  id: string;
  orgId: string;
  meetingId: string;
  summaryMd: string;
  decisions: DecisionDTO[];
  openQuestions: OpenQuestionDTO[];
  evidence: EvidenceSegmentDTO[];
  model: string;
  promptVersion: string;
  costInr: number;
  extractionRunId?: string | null;
  docId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractionRunDTO {
  id: string;
  orgId: string;
  meetingId: string;
  nodeId: string;
  runKey: string;
  processingGeneration: number;
  transcriptChecksum: string;
  promptVersion: string;
  model: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
  totalWindows: number;
  completedWindows: number;
  windowProgress: unknown[];
  inputTokens: number;
  outputTokens: number;
  costInr: number;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AIUsageLedgerDTO {
  id: string;
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
  createdAt: string;
}

export * from './vtt-normalizer.js';


