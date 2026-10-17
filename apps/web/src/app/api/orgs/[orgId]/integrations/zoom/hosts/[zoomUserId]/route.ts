import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { updateZoomHostConsent } from '@workspace/db';
import {
  UpdateZoomHostConsentSchema,
  DomainError,
} from '@workspace/core';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; zoomUserId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, zoomUserId } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const body = await request.json().catch(() => ({}));
    const parsed = UpdateZoomHostConsentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid host consent update data', details: parsed.error.format() },
        { status: 422 }
      );
    }

    const host = await updateZoomHostConsent(sql, {
      orgId: tenant.orgId,
      zoomUserId,
      consentStatus: parsed.data.consentStatus,
      adminDisabled: parsed.data.adminDisabled,
      role: tenant.role,
      userId: session.userId,
    });

    return NextResponse.json({ host });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to update host consent' }, { status: 500 });
  }
}
