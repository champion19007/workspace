import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { authorizeMeetingAccess, manuallyRouteMeeting } from '@workspace/db';
import {
  DomainError,
  RouteMeetingRequestSchema,
  parseStrongETag,
  isWeakETag,
  formatETag,
} from '@workspace/core';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; meetingId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Authentication required' },
      { status: 401 }
    );
  }

  const { orgId: orgIdentifier, meetingId } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);

    // Centralised meeting authorization first: 404 for inaccessible private meetings, 403 for Viewers
    const auth = await authorizeMeetingAccess(sql, {
      orgId: tenant.orgId,
      meetingId,
      userId: session.userId,
      userRole: tenant.role,
      action: 'mutate',
    });
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.errorCode, message: auth.errorMessage }, { status: auth.httpStatus });
    }
    const currentMeeting = auth.meeting!;

    // Stricter rule for this route: Members may only route meetings they hosted (verified binding only)
    if (tenant.role === 'member' && currentMeeting.hostId !== session.userId) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'You can only route meetings you hosted' },
        { status: 403 }
      );
    }

    // 1. Enforce strong If-Match header (RFC 9110)
    const ifMatchHeader = request.headers.get('if-match');
    if (!ifMatchHeader) {
      return NextResponse.json(
        {
          error: 'PRECONDITION_REQUIRED',
          message: 'If-Match header is required for route operations (expected "v<version>")',
        },
        { status: 428 }
      );
    }

    if (isWeakETag(ifMatchHeader)) {
      return NextResponse.json(
        {
          error: 'PRECONDITION_FAILED',
          message: 'Weak entity tags are not accepted for state modification',
        },
        { status: 412 }
      );
    }

    const expectedVersion = parseStrongETag(ifMatchHeader);
    if (expectedVersion === null) {
      return NextResponse.json(
        {
          error: 'PRECONDITION_FAILED',
          message: 'Invalid If-Match format. Expected strong ETag format: "v<version>"',
        },
        { status: 412 }
      );
    }

    // 2. Validate request body
    const bodyJson = await request.json().catch(() => ({}));
    const parsed = RouteMeetingRequestSchema.safeParse(bodyJson);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'VALIDATION_ERROR',
          message: 'Invalid routing request payload',
          details: parsed.error.format(),
        },
        { status: 422 }
      );
    }

    // 3. Verify version match
    if (currentMeeting.version !== expectedVersion) {
      const response = NextResponse.json(
        {
          error: 'PRECONDITION_FAILED',
          message: `Meeting version conflict: current version ${currentMeeting.version}, requested ${expectedVersion}`,
          details: { currentVersion: currentMeeting.version, expectedVersion, meeting: currentMeeting },
        },
        { status: 412 }
      );
      response.headers.set('ETag', formatETag(currentMeeting.version));
      return response;
    }

    // 4. Execute route
    const targetProjectId = (parsed.data.nodeId || parsed.data.targetProjectId)!;
    const updated = await manuallyRouteMeeting(sql, {
      orgId: tenant.orgId,
      meetingId,
      nodeId: targetProjectId,
      actorId: session.userId,
      role: tenant.role,
      expectedVersion,
    });

    const response = NextResponse.json({ meeting: updated });
    response.headers.set('ETag', formatETag(updated.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status }
      );
    }
    console.error('Error routing meeting in BFF:', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to route meeting' },
      { status: 500 }
    );
  }
}
