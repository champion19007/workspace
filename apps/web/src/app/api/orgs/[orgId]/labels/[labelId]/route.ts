import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { deleteLabel } from '@workspace/db';
import { DomainError } from '@workspace/core';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; labelId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, labelId } = await params;
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    await deleteLabel(db, {
      orgId: tenant.orgId,
      role: tenant.role,
      labelId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error deleting label:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to delete label' }, { status: 500 });
  }
}
