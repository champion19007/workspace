import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { getActionItemForUser } from '@workspace/db';
import { formatETag } from '@workspace/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; actionItemId: string }> }
) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier, actionItemId } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const item = await getActionItemForUser(sql, {
      orgId: tenant.orgId,
      actionItemId,
      userId: session.userId,
      role: tenant.role,
    });
    const response = NextResponse.json(item);
    response.headers.set('ETag', formatETag(item.version!));
    return response;
  } catch (err) {
    return problemFromError(err, instance);
  }
}
