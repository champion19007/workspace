import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { getMeetingById, getMeetingNotesAndSuggestions } from '@workspace/db';
import { DomainError, formatETag } from '@workspace/core';

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

    const meeting = await getMeetingById(sql, tenant.orgId, meetingId);
    if (!meeting) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Meeting not found' },
        { status: 404 }
      );
    }

    if (tenant.role === 'viewer') {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Viewers are not permitted to inspect meeting notes' },
        { status: 403 }
      );
    }

    if (tenant.role === 'member') {
      const isHost =
        meeting.hostId === session.userId ||
        meeting.zoomHostEmail?.toLowerCase() === session.email.toLowerCase();

      let hasProjectAccess = false;
      if (meeting.nodeId) {
        const [membership] = await sql`
          SELECT 1 FROM node_members
          WHERE org_id = ${tenant.orgId}
            AND node_id = ${meeting.nodeId}
            AND user_id = ${session.userId}
        `;
        const [node] = await sql`
          SELECT visibility FROM nodes
          WHERE org_id = ${tenant.orgId} AND id = ${meeting.nodeId} AND archived_at IS NULL
        `;
        if (node && (node.visibility === 'public' || membership)) {
          hasProjectAccess = true;
        }
      }

      if (!isHost && !hasProjectAccess) {
        return NextResponse.json(
          { error: 'FORBIDDEN', message: 'You do not have permission to view notes for this meeting' },
          { status: 403 }
        );
      }
    }

    const result = await getMeetingNotesAndSuggestions(sql, tenant.orgId, meetingId);

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
    console.error('Error fetching meeting notes in BFF:', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to retrieve meeting notes' },
      { status: 500 }
    );
  }
}
