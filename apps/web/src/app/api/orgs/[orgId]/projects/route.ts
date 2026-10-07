import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { listProjects } from '@workspace/db';
import { ProjectsQuerySchema, DomainError } from '@workspace/core';

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
    const parsed = ProjectsQuerySchema.safeParse(searchParams);

    const teamId = parsed.success ? parsed.data.teamId : undefined;
    const search = parsed.success ? parsed.data.search : undefined;
    const limit = parsed.success ? parsed.data.limit : 50;
    const cursor = parsed.success ? parsed.data.cursor : undefined;

    const result = await listProjects(db, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
      teamId,
      search,
      limit,
      cursor,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error listing projects:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to list projects' }, { status: 500 });
  }
}
