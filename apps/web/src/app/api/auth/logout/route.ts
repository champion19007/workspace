import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import {
  SESSION_COOKIE_NAME,
  verifyAndRefreshSession,
} from '@/lib/session';

export async function POST(request: NextRequest) {
  try {
    const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const { session } = verifyAndRefreshSession(rawCookie);

    if (session) {
      const { ports } = getServerContext();
      try {
        await ports.auth.revokeSession(session.userId);
      } catch (err) {
        console.warn('Provider session revocation warning:', err);
      }
    }

    const response = NextResponse.json({ success: true });
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  } catch (err) {
    console.error('Logout error:', err);
    const response = NextResponse.json({ success: true });
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }
}
