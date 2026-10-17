import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import {
  getZoomIntegration,
  createOAuthState,
  disconnectZoomIntegration,
} from '@workspace/db';
import {
  AuthorizeZoomRequestSchema,
  DomainError,
} from '@workspace/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const integration = await getZoomIntegration(sql, tenant.orgId, session.userId);
    return NextResponse.json({ integration });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch Zoom integration' }, { status: 500 });
  }
}

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
  const { db, sql, ports } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);

    if (tenant.role !== 'owner' && tenant.role !== 'admin') {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Only organization Owners or Admins can connect integrations' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = AuthorizeZoomRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid authorize request body', details: parsed.error.format() },
        { status: 422 }
      );
    }

    const redirectUri =
      parsed.data.redirectUri ||
      `${request.nextUrl.origin}/orgs/${tenant.orgSlug}/settings/integrations/callback`;

    const { state, codeChallenge } = await createOAuthState(sql, {
      orgId: tenant.orgId,
      userId: session.userId,
      sessionId: session.userId,
      redirectUri,
    });

    const authorizationUrl = ports.zoomClient.getAuthorizationUrl({
      state,
      redirectUri,
      codeChallenge,
    });

    return NextResponse.json({
      authorizationUrl,
      state,
      redirectUri,
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to initiate Zoom authorization' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier } = await params;
  const { db, sql, ports } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);

    if (tenant.role !== 'owner' && tenant.role !== 'admin') {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Only organization Owners or Admins can disconnect integrations' },
        { status: 403 }
      );
    }

    const integration = await disconnectZoomIntegration(sql, ports.secretStore, ports.zoomClient, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
    });

    return NextResponse.json({ success: true, integration });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to disconnect Zoom integration' }, { status: 500 });
  }
}
