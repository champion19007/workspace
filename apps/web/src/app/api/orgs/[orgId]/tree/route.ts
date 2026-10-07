import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { getTree } from '@workspace/db';
import { TreeQuerySchema, DomainError } from '@workspace/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier } = await params;
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);

    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = TreeQuerySchema.safeParse(searchParams);
    const depth = parsed.success ? parsed.data.depth : 5;
    const root = parsed.success ? parsed.data.root : undefined;
    const includeArchived = parsed.success ? parsed.data.includeArchived : false;

    const nodes = await getTree(db, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
      depth,
      rootNodeId: root,
      includeArchived,
    });

    return NextResponse.json({ nodes });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error fetching tree:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch tree' }, { status: 500 });
  }
}
