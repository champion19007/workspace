import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerContext } from '@/lib/server-context';
import {
  SESSION_COOKIE_NAME,
  getCookieOptions,
  verifyAndRefreshSession,
  serializeSession,
} from '@/lib/session';
import { getMembershipContext } from '@workspace/db';
import { rotateSession, type OrgRole } from '@workspace/core';

const SwitchOrgSchema = z.object({
  orgId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = SwitchOrgSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid organization ID' }, { status: 422 });
  }

  const { db } = getServerContext();
  const membership = await getMembershipContext(db, parsed.data.orgId, session.userId);

  if (!membership) {
    return NextResponse.json({ error: 'You are not a member of this organization' }, { status: 403 });
  }

  const rotated = rotateSession(session, {
    activeOrgId: membership.orgId,
    role: membership.role as OrgRole,
    sessionEpoch: membership.sessionEpoch,
  });

  const response = NextResponse.json({
    success: true,
    activeOrgId: rotated.activeOrgId,
    role: rotated.role,
  });

  response.cookies.set(SESSION_COOKIE_NAME, serializeSession(rotated), getCookieOptions());
  return response;
}
