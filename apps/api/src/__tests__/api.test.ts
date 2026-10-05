import { describe, it, expect } from 'vitest';
import { parseConfig, NotFoundError } from '@workspace/core';
import { buildServer } from '../server.js';

describe('API Server Integration Tests', () => {
  const testConfig = parseConfig({
    DATABASE_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    DATABASE_DIRECT_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    ORIGIN_VERIFY_SECRET: 'test-origin-verify-secret-token-16-chars',
    PORT: 8089,
    QUEUE_PROVIDER: 'in_memory',
    REALTIME_PROVIDER: 'in_memory',
    LLM_PROVIDER: 'mock',
    STORAGE_PROVIDER: 'in_memory',
    AUTH_PROVIDER: 'mock',
  });

  it('responds with 200 on /healthz liveness endpoint', async () => {
    const server = buildServer(testConfig);
    const response = await server.app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('pass');
    expect(body.process).toBe('api');
    expect(typeof body.uptimeSeconds).toBe('number');

    await server.sql.end({ timeout: 1 });
  });

  it('returns foundation status on /api/v1/status', async () => {
    const server = buildServer(testConfig);
    const response = await server.app.inject({
      method: 'GET',
      url: '/api/v1/status',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.stage).toContain('Stage 1 of 25');
    expect(body.providers.queue).toBe('in_memory');

    await server.sql.end({ timeout: 1 });
  });

  it('formats DomainError using RFC 9457 problem+json structure', async () => {
    const server = buildServer(testConfig);

    // Register a test route that throws a DomainError
    server.app.get('/test/not-found', async () => {
      throw new NotFoundError('Org with slug "missing-org" was not found');
    });

    const response = await server.app.inject({
      method: 'GET',
      url: '/test/not-found',
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    const body = JSON.parse(response.payload);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.title).toContain('Org with slug "missing-org"');

    await server.sql.end({ timeout: 1 });
  });
});
