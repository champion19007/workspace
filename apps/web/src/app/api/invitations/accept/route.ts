import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerContext } from '@/lib/server-context';
import {
  SESSION_COOKIE_NAME,
  getCookieOptions,
  verifyAndRefreshSession,
  serializeSession,
} from '@/lib/session';
import { acceptMemberInvitation } from '@workspace/db';
import { rotateSession, hashToken, DomainError, type OrgRole } from '@workspace/core';

const AcceptInviteSchema = z.object({
  token: z.string().min(16),
});

export async function POST(request: NextRequest) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized', message: 'Please sign in first to accept this invitation' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = AcceptInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 422 });
  }

  try {
    const { db } = getServerContext();
    const tokenHash = hashToken(parsed.data.token);

    const result = await acceptMemberInvitation(db, {
      tokenHash,
      userId: session.userId,
      userEmail: session.email,
    });

    if (!result.membership) {
      return NextResponse.json({ error: 'FAILED_MEMBERSHIP', message: 'Failed to establish membership' }, { status: 500 });
    }

    // Rotate session into newly joined organization
    const rotated = rotateSession(session, {
      activeOrgId: result.org.id,
      role: result.membership.role as OrgRole,
      sessionEpoch: result.membership.sessionEpoch,
    });

    const response = NextResponse.json(result, { status: 200 });
    response.cookies.set(SESSION_COOKIE_NAME, serializeSession(rotated), getCookieOptions());
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Accept invite error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to accept invitation' }, { status: 500 });
  }
}
