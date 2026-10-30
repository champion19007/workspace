import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { appUrl, invitationEmail } from '@/lib/email';
import { rateLimited } from '@/lib/rate-limit';
import { createMemberInvitation } from '@workspace/db';
import { CreateInvitationInputSchema, DomainError, generateInvitationToken } from '@workspace/core';

/**
 * Creates an invitation (owners and admins; createMemberInvitation enforces who may invite which role) and emails
 * the accept link. Only the token's hash is stored, so the email goes out now or never; the token also goes back
 * to the inviter, who can share the link themselves if the email doesn't arrive.
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
  const { db, ports } = getServerContext();

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

    const limited = await rateLimited(
      [{ key: `invitations:${tenant.orgId}`, limit: 100, windowSeconds: 86_400 }],
      request.nextUrl.pathname,
      "You've sent a lot of invitations today. Try again tomorrow."
    );
    if (limited) return limited;

    const token = generateInvitationToken();
    const invite = await createMemberInvitation(db, {
      orgId: tenant.orgId,
      actorUserId: session.userId,
      email: parsed.data.email,
      role: parsed.data.role,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
    });

    let emailSent = false;
    try {
      await ports.email.send(
        invitationEmail({
          id: invite.id,
          to: invite.email,
          orgName: tenant.orgName,
          invitedBy: session.email,
          role: invite.role,
          link: `${appUrl(request)}/invitations/accept?token=${encodeURIComponent(token.rawToken)}`,
        })
      );
      // The development stand-in only logs, so the inviter is still asked to share the link.
      emailSent = ports.email.provider !== 'console';
    } catch (err) {
      console.error('Invitation email failed', { message: (err as Error).message });
    }

    return NextResponse.json(
      {
        invitation: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expiresAt,
          rawToken: token.rawToken,
          emailSent,
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
