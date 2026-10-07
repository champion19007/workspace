import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { createSubtask, listTasks, getTaskById } from '@workspace/db';
import {
  CreateSubtaskSchema,
  DomainError,
  formatETag,
  ValidationError,
} from '@workspace/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; taskId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, taskId } = await params;
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    // Verify access to parent task first
    await getTaskById(db, {
      orgId: tenant.orgId,
      taskId,
      userId: session.userId,
      role: tenant.role,
    });

    const subtasks = await listTasks(db, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
      parentTaskId: taskId,
    });

    return NextResponse.json({ subtasks });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error listing subtasks:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to list subtasks' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; taskId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, taskId } = await params;
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const body = await request.json().catch(() => ({}));

    if (body && (body.source === 'ai_suggested' || body.source === 'approved_ai' || body.sourceRef)) {
      throw new ValidationError('Client cannot set source or forge AI provenance');
    }

    const parsed = CreateSubtaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid subtask creation input', details: parsed.error.format() },
        { status: 422 }
      );
    }

    const subtask = await createSubtask(db, {
      orgId: tenant.orgId,
      parentTaskId: taskId,
      actorUserId: session.userId,
      role: tenant.role,
      input: parsed.data,
    });

    const response = NextResponse.json(subtask, { status: 201 });
    response.headers.set('ETag', formatETag(subtask.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error creating subtask:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to create subtask' }, { status: 500 });
  }
}
