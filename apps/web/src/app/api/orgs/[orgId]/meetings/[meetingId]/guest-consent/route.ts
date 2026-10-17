import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { authorizeMeetingAccess, resolveGuestConsent } from '@workspace/db';
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

    // Stricter rule for this route: Members may only resolve guest consent for meetings they hosted (verified binding only)
    if (tenant.role === 'member' && currentMeeting.hostId !== session.userId) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'You can only resolve guest consent for meetings you hosted' },
        { status: 403 }
      );
    }

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
