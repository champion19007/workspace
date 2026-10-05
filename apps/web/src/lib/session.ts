import {
  type SessionPayload,
  encryptSession,
  decryptSession,
  isSessionExpired,
  shouldRefreshSession,
  rollSessionExpiry,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  signInternalApiRequest,
} from '@workspace/core';

export { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS };
export const OAUTH_STATE_COOKIE_NAME = 'workspace_oauth_state';

export function getSessionSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.ORIGIN_VERIFY_SECRET ||
    'workspace-dev-default-secret-key-32chars'
  );
}

export function getCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/**
 * Decrypts and validates the session cookie from a raw cookie value.
 * Handles controllable clock checks for expiration and 30-day rolling refresh.
 */
export function verifyAndRefreshSession(
  cookieValue: string | undefined,
  now: number = Date.now()
): { session: SessionPayload | null; refreshedCookie?: string } {
  if (!cookieValue) {
    return { session: null };
  }

  const secret = getSessionSecret();
  const session = decryptSession(cookieValue, secret);
  if (!session) {
    return { session: null };
  }

  if (isSessionExpired(session, now)) {
    return { session: null };
  }

  // Check rolling 30-day refresh
  if (shouldRefreshSession(session, now)) {
    const rolled = rollSessionExpiry(session, now);
    const refreshedCookie = encryptSession(rolled, secret);
    return { session: rolled, refreshedCookie };
  }

  return { session };
}

/**
 * Encrypts a session payload into a cookie value.
 */
export function serializeSession(session: SessionPayload): string {
  const secret = getSessionSecret();
  return encryptSession(session, secret);
}

/**
 * Generates signed headers for BFF-to-Fastify internal API communication.
 */
export function getInternalApiHeaders(session: SessionPayload, timestamp = Date.now()) {
  const secret = process.env.ORIGIN_VERIFY_SECRET || getSessionSecret();
  const signature = signInternalApiRequest(
    { userId: session.userId, email: session.email, timestamp },
    secret
  );

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-workspace-user-id': session.userId,
    'x-workspace-user-email': session.email,
    'x-workspace-timestamp': timestamp.toString(),
    'x-workspace-signature': signature,
  };

  if (session.sessionEpoch) {
    headers['x-workspace-session-epoch'] = session.sessionEpoch.toString();
  }

  return headers;
}
