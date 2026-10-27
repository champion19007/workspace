import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { createMemberInvitation } from '@workspace/db';
import { CreateInvitationInputSchema, DomainError, generateInvitationToken } from '@workspace/core';

/**
 * Creates an invitation (owners and admins; createMemberInvitation enforces who may invite which role).
 * There is no email sender on a web-only deployment, so the one-time token goes back to the inviter,
 * who shares the accept link themselves. Only its hash is stored.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier } = await params;
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const body = await request.json().catch(() => ({}));
    const parsed = CreateInvitationInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Enter a valid email address and role.', details: parsed.error.format() },
        { status: 422 }
      );
    }

    const token = generateInvitationToken();
    const invite = await createMemberInvitation(db, {
      orgId: tenant.orgId,
      actorUserId: session.userId,
      email: parsed.data.email,
      role: parsed.data.role,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
    });

    return NextResponse.json(
      {
        invitation: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expiresAt,
          rawToken: token.rawToken,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error creating invitation:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to create invitation' }, { status: 500 });
  }
}
