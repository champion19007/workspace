import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { listActionItemsForReview } from '@workspace/db';
import { ListActionItemsQuerySchema } from '@workspace/core';

/** Stage 17 approval inbox: permission-filtered action items (same query contract as GET /api/v1/.../action-items). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const parsed = ListActionItemsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) {
      return problemJson(422, 'VALIDATION_ERROR', 'Invalid action item query parameters', instance, {
        details: parsed.error.format(),
      });
    }
    const page = await listActionItemsForReview(sql, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
      query: parsed.data,
    });
    return NextResponse.json(page);
  } catch (err) {
    return problemFromError(err, instance);
  }
}
