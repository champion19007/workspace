import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { authorizeMeetingAccess } from '@workspace/db';
import { DomainError, formatETag } from '@workspace/core';

/** Single meeting, used by ?meeting=<id> deep links (task provenance, approvals inbox) outside the loaded list. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; meetingId: string }> }
) {
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, meetingId } = await params;
  // The id comes from a URL query in the page: malformed ids are simply not found.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(meetingId)) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'Meeting not found' }, { status: 404 });
  }
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
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
    const response = NextResponse.json({ meeting: auth.meeting });
    response.headers.set('ETag', formatETag(auth.meeting!.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error fetching meeting in BFF:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve meeting' }, { status: 500 });
  }
}
