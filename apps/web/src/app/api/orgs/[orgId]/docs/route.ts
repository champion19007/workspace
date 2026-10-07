import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { listDocs, createDoc } from '@workspace/db';
import {
  ListDocsQuerySchema,
  CreateDocSchema,
  DomainError,
  formatETag,
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
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = ListDocsQuerySchema.safeParse(searchParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid documents query parameters', details: parsed.error.format() },
        { status: 422 }
      );
    }

    const result = await listDocs(db, {
      orgId: tenant.orgId,
      userId: session.userId,
      role: tenant.role,
      query: parsed.data,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error listing org docs:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to list documents' }, { status: 500 });
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
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const body = await request.json().catch(() => ({}));
    const parsed = CreateDocSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid document input', details: parsed.error.format() },
        { status: 422 }
      );
    }

    const doc = await createDoc(db, {
      orgId: tenant.orgId,
      actorUserId: session.userId,
      role: tenant.role,
      input: parsed.data,
    });

    const response = NextResponse.json(doc, { status: 201 });
    response.headers.set('ETag', formatETag(doc.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error creating doc:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to create document' }, { status: 500 });
  }
}
