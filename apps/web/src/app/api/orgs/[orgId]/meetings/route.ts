import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { listOrgMeetings } from '@workspace/db';
import { DomainError, type ZoomMeetingStatus } from '@workspace/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const searchParams = request.nextUrl.searchParams;

    const statusParam = searchParams.get('status') as ZoomMeetingStatus | null;
    const queryParam = searchParams.get('query') || undefined;
    const limitParam = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;
    const offsetParam = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : 0;

    const meetings = await listOrgMeetings(sql, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
      status: statusParam || undefined,
      query: queryParam,
      limit: limitParam,
      offset: offsetParam,
    });

    return NextResponse.json({ meetings });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error listing organization meetings in BFF:', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to list meetings' },
      { status: 500 }
    );
  }
}
