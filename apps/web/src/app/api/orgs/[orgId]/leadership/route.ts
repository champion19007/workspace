import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { getLeadershipSummary } from '@workspace/db';
import { LeadershipSummaryQuerySchema, DomainError } from '@workspace/core';

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
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const searchParams = request.nextUrl.searchParams;

    const queryPayload = {
      teamId: searchParams.get('teamId') || undefined,
      health: searchParams.get('health') || undefined,
      search: searchParams.get('search') || undefined,
    };

    const parsed = LeadershipSummaryQuerySchema.safeParse(queryPayload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid leadership query parameters', details: parsed.error.format() },
        { status: 422 }
      );
    }

    const dateContext = searchParams.get('dateContext') || undefined;

    const result = await getLeadershipSummary(db, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
      filters: parsed.data,
      dateContext,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error fetching leadership summary:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch leadership summary' }, { status: 500 });
  }
}
