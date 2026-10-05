import { z } from 'zod';

export const TaskRealtimePayloadSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
  changed: z.array(z.string()),
  at: z.string().datetime(),
});

export const NodeRollupRealtimePayloadSchema = z.object({
  id: z.string().uuid(),
  health: z.enum(['green', 'yellow', 'red']),
  counts: z.object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
  }),
  at: z.string().datetime(),
});

export const CommentRealtimePayloadSchema = z.object({
  id: z.string().uuid(),
  targetId: z.string(),
  at: z.string().datetime(),
});

export const MeetingStatusRealtimePayloadSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['scheduled', 'active', 'ingesting', 'routing', 'extracting', 'completed', 'failed', 'skipped']),
  at: z.string().datetime(),
});

export const NotificationRealtimePayloadSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  at: z.string().datetime(),
});

export type RealtimeEventMap = {
  'task.upserted': z.infer<typeof TaskRealtimePayloadSchema>;
  'task.deleted': z.infer<typeof TaskRealtimePayloadSchema>;
  'node.rollup': z.infer<typeof NodeRollupRealtimePayloadSchema>;
  'comment.created': z.infer<typeof CommentRealtimePayloadSchema>;
  'comment.updated': z.infer<typeof CommentRealtimePayloadSchema>;
  'comment.deleted': z.infer<typeof CommentRealtimePayloadSchema>;
  'meeting.status': z.infer<typeof MeetingStatusRealtimePayloadSchema>;
  'notification.created': z.infer<typeof NotificationRealtimePayloadSchema>;
};

export type RealtimeEventType = keyof RealtimeEventMap;

export interface RealtimeEvent<T extends RealtimeEventType = RealtimeEventType> {
  type: T;
  payload: RealtimeEventMap[T];
}

export interface RealtimePort {
  readonly provider: string;
  publish<T extends RealtimeEventType>(
    channel: string,
    event: RealtimeEvent<T>
  ): Promise<void>;
  mintToken(userId: string, orgId: string, channels: string[]): Promise<string>;
  checkHealth(): Promise<{ healthy: boolean; details?: unknown }>;
}
