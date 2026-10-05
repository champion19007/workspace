import { describe, it, expect } from 'vitest';
import { parseConfig } from '@workspace/core';
import { buildWorker } from '../server.js';

describe('Worker Service Health and Readiness', () => {
  const testConfig = parseConfig({
    DATABASE_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    DATABASE_DIRECT_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    ORIGIN_VERIFY_SECRET: 'test-origin-verify-secret-token-16-chars',
    WORKER_PORT: 8099,
    QUEUE_PROVIDER: 'in_memory',
    REALTIME_PROVIDER: 'in_memory',
    LLM_PROVIDER: 'mock',
    STORAGE_PROVIDER: 'in_memory',
    AUTH_PROVIDER: 'mock',
  });

  it('worker responds on /healthz liveness endpoint', async () => {
    const worker = buildWorker(testConfig);
    const response = await worker.app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('pass');
    expect(body.process).toBe('worker');

    await worker.sql.end({ timeout: 1 });
  });
});
