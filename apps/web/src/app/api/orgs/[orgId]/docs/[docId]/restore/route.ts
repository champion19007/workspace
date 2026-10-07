import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { getDocById, restoreDocVersion } from '@workspace/db';
import {
  RestoreDocSchema,
  DomainError,
  PreconditionRequiredError,
  PreconditionFailedError,
  formatETag,
  parseStrongETag,
  isWeakETag,
} from '@workspace/core';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; docId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, docId } = await params;
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const body = await request.json().catch(() => ({}));
    const parsed = RestoreDocSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid restore payload', details: parsed.error.format() },
        { status: 422 }
      );
    }

    // Read current doc to verify access
    const currentDoc = await getDocById(db, {
      orgId: tenant.orgId,
      docId,
      userId: session.userId,
      role: tenant.role,
    });

    const ifMatchHeader = request.headers.get('if-match');
    if (!ifMatchHeader) {
      const err = new PreconditionRequiredError('If-Match header is required to restore a document');
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }

    if (isWeakETag(ifMatchHeader)) {
      const err = new PreconditionFailedError(
        'Weak entity tags are not permitted for restore operations under RFC 9110',
        currentDoc
      );
      return NextResponse.json(
        { error: err.code, message: err.message, details: { currentEntity: currentDoc } },
        { status: err.status }
      );
    }

    const ifMatchVersion = parseStrongETag(ifMatchHeader);
    if (ifMatchVersion === null || ifMatchVersion !== currentDoc.version) {
      const err = new PreconditionFailedError(
        `Precondition failed: target document is at version ${currentDoc.version}, requested ${ifMatchVersion}`,
        currentDoc
      );
      return NextResponse.json(
        { error: err.code, message: err.message, details: { currentEntity: currentDoc } },
        { status: err.status }
      );
    }

    const restored = await restoreDocVersion(db, {
      orgId: tenant.orgId,
      docId,
      targetVersion: parsed.data.version,
      actorUserId: session.userId,
      role: tenant.role,
      ifMatchVersion,
    });

    const response = NextResponse.json(restored);
    response.headers.set('ETag', formatETag(restored.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error restoring doc version:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to restore document version' }, { status: 500 });
  }
}
