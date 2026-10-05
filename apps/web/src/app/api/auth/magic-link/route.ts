import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerContext } from '@/lib/server-context';

const MagicLinkSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  redirectUrl: z.string().optional(),
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
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const callbackUrl = `${protocol}://${host}/api/auth/callback`;

    await ports.auth.requestPasswordless({
      email: parsed.data.email,
      redirectUrl: parsed.data.redirectUrl || callbackUrl,
    });

    // Generic response to prevent account enumeration
    return NextResponse.json({
      success: true,
      message: 'If an account exists with this email address, a secure sign-in link has been sent.',
    });
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
