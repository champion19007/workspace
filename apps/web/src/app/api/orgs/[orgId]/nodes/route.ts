import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { createNode } from '@workspace/db';
import { CreateNodeSchema, DomainError, formatETag } from '@workspace/core';

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
    const parsed = CreateNodeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid node creation input', details: parsed.error.format() },
        { status: 422 }
      );
    }

    const node = await createNode(db, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
      name: parsed.data.name,
      kind: parsed.data.kind,
      parentId: parsed.data.parentId,
      visibility: parsed.data.visibility,
      description: parsed.data.description,
    });

    const response = NextResponse.json(node, { status: 201 });
    response.headers.set('ETag', formatETag(node.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error creating node:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to create node' }, { status: 500 });
  }
}
