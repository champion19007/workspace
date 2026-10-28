import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerContext } from '@/lib/server-context';
import { PKCE_COOKIE_NAME, SESSION_COOKIE_NAME, getCookieOptions, safeReturnTo } from '@/lib/session';
import { startSession } from '@/lib/sign-in';
import { rateLimited } from '@/lib/rate-limit';
import { problemFromError, problemJson } from '@/lib/problem';

const VerifyCodeSchema = z.object({
  email: z.string().email('Enter the email address the code was sent to'),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email'),
  returnTo: z.string().max(2048).optional(),
});

/**
 * Signs in with the 6-digit code from the sign-in email. Unlike the link, the code works in any browser, so it
 * rescues people whose email opens on another device, or in an app's built-in browser.
 */
export async function POST(request: NextRequest) {
  const instance = request.nextUrl.pathname;
  const parsed = VerifyCodeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return problemJson(422, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Enter the 6-digit code from the email', instance);
  }
  const email = parsed.data.email.toLowerCase();

  // A million possible codes and five tries every 15 minutes: guessing one before it expires is hopeless.
  const limited = await rateLimited(
    [{ key: `sign-in-code:${email}`, limit: 5, windowSeconds: 900 }],
    instance,
    'Too many tries. Wait a few minutes, or ask for a new email.'
  );
  if (limited) return limited;

  const { ports, db } = getServerContext();
  let verified;
  try {
    verified = await ports.auth.verifyPasswordless({ email, tokenOrCode: parsed.data.code });
  } catch {
    // Wrong, already used or expired: the provider doesn't say which, and neither do we.
    return problemJson(401, 'INVALID_CODE', "That code didn't work. Check it, or ask for a new email.", instance);
  }

  try {
    const { cookieValue, destination } = await startSession(
      db,
      verified.user,
      verified.tokens.refreshToken,
      safeReturnTo(parsed.data.returnTo)
    );
    const response = NextResponse.json({ redirectTo: destination });
    response.cookies.set(SESSION_COOKIE_NAME, cookieValue, getCookieOptions());
    response.cookies.delete({ name: PKCE_COOKIE_NAME, path: '/api/auth' });
    return response;
  } catch (err) {
    return problemFromError(err, instance);
  }
}
