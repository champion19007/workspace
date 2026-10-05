import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import {
  SESSION_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  getCookieOptions,
  serializeSession,
} from '@/lib/session';
import {
  createSessionPayload,
  type AuthUser,
  type OrgRole,
} from '@workspace/core';
import {
  findOrCreateUserByEmail,
  getUserOrganizations,
} from '@workspace/db';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const token = searchParams.get('token');
  const emailParam = searchParams.get('email');
  const returnTo = searchParams.get('returnTo');

  // Open redirect protection: destination must be relative and start with /
  let safeDestination = '/onboarding';
  if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('\\')) {
    safeDestination = returnTo;
  }

  try {
    const { ports, db } = getServerContext();
    let authUser: AuthUser;
    let providerRefreshToken: string | undefined;

    if (code) {
      // 1. OAuth code flow
      const storedState = request.cookies.get(OAUTH_STATE_COOKIE_NAME)?.value;
      if (state && storedState && state !== storedState) {
        console.warn('OAuth state mismatch rejected');
        return NextResponse.redirect(new URL('/auth/error?reason=csrf_state_mismatch', request.url), 302);
      }

      const result = await ports.auth.exchangeOAuthCode({ code });
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
      return NextResponse.redirect(new URL('/auth/error?reason=missing_credentials', request.url), 302);
    }

    // 3. Sync or create user in PostgreSQL
    const domainUser = await findOrCreateUserByEmail(db, {
      email: authUser.email,
      supabaseUid: authUser.providerUserId,
    });

    // 4. Resolve user's organizations
    const userOrgs = await getUserOrganizations(db, domainUser.id);

    let activeOrgId: string | null = null;
    let role: OrgRole | null = null;
    let sessionEpoch = 1;

    if (userOrgs.length > 0 && userOrgs[0]) {
      activeOrgId = userOrgs[0].orgId;
      role = userOrgs[0].role as OrgRole;
      sessionEpoch = userOrgs[0].sessionEpoch;
      safeDestination = `/orgs/${activeOrgId}`;
    }

    // 5. Create 30-day rolling encrypted session
    const sessionPayload = createSessionPayload({
      userId: domainUser.id,
      email: domainUser.email,
      activeOrgId,
      role,
      sessionEpoch,
      providerRefreshToken,
    });

    const encryptedCookieValue = serializeSession(sessionPayload);
    const destinationUrl = new URL(safeDestination, request.url);
    const response = NextResponse.redirect(destinationUrl, 302);

    // Set secure httpOnly session cookie
    response.cookies.set(SESSION_COOKIE_NAME, encryptedCookieValue, getCookieOptions());

    // Clean up temporary OAuth state cookie
    response.cookies.delete(OAUTH_STATE_COOKIE_NAME);

    return response;
  } catch (err) {
    console.error('Authentication callback error:', err);
    return NextResponse.redirect(new URL('/auth/error?reason=auth_callback_failed', request.url), 302);
  }
}
