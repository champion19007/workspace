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

export const JobPayloadSchemas = {
  'meeting.pipeline': MeetingPipelinePayloadSchema,
  notify: NotifyPayloadSchema,
  index: IndexPayloadSchema,
  rollup: RollupPayloadSchema,
  'export.erasure': ExportErasurePayloadSchema,
} as const;

export type JobName = keyof typeof JobPayloadSchemas;

export type JobPayloadMap = {
  'meeting.pipeline': MeetingPipelinePayload;
  notify: NotifyPayload;
  index: IndexPayload;
  rollup: RollupPayload;
  'export.erasure': ExportErasurePayload;
};

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
  checkHealth(): Promise<{ healthy: boolean; details?: unknown }>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
