import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { getTaskById, updateTask, archiveTask, moveTask } from '@workspace/db';
import {
  UpdateTaskSchema,
  DomainError,
  PreconditionRequiredError,
  PreconditionFailedError,
  formatETag,
  parseStrongETag,
  isWeakETag,
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
    const task = await getTaskById(db, {
      orgId: tenant.orgId,
      taskId,
      userId: session.userId,
      role: tenant.role,
    });

    const response = NextResponse.json(task);
    response.headers.set('ETag', formatETag(task.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error fetching task:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch task' }, { status: 500 });
  }
}

export async function PATCH(
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
    const parsed = UpdateTaskSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid task update input', details: parsed.error.format() },
        { status: 422 }
      );
    }

    // Step 1: Read current task & verify permission first
    const currentTask = await getTaskById(db, {
      orgId: tenant.orgId,
      taskId,
      userId: session.userId,
      role: tenant.role,
    });

    // Step 2: Strict If-Match check
    const ifMatchHeader = request.headers.get('if-match');
    if (!ifMatchHeader) {
      throw new PreconditionRequiredError(
        'If-Match header is required for task updates to ensure optimistic concurrency control'
      );
    }

    if (isWeakETag(ifMatchHeader)) {
      throw new PreconditionFailedError(
        `Weak entity tags (${ifMatchHeader}) do not satisfy strong comparison for If-Match. Strong ETag required (e.g. "v${currentTask.version}").`,
        currentTask
      );
    }

    const expectedVersion = parseStrongETag(ifMatchHeader);
    if (expectedVersion === null || expectedVersion !== currentTask.version) {
      throw new PreconditionFailedError(
        `Version conflict: task has been updated to version ${currentTask.version} (requested ${ifMatchHeader})`,
        currentTask
      );
    }

    // Step 3: Perform atomic update or move
    let updated;
    if (parsed.data.prevTaskId !== undefined || parsed.data.nextTaskId !== undefined) {
      updated = await moveTask(db, {
        orgId: tenant.orgId,
        taskId,
        actorUserId: session.userId,
        role: tenant.role,
        ifMatchVersion: expectedVersion,
        input: {
          status: parsed.data.status,
          prevTaskId: parsed.data.prevTaskId,
          nextTaskId: parsed.data.nextTaskId,
        },
      });
    } else {
      updated = await updateTask(db, {
        orgId: tenant.orgId,
        taskId,
        actorUserId: session.userId,
        role: tenant.role,
        ifMatchVersion: expectedVersion,
        input: parsed.data,
      });
    }

    const response = NextResponse.json(updated);
    response.headers.set('ETag', formatETag(updated.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
          currentEntity: err instanceof PreconditionFailedError ? err.details : undefined,
        },
        { status: err.status }
      );
    }
    console.error('Error updating task:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to update task' }, { status: 500 });
  }
}

export async function DELETE(
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
    const ifMatchHeader = request.headers.get('if-match');
    const ifMatchVersion = ifMatchHeader ? parseStrongETag(ifMatchHeader) ?? undefined : undefined;

    const archived = await archiveTask(db, {
      orgId: tenant.orgId,
      taskId,
      actorUserId: session.userId,
      role: tenant.role,
      ifMatchVersion,
    });

    const response = NextResponse.json(archived);
    response.headers.set('ETag', formatETag(archived.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error archiving task:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to archive task' }, { status: 500 });
  }
}
