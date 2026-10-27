import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { authorizeMeetingAccess, getRoutingCandidatesForUser } from '@workspace/db';
import { DomainError, isReadOnlyRole } from '@workspace/core';

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

    // Project privacy first: hosting does not bypass a private project (inaccessible -> 404).
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
    const currentMeeting = auth.meeting!;

    if (isReadOnlyRole(tenant.role)) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Viewers cannot view routing candidates' },
        { status: 403 }
      );
    }

    if (tenant.role === 'member') {
      const isHost =
        currentMeeting.hostId === session.userId; // verified binding only; no email fallback
      if (!isHost) {
        return NextResponse.json(
          { error: 'FORBIDDEN', message: 'You can only view routing candidates for meetings you hosted' },
          { status: 403 }
        );
      }
    }

    const candidates = await getRoutingCandidatesForUser(sql, {
      orgId: tenant.orgId,
      userId: session.userId,
    });

    return NextResponse.json({ candidates });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status }
      );
    }
    console.error('Error fetching routing candidates in BFF:', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to retrieve routing candidates' },
      { status: 500 }
    );
  }
}
