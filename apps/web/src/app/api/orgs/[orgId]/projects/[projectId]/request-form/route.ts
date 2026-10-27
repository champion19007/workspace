import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { getRequestForm, saveRequestForm } from '@workspace/db';
import { SaveRequestFormSchema } from '@workspace/core';

type Params = { params: Promise<{ orgId: string; projectId: string }> };

/** The project's public request form (`null` when it never had one). */
export async function GET(request: NextRequest, { params }: Params) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier, projectId } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const form = await getRequestForm(sql, { orgId: tenant.orgId, userId: session.userId, role: tenant.role, nodeId: projectId });
    return NextResponse.json({ form });
  } catch (err) {
    return problemFromError(err, instance);
  }
}

/** Turns the form on or off and sets its introduction. */
export async function PUT(request: NextRequest, { params }: Params) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier, projectId } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const parsed = SaveRequestFormSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return problemJson(422, 'VALIDATION_ERROR', 'Invalid request form settings', instance);
    const form = await saveRequestForm(sql, {
      orgId: tenant.orgId,
      actorUserId: session.userId,
      role: tenant.role,
      nodeId: projectId,
      ...parsed.data,
    });
    return NextResponse.json({ form });
  } catch (err) {
    return problemFromError(err, instance);
  }
}
