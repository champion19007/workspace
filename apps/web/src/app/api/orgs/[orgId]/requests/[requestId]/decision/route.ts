import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { decideRequest } from '@workspace/db';
import { DecideRequestSchema, isValidUuid } from '@workspace/core';

/** Accept (it becomes a task) or decline a request. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ orgId: string; requestId: string }> }) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier, requestId } = await params;
  if (!isValidUuid(requestId)) return problemJson(404, 'NOT_FOUND', 'Request not found', instance);
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const parsed = DecideRequestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return problemJson(422, 'VALIDATION_ERROR', 'Choose accept or decline', instance);
    const decided = await decideRequest(sql, {
      orgId: tenant.orgId,
      actorUserId: session.userId,
      role: tenant.role,
      requestId,
      decision: parsed.data.decision,
    });
    return NextResponse.json(decided);
  } catch (err) {
    return problemFromError(err, instance);
  }
}
