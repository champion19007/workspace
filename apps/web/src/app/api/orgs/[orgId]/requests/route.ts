import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { listRequests } from '@workspace/db';
import { ListRequestsQuerySchema } from '@workspace/core';

/** Requests sent through request forms to projects the caller can see. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const parsed = ListRequestsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) return problemJson(422, 'VALIDATION_ERROR', 'Invalid status', instance);
    const requests = await listRequests(sql, { orgId: tenant.orgId, userId: session.userId, role: tenant.role, ...parsed.data });
    return NextResponse.json({ requests });
  } catch (err) {
    return problemFromError(err, instance);
  }
}
