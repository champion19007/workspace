import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { updateOrganizationMemberRole, removeOrganizationMember } from '@workspace/db';
import { DomainError, NotFoundError, OrgRoleSchema, isValidUuid } from '@workspace/core';

const UpdateRoleSchema = z.object({ role: OrgRoleSchema });

/** Changes a member's role (owners and admins; updateOrganizationMemberRole enforces the role rules). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; userId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, userId } = await params;
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    if (!isValidUuid(userId)) throw new NotFoundError('Target user is not a member of this organization');

    const body = await request.json().catch(() => ({}));
    const parsed = UpdateRoleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Choose a valid role.', details: parsed.error.format() },
        { status: 422 }
      );
    }

    const membership = await updateOrganizationMemberRole(db, {
      orgId: tenant.orgId,
      actorUserId: session.userId,
      targetUserId: userId,
      newRole: parsed.data.role,
    });

    return NextResponse.json({ membership });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error updating member role:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to update member role' }, { status: 500 });
  }
}

/** Removes a member (owners and admins, or anyone leaving; removeOrganizationMember enforces the rules). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; userId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, userId } = await params;
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    if (!isValidUuid(userId)) throw new NotFoundError('Target user is not a member of this organization');

    await removeOrganizationMember(db, {
      orgId: tenant.orgId,
      actorUserId: session.userId,
      targetUserId: userId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error removing member:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to remove member' }, { status: 500 });
  }
}
