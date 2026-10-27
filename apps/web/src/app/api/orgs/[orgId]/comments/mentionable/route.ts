import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { listMentionableUsers } from '@workspace/db';
import { CommentTargetQuerySchema } from '@workspace/core';

/** Who can be @mentioned on a task, project or doc: the people who can read it. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const parsed = CommentTargetQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) return problemJson(422, 'VALIDATION_ERROR', 'Choose a task, project or doc', instance);
    const people = await listMentionableUsers(sql, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
      ...parsed.data,
    });
    return NextResponse.json({ people });
  } catch (err) {
    return problemFromError(err, instance);
  }
}
