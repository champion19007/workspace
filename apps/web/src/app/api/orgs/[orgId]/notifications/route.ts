import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { listNotifications, markNotificationsRead } from '@workspace/db';
import { MarkNotificationsReadSchema } from '@workspace/core';

/** The signed-in person's latest notifications in this organization, and how many are unread. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const list = await listNotifications(sql, { orgId: tenant.orgId, userId: session.userId, role: tenant.role });
    return NextResponse.json(list);
  } catch (err) {
    return problemFromError(err, instance);
  }
}

/** Marks notifications as read: the given `ids`, or all of them. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const parsed = MarkNotificationsReadSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return problemJson(422, 'VALIDATION_ERROR', 'Invalid notification ids', instance);
    await markNotificationsRead(sql, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
      ids: parsed.data.ids,
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    return problemFromError(err, instance);
  }
}
