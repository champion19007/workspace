import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { listZoomHostConsents } from '@workspace/db';
import { DomainError } from '@workspace/core';

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
    const query = request.nextUrl.searchParams.get('query') || undefined;
    const consentStatus = request.nextUrl.searchParams.get('consentStatus') || undefined;

    const hosts = await listZoomHostConsents(sql, {
      orgId: tenant.orgId,
      query,
      consentStatus,
    });

    return NextResponse.json({ hosts });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to list Zoom hosts' }, { status: 500 });
  }
}
