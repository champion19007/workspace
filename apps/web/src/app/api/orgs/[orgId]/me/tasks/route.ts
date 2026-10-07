import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { getMyTasks } from '@workspace/db';
import { MyTasksQuerySchema, DomainError } from '@workspace/core';

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

    const searchParams = request.nextUrl.searchParams;
    const queryPayload = {
      projectId: searchParams.get('projectId') || undefined,
      status: searchParams.get('status') || undefined,
      priority: searchParams.get('priority') || undefined,
      category: searchParams.get('category') || 'all',
      search: searchParams.get('search') || undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : 50,
      cursor: searchParams.get('cursor') || undefined,
    };

    const parsed = MyTasksQuerySchema.safeParse(queryPayload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid my-tasks query parameters', details: parsed.error.format() },
        { status: 422 }
      );
    }

    // Security: Assignee identity resolved strictly from session.userId.
    // Callers cannot impersonate other users.
    const result = await getMyTasks(db, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
      query: parsed.data,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error fetching my-tasks:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch my-tasks' }, { status: 500 });
  }
}
