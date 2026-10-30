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
/** PKCE state from the sign-in start (Google or email link), needed by /api/auth/callback to finish. */
export const PKCE_COOKIE_NAME = 'workspace_pkce';

export function getSessionSecret(): string {
  if (process.env.NODE_ENV === 'production') {
    // The development fallback below is public (it's in the repository): anyone could forge sessions with it.
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters (see docs/deploy-vercel.md)');
    }
    return secret;
  }
  return (
    process.env.SESSION_SECRET ||
    process.env.ORIGIN_VERIFY_SECRET ||
    'workspace-dev-default-secret-key-32chars'
  );
}

/** Open-redirect protection: only same-site relative paths survive as a post-sign-in destination. */
export function safeReturnTo(value: string | null | undefined): string | null {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : null;
}

/** Where the auth provider sends people back to, on the host that served this request. */
export function authCallbackUrl(request: Request, returnTo?: string | null): string {
  const host = request.headers.get('host') || 'localhost:3000';
  const protocol = request.headers.get('x-forwarded-proto') || 'http';
  const url = new URL(`${protocol}://${host}/api/auth/callback`);
  const safe = safeReturnTo(returnTo);
  if (safe) url.searchParams.set('returnTo', safe);
  return url.toString();
}

export function getPkceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/auth',
    maxAge: 60 * 60, // as long as an email sign-in link stays valid
  };
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
