import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerContext } from '@/lib/server-context';
import { PKCE_COOKIE_NAME, authCallbackUrl, getPkceCookieOptions } from '@/lib/session';

const MagicLinkSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  // Where to land after signing in (e.g. an invitation). The link itself always comes back to this app.
  returnTo: z.string().max(2048).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = MagicLinkSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          message: parsed.error.issues[0]?.message || 'Invalid email address',
        },
        { status: 422 }
      );
    }

    const { ports } = getServerContext();
    const { codeVerifier } = await ports.auth.requestPasswordless({
      email: parsed.data.email,
      redirectUrl: authCallbackUrl(request, parsed.data.returnTo),
    });

    // Generic response to prevent account enumeration
    const response = NextResponse.json({
      success: true,
      message: 'If an account exists with this email address, a secure sign-in link has been sent.',
    });
    if (codeVerifier) response.cookies.set(PKCE_COOKIE_NAME, codeVerifier, getPkceCookieOptions());
    return response;
  } catch (err) {
    console.error('Magic link request error:', err);
    return NextResponse.json(
      {
        error: 'Authentication error',
        message: 'Unable to process sign-in request at this time. Please try again.',
      },
      { status: 500 }
    );
  }
}
