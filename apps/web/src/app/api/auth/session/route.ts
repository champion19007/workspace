import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE_NAME,
  getCookieOptions,
  verifyAndRefreshSession,
} from '@/lib/session';

export async function GET(request: NextRequest) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session, refreshedCookie } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    const response = NextResponse.json({ authenticated: false }, { status: 401 });
    if (rawCookie) {
      response.cookies.delete(SESSION_COOKIE_NAME);
    }
    return response;
  }

  const response = NextResponse.json({
    authenticated: true,
    user: {
      id: session.userId,
      email: session.email,
    },
    activeOrgId: session.activeOrgId,
    role: session.role,
    sessionEpoch: session.sessionEpoch,
    expiresAt: new Date(session.expiresAt).toISOString(),
  });

  // Roll session forward if refreshed
  if (refreshedCookie) {
    response.cookies.set(SESSION_COOKIE_NAME, refreshedCookie, getCookieOptions());
  }

  return response;
}
