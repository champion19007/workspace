import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { getDocVersion } from '@workspace/db';
import { DomainError } from '@workspace/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; docId: string; version: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, docId, version: versionStr } = await params;
  const versionNum = parseInt(versionStr, 10);
  if (isNaN(versionNum) || versionNum < 1) {
    return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'Version must be a positive integer' }, { status: 422 });
  }

  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const snapshot = await getDocVersion(db, {
      orgId: tenant.orgId,
      docId,
      version: versionNum,
      userId: session.userId,
      role: tenant.role,
    });

    return NextResponse.json(snapshot);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error fetching doc version:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch version snapshot' }, { status: 500 });
  }
}
