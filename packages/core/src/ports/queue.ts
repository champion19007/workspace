import { z } from 'zod';

export const MeetingPipelinePayloadSchema = z.object({
  orgId: z.string().uuid(),
  meetingId: z.string().uuid(),
  zoomMeetingUuid: z.string(),
  provider: z.literal('zoom').default('zoom'),
});
export type MeetingPipelinePayload = z.infer<typeof MeetingPipelinePayloadSchema>;

export const NotifyPayloadSchema = z.object({
  orgId: z.string().uuid(),
  kind: z.enum(['mention', 'assignment', 'digest', 'zoom_disconnected']),
  userId: z.string().uuid(),
  entityId: z.string(),
  data: z.record(z.unknown()).optional(),
});
export type NotifyPayload = z.infer<typeof NotifyPayloadSchema>;

export const IndexPayloadSchema = z.object({
  orgId: z.string().uuid(),
  sourceType: z.enum(['task', 'meeting_notes', 'doc', 'transcript_segment']),
  sourceId: z.string().uuid(),
  version: z.number().int().nonnegative(),
});
export type IndexPayload = z.infer<typeof IndexPayloadSchema>;

export const RollupPayloadSchema = z.object({
  orgId: z.string().uuid(),
  nodeId: z.string().uuid(),
});
export type RollupPayload = z.infer<typeof RollupPayloadSchema>;

export const ExportErasurePayloadSchema = z.object({
  orgId: z.string().uuid(),
  requestId: z.string().uuid(),
  kind: z.enum(['export', 'erasure']),
  userId: z.string().uuid().optional(),
});
export type ExportErasurePayload = z.infer<typeof ExportErasurePayloadSchema>;

export const SystemPingPayloadSchema = z.object({
  pingId: z.string().uuid(),
  timestamp: z.string(),
  orgId: z.string().uuid().optional(),
});
export type SystemPingPayload = z.infer<typeof SystemPingPayloadSchema>;

export const OrgMaintenancePayloadSchema = z.object({
  orgId: z.string().uuid(),
  task: z.enum(['purge_outbox', 'cleanup_idempotency', 'rollup_recompute']),
});
export type OrgMaintenancePayload = z.infer<typeof OrgMaintenancePayloadSchema>;

export const MeetingTranscriptReadyPayloadSchema = z.object({
  orgId: z.string().uuid(),
  meetingId: z.string().uuid(),
  providerMeetingUuid: z.string().optional(),
  connectionGeneration: z.number().int().optional(),
  processingGeneration: z.number().int().optional(),
  emittedAt: z.string().optional(),
});
export type MeetingTranscriptReadyPayload = z.infer<typeof MeetingTranscriptReadyPayloadSchema>;

export const MeetingTranscriptIngestedPayloadSchema = z.object({
  orgId: z.string().uuid(),
  meetingId: z.string().uuid(),
  providerMeetingUuid: z.string().optional(),
  connectionGeneration: z.number().int().optional(),
  processingGeneration: z.number().int().optional(),
  emittedAt: z.string().optional(),
});
export type MeetingTranscriptIngestedPayload = z.infer<typeof MeetingTranscriptIngestedPayloadSchema>;

export const MeetingRoutedPayloadSchema = z.object({
  orgId: z.string().uuid(),
  meetingId: z.string().uuid(),
  nodeId: z.string().uuid(),
  routedBy: z.string().uuid().nullable().optional(),
  confidence: z.number().optional(),
  processingGeneration: z.number().int().optional(),
  emittedAt: z.string().optional(),
});
export type MeetingRoutedPayload = z.infer<typeof MeetingRoutedPayloadSchema>;

export const MeetingNotesCreatedPayloadSchema = z.object({
  orgId: z.string().uuid(),
  meetingId: z.string().uuid(),
  nodeId: z.string().uuid(),
  notesId: z.string().uuid(),
  docId: z.string().uuid().nullable().optional(),
  actionItemCount: z.number().int().nonnegative().optional(),
  emittedAt: z.string().optional(),
});
export type MeetingNotesCreatedPayload = z.infer<typeof MeetingNotesCreatedPayloadSchema>;

export const MeetingSuggestionsCreatedPayloadSchema = z.object({
  orgId: z.string().uuid(),
  meetingId: z.string().uuid(),
  nodeId: z.string().uuid().optional(),
  count: z.number().int().nonnegative().optional(),
  actionItemCount: z.number().int().nonnegative().optional(),
  actionItemIds: z.array(z.string()).optional(),
  emittedAt: z.string().optional(),
});
export type MeetingSuggestionsCreatedPayload = z.infer<typeof MeetingSuggestionsCreatedPayloadSchema>;

export const JobPayloadSchemas = {
  'meeting.pipeline': MeetingPipelinePayloadSchema,
  'meeting.transcript_ready': MeetingTranscriptReadyPayloadSchema,
  'meeting.transcript_ingested': MeetingTranscriptIngestedPayloadSchema,
  'meeting.routed': MeetingRoutedPayloadSchema,
  'meeting.notes_created': MeetingNotesCreatedPayloadSchema,
  'meeting.suggestions_created': MeetingSuggestionsCreatedPayloadSchema,
  notify: NotifyPayloadSchema,
  index: IndexPayloadSchema,
  rollup: RollupPayloadSchema,
  'export.erasure': ExportErasurePayloadSchema,
  'system.ping': SystemPingPayloadSchema,
  'org.maintenance': OrgMaintenancePayloadSchema,
} as const;

export type JobName = keyof typeof JobPayloadSchemas;

export type JobPayloadMap = {
  'meeting.pipeline': MeetingPipelinePayload;
  'meeting.transcript_ready': MeetingTranscriptReadyPayload;
  'meeting.transcript_ingested': MeetingTranscriptIngestedPayload;
  'meeting.routed': MeetingRoutedPayload;
  'meeting.notes_created': MeetingNotesCreatedPayload;
  'meeting.suggestions_created': MeetingSuggestionsCreatedPayload;
  notify: NotifyPayload;
  index: IndexPayload;
  rollup: RollupPayload;
  'export.erasure': ExportErasurePayload;
  'system.ping': SystemPingPayload;
  'org.maintenance': OrgMaintenancePayload;
};

export type JobHandler<T extends JobName = JobName> = (
  data: JobPayloadMap[T],
  metadata?: { id: string; name: string }
) => Promise<void>;

export interface QueueEnqueueOptions {
  dedupeKey?: string;
  delayS?: number;
  priority?: number;
}

export interface QueuePort {
  readonly provider: string;
  enqueue<T extends JobName>(
    job: T,
    data: JobPayloadMap[T],
    options?: QueueEnqueueOptions
  ): Promise<void>;
  subscribe?<T extends JobName>(
    job: T,
    handler: JobHandler<T>
  ): Promise<void>;
  checkHealth(): Promise<{ healthy: boolean; details?: unknown }>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

