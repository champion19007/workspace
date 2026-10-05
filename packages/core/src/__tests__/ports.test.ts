import { describe, it, expect } from 'vitest';
import {
  MeetingPipelinePayloadSchema,
  NotifyPayloadSchema,
  IndexPayloadSchema,
  RollupPayloadSchema,
  ExportErasurePayloadSchema,
  TaskRealtimePayloadSchema,
  NodeRollupRealtimePayloadSchema,
  parseConfig,
  ConfigurationError,
} from '../index.js';

describe('Job Schemas Validation', () => {
  it('validates meeting.pipeline job payload correctly', () => {
    const valid = {
      orgId: '018f3a55-0000-7000-8000-000000000001',
      meetingId: '018f3a55-0000-7000-8000-000000000002',
      zoomMeetingUuid: '4f9A+abc123==',
      provider: 'zoom' as const,
    };
    const parsed = MeetingPipelinePayloadSchema.parse(valid);
    expect(parsed.meetingId).toBe(valid.meetingId);

    expect(() =>
      MeetingPipelinePayloadSchema.parse({
        orgId: 'not-a-uuid',
        meetingId: 'also-not-a-uuid',
      })
    ).toThrow();
  });

  it('validates notify and rollup job payloads', () => {
    const notifyPayload = {
      orgId: '018f3a55-0000-7000-8000-000000000001',
      kind: 'mention' as const,
      userId: '018f3a55-0000-7000-8000-000000000003',
      entityId: 'task-456',
    };
    expect(NotifyPayloadSchema.parse(notifyPayload).kind).toBe('mention');

    const rollupPayload = {
      orgId: '018f3a55-0000-7000-8000-000000000001',
      nodeId: '018f3a55-0000-7000-8000-000000000004',
    };
    expect(RollupPayloadSchema.parse(rollupPayload).nodeId).toBe(rollupPayload.nodeId);

    const indexPayload = {
      orgId: '018f3a55-0000-7000-8000-000000000001',
      sourceType: 'task' as const,
      sourceId: '018f3a55-0000-7000-8000-000000000005',
      version: 1,
    };
    expect(IndexPayloadSchema.parse(indexPayload).sourceType).toBe('task');

    const exportPayload = {
      orgId: '018f3a55-0000-7000-8000-000000000001',
      requestId: '018f3a55-0000-7000-8000-000000000006',
      kind: 'export' as const,
    };
    expect(ExportErasurePayloadSchema.parse(exportPayload).kind).toBe('export');
  });

  it('validates realtime task and node rollup event schemas', () => {
    const validNodeRollup = {
      id: '018f3a55-0000-7000-8000-000000000007',
      health: 'green' as const,
      counts: { total: 10, completed: 8, overdue: 1 },
      at: new Date().toISOString(),
    };
    expect(NodeRollupRealtimePayloadSchema.parse(validNodeRollup).health).toBe('green');
    const validTaskEvent = {
      id: '018f3a55-0000-7000-8000-000000000005',
      version: 2,
      changed: ['status', 'rank'],
      at: new Date().toISOString(),
    };
    const parsed = TaskRealtimePayloadSchema.parse(validTaskEvent);
    expect(parsed.version).toBe(2);
  });
});

describe('Configuration Validation', () => {
  it('throws ConfigurationError when required fields are missing', () => {
    expect(() => parseConfig({})).toThrow(ConfigurationError);
  });

  it('parses valid configuration with defaults applied', () => {
    const validEnv = {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
      DATABASE_DIRECT_URL: 'postgresql://test:test@localhost:5432/test_db',
      ORIGIN_VERIFY_SECRET: 'super-secret-verify-token-at-least-16-chars',
    };
    const config = parseConfig(validEnv);
    expect(config.APP_ENV).toBe('development');
    expect(config.PORT).toBe(8080);
    expect(config.QUEUE_PROVIDER).toBe('in_memory');
  });
});
