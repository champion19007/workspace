import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import {
  SESSION_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  PKCE_COOKIE_NAME,
  getCookieOptions,
  safeReturnTo,
} from '@/lib/session';
import { startSession } from '@/lib/sign-in';
import type { AuthUser } from '@workspace/core';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const token = searchParams.get('token');
  const emailParam = searchParams.get('email');
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const pkceState = request.cookies.get(PKCE_COOKIE_NAME)?.value;

  // Every exit drops the one-time PKCE cookie.
  const fail = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/auth/error?reason=${reason}`, request.url), 302);
    response.cookies.delete({ name: PKCE_COOKIE_NAME, path: '/api/auth' });
    return response;
  };

  // The provider reports problems as query parameters (e.g. an expired email link).
  const providerError = searchParams.get('error_code') ?? searchParams.get('error');
  if (providerError && !code) {
    return fail(providerError === 'otp_expired' ? 'invalid_or_expired' : 'auth_callback_failed');
  }

  try {
    const { config, ports, db } = getServerContext();
    let authUser: AuthUser;
    let providerRefreshToken: string | undefined;

    if (code) {
      // 1. OAuth code flow
      const storedState = request.cookies.get(OAUTH_STATE_COOKIE_NAME)?.value;
      if (state && storedState && state !== storedState) {
        console.warn('OAuth state mismatch rejected');
        return fail('csrf_state_mismatch');
      }
      // Supabase codes (Google and email links) can only be finished with the PKCE state from the start.
      if (config.AUTH_PROVIDER === 'supabase' && !pkceState) {
        return fail('different_browser');
      }

      const result = await ports.auth.exchangeOAuthCode({ code, codeVerifier: pkceState });
      authUser = result.user;
      providerRefreshToken = result.tokens.refreshToken;
    } else if (token && emailParam) {
      // 2. Magic link flow
      const result = await ports.auth.verifyPasswordless({
        email: emailParam,
        tokenOrCode: token,
      });
      authUser = result.user;
      providerRefreshToken = result.tokens.refreshToken;
    } else {
      return fail('missing_credentials');
    }

    // 3. Their user, organization and session
    const { cookieValue, destination } = await startSession(db, authUser, providerRefreshToken, returnTo);
    const response = NextResponse.redirect(new URL(destination, request.url), 302);

    // Set secure httpOnly session cookie
    response.cookies.set(SESSION_COOKIE_NAME, cookieValue, getCookieOptions());

    // Clean up temporary OAuth state cookies
    response.cookies.delete(OAUTH_STATE_COOKIE_NAME);
    response.cookies.delete({ name: PKCE_COOKIE_NAME, path: '/api/auth' });

    return response;
  } catch (err) {
    console.error('Authentication callback error:', err);
    return fail('auth_callback_failed');
  }
}
