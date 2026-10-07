import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { getProjectDashboard } from '@workspace/db';
import { DomainError } from '@workspace/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; projectId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, projectId } = await params;
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const searchParams = request.nextUrl.searchParams;
    const dateContext = searchParams.get('dateContext') || undefined;

    const result = await getProjectDashboard(db, {
      orgId: tenant.orgId,
      projectId,
      userId: session.userId,
      role: tenant.role,
      dateContext,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error fetching project dashboard:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch project dashboard' }, { status: 500 });
  }
}
