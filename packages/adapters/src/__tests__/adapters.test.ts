import { describe, it, expect } from 'vitest';
import { createAppPorts, InMemoryQueueAdapter } from '../index.js';
import { parseConfig, AdapterUnavailableError } from '@workspace/core';

describe('Adapters and Port Composition Factory', () => {
  const baseConfig = parseConfig({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
    DATABASE_DIRECT_URL: 'postgresql://test:test@localhost:5432/test_db',
    ORIGIN_VERIFY_SECRET: 'super-secret-verify-token-at-least-16-chars',
    QUEUE_PROVIDER: 'in_memory',
    REALTIME_PROVIDER: 'in_memory',
    LLM_PROVIDER: 'mock',
    STORAGE_PROVIDER: 'in_memory',
    AUTH_PROVIDER: 'mock',
  });

  it('creates functional in-memory and mock ports', async () => {
    const ports = createAppPorts(baseConfig);

    expect(ports.queue.provider).toBe('in_memory');
    expect(ports.realtime.provider).toBe('in_memory');
    expect(ports.llm.provider).toBe('mock');
    expect(ports.blobStore.provider).toBe('in_memory');
    expect(ports.auth.provider).toBe('mock');

    // Test health checks
    const queueHealth = await ports.queue.checkHealth();
    expect(queueHealth.healthy).toBe(true);

    const realtimeHealth = await ports.realtime.checkHealth();
    expect(realtimeHealth.healthy).toBe(true);
  });

  it('fails with AdapterUnavailableError when an external provider lacks required credentials', () => {
    const brokenConfig = parseConfig({
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
      DATABASE_DIRECT_URL: 'postgresql://test:test@localhost:5432/test_db',
      ORIGIN_VERIFY_SECRET: 'super-secret-verify-token-at-least-16-chars',
      LLM_PROVIDER: 'anthropic', // missing ANTHROPIC_API_KEY
    });

    expect(() => createAppPorts(brokenConfig)).toThrow(AdapterUnavailableError);
  });

  it('in-memory queue enqueues and stores typed jobs correctly', async () => {
    const queue = new InMemoryQueueAdapter();
    await queue.enqueue(
      'meeting.pipeline',
      {
        orgId: '018f3a55-0000-7000-8000-000000000001',
        meetingId: '018f3a55-0000-7000-8000-000000000002',
        zoomMeetingUuid: 'uuid-1234',
        provider: 'zoom',
      },
      { dedupeKey: 'meeting-1234' }
    );

    expect(queue.messages.length).toBe(1);
    expect(queue.messages[0]?.job).toBe('meeting.pipeline');
  });
});
