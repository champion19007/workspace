import { type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { deleteComment } from '@workspace/db';
import { isValidUuid } from '@workspace/core';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; commentId: string }> }
) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier, commentId } = await params;
  if (!isValidUuid(commentId)) return problemJson(404, 'NOT_FOUND', 'Comment not found', instance);
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    await deleteComment(sql, { orgId: tenant.orgId, actorUserId: session.userId, role: tenant.role, commentId });
    return new Response(null, { status: 204 });
  } catch (err) {
    return problemFromError(err, instance);
  }
}
