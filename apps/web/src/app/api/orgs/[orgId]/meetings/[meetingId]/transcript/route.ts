import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { getMeetingById, getMeetingTranscript } from '@workspace/db';
import {
  DomainError,
  GetTranscriptQuerySchema,
  formatETag,
} from '@workspace/core';

export async function GET(
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

    const searchParams = request.nextUrl.searchParams;
    const parsed = GetTranscriptQuerySchema.safeParse({
      search: searchParams.get('search') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : 0,
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'VALIDATION_ERROR',
          message: 'Invalid transcript query parameters',
          details: parsed.error.format(),
        },
        { status: 422 }
      );
    }

    const meeting = await getMeetingById(sql, tenant.orgId, meetingId);
    if (!meeting) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Meeting not found' },
        { status: 404 }
      );
    }

    if (tenant.role === 'viewer') {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Viewers cannot access meeting transcripts' },
        { status: 403 }
      );
    }

    if (tenant.role === 'member') {
      const isHost =
        meeting.hostId === session.userId ||
        meeting.zoomHostEmail?.toLowerCase() === session.email.toLowerCase();
      if (!isHost) {
        return NextResponse.json(
          { error: 'FORBIDDEN', message: 'You can only view transcripts for meetings you hosted' },
          { status: 403 }
        );
      }
    }

    const result = await getMeetingTranscript(sql, {
      orgId: tenant.orgId,
      meetingId,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      search: parsed.data.search,
    });

    const response = NextResponse.json(result);
    response.headers.set('ETag', formatETag(meeting.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status }
      );
    }
    console.error('Error fetching meeting transcript in BFF:', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to retrieve meeting transcript' },
      { status: 500 }
    );
  }
}
