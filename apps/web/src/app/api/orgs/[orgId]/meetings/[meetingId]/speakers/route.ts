import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { authorizeMeetingAccess, getMeetingById, getMeetingSpeakers, updateSpeakerMapping } from '@workspace/db';
import { DomainError, UpdateSpeakerMappingSchema } from '@workspace/core';

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

    // Project privacy first: hosting does not bypass a private project (inaccessible -> 404).
    const auth = await authorizeMeetingAccess(sql, {
      orgId: tenant.orgId,
      meetingId,
      userId: session.userId,
      userRole: tenant.role,
      action: 'read',
    });
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.errorCode, message: auth.errorMessage }, { status: auth.httpStatus });
    }
    const currentMeeting = auth.meeting!;

    if (tenant.role === 'viewer') {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Viewers cannot view speaker information' },
        { status: 403 }
      );
    }

    if (tenant.role === 'member') {
      const isHost =
        currentMeeting.hostId === session.userId; // verified binding only; no email fallback
      if (!isHost) {
        return NextResponse.json(
          { error: 'FORBIDDEN', message: 'You can only view speakers for meetings you hosted' },
          { status: 403 }
        );
      }
    }

    const speakers = await getMeetingSpeakers(sql, {
      orgId: tenant.orgId,
      meetingId,
      actorUserId: session.userId,
    });

    return NextResponse.json({
      speakers,
      metadata: currentMeeting.speakerResolutionMetadata || {},
      speakersResolved: currentMeeting.speakersResolved,
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status }
      );
    }
    console.error('Error fetching speakers in BFF:', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to retrieve speakers' },
      { status: 500 }
    );
  }
}

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

    const parsed = UpdateSpeakerMappingSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'VALIDATION_ERROR',
          message: 'Invalid speaker mapping payload',
          details: parsed.error.format(),
        },
        { status: 422 }
      );
    }

    // Project privacy first: hosting does not bypass a private project (inaccessible -> 404).
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

    if (tenant.role === 'viewer') {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Viewers cannot modify speaker mappings' },
        { status: 403 }
      );
    }

    if (tenant.role === 'member') {
      const isHost =
        currentMeeting.hostId === session.userId; // verified binding only; no email fallback
      if (!isHost) {
        return NextResponse.json(
          { error: 'FORBIDDEN', message: 'You can only modify speakers for meetings you hosted' },
          { status: 403 }
        );
      }
    }

    await updateSpeakerMapping(sql, {
      orgId: tenant.orgId,
      meetingId,
      speakerLabel: parsed.data.speakerLabel,
      userId: parsed.data.userId,
      actorId: session.userId,
    });

    const updatedMeeting = await getMeetingById(sql, tenant.orgId, meetingId);
    return NextResponse.json({ meeting: updatedMeeting });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status }
      );
    }
    console.error('Error updating speaker mapping in BFF:', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to update speaker mapping' },
      { status: 500 }
    );
  }
}
