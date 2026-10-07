import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { createTask, listTasks } from '@workspace/db';
import {
  CreateTaskSchema,
  ListTasksQuerySchema,
  DomainError,
  formatETag,
  ValidationError,
} from '@workspace/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; projectId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, projectId } = await params;
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = ListTasksQuerySchema.safeParse(searchParams);

    const tasks = await listTasks(db, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
      projectId,
      status: parsed.success ? parsed.data.status : undefined,
      priority: parsed.success ? parsed.data.priority : undefined,
      assigneeId: parsed.success ? parsed.data.assigneeId : undefined,
      parentTaskId: parsed.success ? parsed.data.parentTaskId : undefined,
      includeArchived: parsed.success ? parsed.data.includeArchived : undefined,
    });

    return NextResponse.json({ tasks });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error listing project tasks:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to list tasks' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; projectId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, projectId } = await params;
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const body = await request.json().catch(() => ({}));

    if (body && (body.source === 'ai_suggested' || body.source === 'approved_ai' || body.sourceRef)) {
      throw new ValidationError('Client cannot set source or forge AI provenance');
    }

    const payload = { ...body, projectId };
    const parsed = CreateTaskSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid task creation input', details: parsed.error.format() },
        { status: 422 }
      );
    }

    const task = await createTask(db, {
      orgId: tenant.orgId,
      actorUserId: session.userId,
      role: tenant.role,
      input: parsed.data,
    });

    const response = NextResponse.json(task, { status: 201 });
    response.headers.set('ETag', formatETag(task.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error creating task:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to create task' }, { status: 500 });
  }
}
