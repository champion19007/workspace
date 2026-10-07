import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { getMeetingById, resolveGuestConsent } from '@workspace/db';
import { DomainError, ResolveGuestConsentSchema, formatETag } from '@workspace/core';

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

    const parsed = ResolveGuestConsentSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'VALIDATION_ERROR',
          message: 'Invalid guest consent payload',
          details: parsed.error.format(),
        },
        { status: 422 }
      );
    }

    const currentMeeting = await getMeetingById(sql, tenant.orgId, meetingId);
    if (!currentMeeting) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Meeting not found' },
        { status: 404 }
      );
    }

    if (tenant.role === 'viewer') {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Viewers cannot resolve guest consent' },
        { status: 403 }
      );
    }

    if (tenant.role === 'member') {
      const isHost =
        currentMeeting.hostId === session.userId ||
        currentMeeting.zoomHostEmail?.toLowerCase() === session.email.toLowerCase();
      if (!isHost) {
        return NextResponse.json(
          { error: 'FORBIDDEN', message: 'You can only resolve guest consent for meetings you hosted' },
          { status: 403 }
        );
      }
    }

    const updated = await resolveGuestConsent(sql, {
      orgId: tenant.orgId,
      meetingId,
      actorId: session.userId,
      guestConsentStatus: parsed.data.guestConsentStatus,
      attestationNotes: parsed.data.attestationNotes,
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
    console.error('Error resolving guest consent in BFF:', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to resolve guest consent' },
      { status: 500 }
    );
  }
}
