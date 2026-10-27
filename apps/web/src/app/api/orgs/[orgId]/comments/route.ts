import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { createComment, listComments } from '@workspace/db';
import { CommentTargetQuerySchema, CreateCommentSchema } from '@workspace/core';

/** Comments on one task, project (`node`) or doc, oldest first. */
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
    const comments = await listComments(sql, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
      ...parsed.data,
    });
    return NextResponse.json({ comments });
  } catch (err) {
    return problemFromError(err, instance);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const parsed = CreateCommentSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid comment';
      return problemJson(422, 'VALIDATION_ERROR', message, instance);
    }
    const comment = await createComment(sql, {
      orgId: tenant.orgId,
      actorUserId: session.userId,
      role: tenant.role,
      input: parsed.data,
    });
    return NextResponse.json(comment, { status: 201 });
  } catch (err) {
    return problemFromError(err, instance);
  }
}
