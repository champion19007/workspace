import { describe, it, expect } from 'vitest';
import {
  createAppPorts,
  InMemoryQueueAdapter,
  ControllableMockAuthAdapter,
  SupabaseAuthAdapter,
  CognitoAuthAdapter,
} from '../index.js';
import { parseConfig, AdapterUnavailableError, UnauthorizedError } from '@workspace/core';

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

  describe('ControllableMockAuthAdapter Verification', () => {
    it('executes passwordless magic link sign-in flow with single-use replay protection', async () => {
      const auth = new ControllableMockAuthAdapter();
      const email = 'user@workspace.dev';

      // 1. Request magic link
      const req = await auth.requestPasswordless({ email });
      expect(req.sent).toBe(true);

      // Verify challenge was created
      auth.setPendingChallenge('magic-token-xyz', {
        email,
        codeOrToken: 'magic-token-xyz',
        expiresAt: auth.getTime() + 15 * 60 * 1000,
        used: false,
      });

      // 2. Successful verification
      const result = await auth.verifyPasswordless({
        email,
        tokenOrCode: 'magic-token-xyz',
      });
      expect(result.user.email).toBe(email);
      expect(result.tokens.accessToken).toBeDefined();

      // 3. Replay attack rejection (token cannot be reused)
      await expect(
        auth.verifyPasswordless({ email, tokenOrCode: 'magic-token-xyz' })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('rejects expired magic links using controllable clock', async () => {
      const auth = new ControllableMockAuthAdapter(1700000000000);
      const email = 'user@workspace.dev';

      auth.setPendingChallenge('token-123', {
        email,
        codeOrToken: 'token-123',
        expiresAt: 1700000000000 + 60 * 1000, // expires in 1 min
        used: false,
      });

      // Advance clock past expiration
      auth.advanceTime(61 * 1000);

      await expect(
        auth.verifyPasswordless({ email, tokenOrCode: 'token-123' })
      ).rejects.toThrow('expired');
    });

    it('handles Google OAuth URL and code exchange', async () => {
      const auth = new ControllableMockAuthAdapter();
      const oauth = await auth.getOAuthUrl({
        provider: 'google',
        redirectUrl: 'http://localhost:3000/api/auth/callback',
        state: 'oauth-state-123',
      });

      expect(oauth.url).toContain('code=');
      expect(oauth.state).toBe('oauth-state-123');

      const url = new URL(oauth.url);
      const code = url.searchParams.get('code')!;

      // Exchange code
      const result = await auth.exchangeOAuthCode({ code });
      expect(result.user.email).toBe('google-user@workspace.dev');
      expect(result.tokens.accessToken).toBeDefined();

      // Replaying code fails
      await expect(auth.exchangeOAuthCode({ code })).rejects.toThrow('already been used');
    });

    it('refreshes active tokens and handles revocation', async () => {
      const auth = new ControllableMockAuthAdapter();
      const refreshed = await auth.refreshSession('valid-mock-refresh-token');
      expect(refreshed.accessToken).toBeDefined();

      await expect(auth.refreshSession('invalid')).rejects.toThrow(UnauthorizedError);

      await auth.revokeSession('user-123');
      expect(auth.isUserRevoked('user-123')).toBe(true);
    });
  });

  describe('SupabaseAuthAdapter & CognitoAuthAdapter Boundaries', () => {
    it('SupabaseAuthAdapter throws AdapterUnavailableError when credentials are missing', () => {
      expect(() => new SupabaseAuthAdapter({})).toThrow(AdapterUnavailableError);
    });

    it('CognitoAuthAdapter throws AdapterUnavailableError when credentials are missing', () => {
      expect(() => new CognitoAuthAdapter({})).toThrow(AdapterUnavailableError);
    });
  });
});
