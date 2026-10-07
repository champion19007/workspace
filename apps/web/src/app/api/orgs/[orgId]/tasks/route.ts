import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { listTasks } from '@workspace/db';
import { ListTasksQuerySchema, DomainError } from '@workspace/core';

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
    const parsed = ListTasksQuerySchema.safeParse(searchParams);

    const tasks = await listTasks(db, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
      projectId: parsed.success ? parsed.data.projectId : undefined,
      status: parsed.success ? parsed.data.status : undefined,
      priority: parsed.success ? parsed.data.priority : undefined,
      assigneeId: parsed.success ? parsed.data.assigneeId : undefined,
      parentTaskId: parsed.success ? parsed.data.parentTaskId : undefined,
      includeArchived: parsed.success ? parsed.data.includeArchived : undefined,
      limit: parsed.success ? parsed.data.limit : undefined,
    });

    return NextResponse.json({ tasks });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error listing org tasks:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to list tasks' }, { status: 500 });
  }
}
