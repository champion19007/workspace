import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { authorizeMeetingAccess, getMeetingNotesAndSuggestions } from '@workspace/db';
import { DomainError, formatETag } from '@workspace/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; meetingId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Authentication required' },
      { status: 401 }
    );
  }

  const { orgId: orgIdentifier, meetingId } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);

    // Same centralised rule as the Fastify notes route: project privacy governs routed meetings
    // (hosting does not bypass it, inaccessible -> 404); viewers may read.
    const auth = await authorizeMeetingAccess(sql, {
      orgId: tenant.orgId,
      meetingId,
      userId: session.userId,
      userRole: tenant.role,
      action: 'read',
    });
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.errorCode, message: auth.errorMessage }, { status: auth.httpStatus });
    }

    const result = await getMeetingNotesAndSuggestions(sql, tenant.orgId, meetingId, {
      userId: session.userId,
      role: tenant.role,
    });

    const response = NextResponse.json(result);
    response.headers.set('ETag', formatETag(auth.meeting!.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status }
      );
    }
    console.error('Error fetching meeting notes in BFF:', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to retrieve meeting notes' },
      { status: 500 }
    );
  }
}
