import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { getTaskById, moveTask } from '@workspace/db';
import {
  MoveTaskSchema,
  DomainError,
  PreconditionRequiredError,
  PreconditionFailedError,
  formatETag,
  parseStrongETag,
  isWeakETag,
} from '@workspace/core';

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
    const parsed = MoveTaskSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid task move input', details: parsed.error.format() },
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

    // Step 2: Strict strong If-Match check
    const ifMatchHeader = request.headers.get('if-match');
    if (!ifMatchHeader) {
      throw new PreconditionRequiredError(
        'If-Match header is required for task reordering to ensure optimistic concurrency control'
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

    // Step 3: Perform atomic 1-row move in tasks table
    const updated = await moveTask(db, {
      orgId: tenant.orgId,
      taskId,
      actorUserId: session.userId,
      role: tenant.role,
      ifMatchVersion: expectedVersion,
      input: parsed.data,
    });

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
    console.error('Error moving task:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to move task' }, { status: 500 });
  }
}
