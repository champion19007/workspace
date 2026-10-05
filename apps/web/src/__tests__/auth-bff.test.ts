import { describe, it, expect, beforeEach } from 'vitest';
import {
  serializeSession,
  verifyAndRefreshSession,
  getCookieOptions,
  getInternalApiHeaders,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '../lib/session';
import {
  createSessionPayload,
  verifyInternalApiRequest,
  type SessionPayload,
  encryptSession,
  SESSION_MAX_AGE_MS,
  SESSION_ROLLING_REFRESH_THRESHOLD_MS,
} from '@workspace/core';

describe('Web BFF Session & Security', () => {
  const TEST_SECRET = 'a-super-secret-key-that-is-at-least-32-chars-long!';

  beforeEach(() => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ORIGIN_VERIFY_SECRET = TEST_SECRET;
  });

  it('serializes and deserializes a valid session payload', () => {
    const payload = createSessionPayload({
      userId: '019318ef-0000-7000-8000-000000000001',
      email: 'alex@company.com',
      activeOrgId: '019318ef-0000-7000-8000-000000000002',
      role: 'owner',
      sessionEpoch: 1,
    });

    const cookieValue = serializeSession(payload);
    expect(typeof cookieValue).toBe('string');
    expect(cookieValue.length).toBeGreaterThan(32);

    const result = verifyAndRefreshSession(cookieValue);
    expect(result.session).not.toBeNull();
    expect(result.session?.userId).toBe('019318ef-0000-7000-8000-000000000001');
    expect(result.session?.email).toBe('alex@company.com');
    expect(result.session?.role).toBe('owner');
    expect(result.session?.sessionEpoch).toBe(1);
    expect(result.refreshedCookie).toBeUndefined();
  });

  it('rejects tampered or corrupted cookies', () => {
    const payload = createSessionPayload({
      userId: '019318ef-0000-7000-8000-000000000001',
      email: 'alex@company.com',
    });

    const cookieValue = serializeSession(payload);
    const tampered = cookieValue.slice(0, -6) + 'abcdef';

    const result = verifyAndRefreshSession(tampered);
    expect(result.session).toBeNull();
    expect(result.refreshedCookie).toBeUndefined();
  });

  it('rejects completely invalid cookie format', () => {
    expect(verifyAndRefreshSession(undefined).session).toBeNull();
    expect(verifyAndRefreshSession('').session).toBeNull();
    expect(verifyAndRefreshSession('not-a-valid-encrypted-cookie').session).toBeNull();
  });

  it('rejects expired sessions (> 30 days old)', () => {
    const now = Date.now();
    const pastTime = now - (SESSION_MAX_AGE_MS + 1000);
    const expiredPayload: SessionPayload = {
      userId: '019318ef-0000-7000-8000-000000000001',
      email: 'alex@company.com',
      sessionEpoch: 1,
      createdAt: pastTime - SESSION_MAX_AGE_MS,
      expiresAt: pastTime,
    };

    const cookieValue = encryptSession(expiredPayload, TEST_SECRET);
    const result = verifyAndRefreshSession(cookieValue, now);
    expect(result.session).toBeNull();
    expect(result.refreshedCookie).toBeUndefined();
  });

  it('refreshes rolling 30-day session when threshold is passed', () => {
    const now = Date.now();
    const createdAt = now - (SESSION_ROLLING_REFRESH_THRESHOLD_MS + 5000);
    const activePayload: SessionPayload = {
      userId: '019318ef-0000-7000-8000-000000000001',
      email: 'alex@company.com',
      sessionEpoch: 1,
      createdAt,
      expiresAt: createdAt + SESSION_MAX_AGE_MS,
    };

    const cookieValue = encryptSession(activePayload, TEST_SECRET);
    const result = verifyAndRefreshSession(cookieValue, now);

    expect(result.session).not.toBeNull();
    expect(result.refreshedCookie).toBeDefined();
    expect(typeof result.refreshedCookie).toBe('string');
    // Rolled expiry should extend 30 days from now
    expect(result.session!.expiresAt).toBe(now + SESSION_MAX_AGE_MS);
  });

  it('enforces secure cookie flags for HTTP-only server sessions', () => {
    const options = getCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(SESSION_MAX_AGE_SECONDS);
    expect(SESSION_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60); // 30 days in seconds
    expect(SESSION_COOKIE_NAME).toBe('workspace_session');
  });

  it('signs internal API headers that pass Fastify cryptographic verification', () => {
    const session: SessionPayload = {
      userId: '019318ef-0000-7000-8000-000000000001',
      email: 'alex@company.com',
      activeOrgId: '019318ef-0000-7000-8000-000000000002',
      role: 'admin',
      sessionEpoch: 2,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_MAX_AGE_MS,
    };

    const timestamp = Date.now();
    const headers = getInternalApiHeaders(session, timestamp);

    expect(headers['x-workspace-user-id']).toBe(session.userId);
    expect(headers['x-workspace-user-email']).toBe(session.email);
    expect(headers['x-workspace-session-epoch']).toBe('2');
    expect(headers['x-workspace-timestamp']).toBe(timestamp.toString());
    expect(headers['x-workspace-signature']).toBeDefined();

    // Verify signature using core cryptographic verifier
    const isValid = verifyInternalApiRequest(
      {
        userId: headers['x-workspace-user-id'],
        email: headers['x-workspace-user-email'],
        timestamp,
      },
      headers['x-workspace-signature'],
      TEST_SECRET,
      300,
      timestamp
    );

    expect(isValid).toBe(true);
  });
});
