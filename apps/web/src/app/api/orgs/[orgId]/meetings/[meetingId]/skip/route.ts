import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { getMeetingById, skipMeetingAndCleanup } from '@workspace/db';
import {
  DomainError,
  SkipMeetingRequestSchema,
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
  const { db, sql, ports } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);

    // 1. Enforce strong If-Match header (RFC 9110)
    const ifMatchHeader = request.headers.get('if-match');
    if (!ifMatchHeader) {
      return NextResponse.json(
        {
          error: 'PRECONDITION_REQUIRED',
          message: 'If-Match header is required for skip operations (expected "v<version>")',
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
    let bodyJson = {};
    try {
      bodyJson = await request.json();
    } catch {
      // Empty body allowed
    }

    const parsed = SkipMeetingRequestSchema.safeParse(bodyJson);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'VALIDATION_ERROR',
          message: 'Invalid skip request payload',
          details: parsed.error.format(),
        },
        { status: 422 }
      );
    }

    // 3. Check meeting existence and RBAC
    const currentMeeting = await getMeetingById(sql, tenant.orgId, meetingId);
    if (!currentMeeting) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Meeting not found' },
        { status: 404 }
      );
    }

    if (tenant.role === 'viewer') {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Viewers cannot skip meetings' },
        { status: 403 }
      );
    }

    if (tenant.role === 'member') {
      const isHost =
        currentMeeting.hostId === session.userId ||
        currentMeeting.zoomHostEmail?.toLowerCase() === session.email.toLowerCase();
      if (!isHost) {
        return NextResponse.json(
          { error: 'FORBIDDEN', message: 'You can only skip meetings you hosted' },
          { status: 403 }
        );
      }
    }

    // 4. Verify version match
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

    // 5. Execute skip and cleanup
    const updated = await skipMeetingAndCleanup(sql, {
      orgId: tenant.orgId,
      meetingId,
      ifMatchVersion: expectedVersion,
      reason: parsed.data.reason,
      blobStore: ports.blobStore,
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
    console.error('Error skipping meeting in BFF:', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to skip meeting and purge artifacts' },
      { status: 500 }
    );
  }
}
