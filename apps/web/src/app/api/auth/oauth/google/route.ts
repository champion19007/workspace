import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { generateSecureRandomToken } from '@workspace/core';
import { OAUTH_STATE_COOKIE_NAME } from '@/lib/session';

export async function GET(request: NextRequest) {
  try {
    const { ports } = getServerContext();
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const callbackUrl = `${protocol}://${host}/api/auth/callback`;

    const state = generateSecureRandomToken(16);
    const { url } = await ports.auth.getOAuthUrl({
      provider: 'google',
      redirectUrl: callbackUrl,
      state,
    });

    const response = NextResponse.redirect(url, 302);
    // Temporary state cookie for CSRF protection
    response.cookies.set(OAUTH_STATE_COOKIE_NAME, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600, // 10 minutes
    });

    return response;
  } catch (err) {
    console.error('OAuth initiation error:', err);
    return NextResponse.redirect(new URL('/auth/error?reason=oauth_init_failed', request.url), 302);
  }
}
