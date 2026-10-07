import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import {
  consumeOAuthState,
  connectZoomIntegration,
} from '@workspace/db';
import {
  ZoomCallbackRequestSchema,
  DomainError,
} from '@workspace/core';

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
    const parsed = ZoomCallbackRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid callback payload', details: parsed.error.format() },
        { status: 422 }
      );
    }

    const stateRow = await consumeOAuthState(sql, {
      state: parsed.data.state,
      orgId: tenant.orgId,
      userId: session.userId,
    });

    const tokens = await ports.zoomClient.exchangeCode({
      code: parsed.data.code,
      redirectUri: stateRow.redirectUri,
      codeVerifier: stateRow.codeVerifier,
    });

    const zoomUser = await ports.zoomClient.getCurrentUser(tokens.access_token);
    const accountName =
      [zoomUser.firstName, zoomUser.lastName].filter(Boolean).join(' ') || zoomUser.email;

    const integration = await connectZoomIntegration(
      sql,
      ports.secretStore,
      ports.zoomClient,
      {
        orgId: tenant.orgId,
        userId: session.userId,
        accountId: zoomUser.accountId,
        accountName,
        accountEmail: zoomUser.email,
        scopes: tokens.scope.split(' '),
        tokens,
      }
    );

    return NextResponse.json({ success: true, integration });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to process Zoom callback' }, { status: 500 });
  }
}
