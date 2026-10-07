import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { getDocById, updateDoc, archiveDoc } from '@workspace/db';
import {
  UpdateDocSchema,
  DomainError,
  PreconditionRequiredError,
  PreconditionFailedError,
  formatETag,
  parseStrongETag,
  isWeakETag,
} from '@workspace/core';

export async function GET(
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
    const doc = await getDocById(db, {
      orgId: tenant.orgId,
      docId,
      userId: session.userId,
      role: tenant.role,
    });

    const response = NextResponse.json(doc);
    response.headers.set('ETag', formatETag(doc.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error fetching doc:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch document' }, { status: 500 });
  }
}

export async function PATCH(
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
    const parsed = UpdateDocSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid document update input', details: parsed.error.format() },
        { status: 422 }
      );
    }

    // Step 1: Read current doc to verify read permission (zero leakage -> 404)
    const currentDoc = await getDocById(db, {
      orgId: tenant.orgId,
      docId,
      userId: session.userId,
      role: tenant.role,
    });

    // Step 2: Strict strong If-Match validation (RFC 9110)
    const ifMatchHeader = request.headers.get('if-match');
    if (!ifMatchHeader) {
      const err = new PreconditionRequiredError('If-Match header is required for document mutations');
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }

    if (isWeakETag(ifMatchHeader)) {
      const err = new PreconditionFailedError(
        'Weak entity tags (W/...) are not permitted for state-modifying requests under RFC 9110',
        currentDoc
      );
      const res = NextResponse.json(
        { error: err.code, message: err.message, details: { currentEntity: currentDoc } },
        { status: err.status }
      );
      res.headers.set('ETag', formatETag(currentDoc.version));
      return res;
    }

    const ifMatchVersion = parseStrongETag(ifMatchHeader);
    if (ifMatchVersion === null || ifMatchVersion !== currentDoc.version) {
      const err = new PreconditionFailedError(
        `Precondition failed: target document is at version ${currentDoc.version}, requested version ${ifMatchVersion}`,
        currentDoc
      );
      const res = NextResponse.json(
        { error: err.code, message: err.message, details: { currentEntity: currentDoc } },
        { status: err.status }
      );
      res.headers.set('ETag', formatETag(currentDoc.version));
      return res;
    }

    // Step 3: Atomic database update with 30-version retention
    const updated = await updateDoc(db, {
      orgId: tenant.orgId,
      docId,
      actorUserId: session.userId,
      role: tenant.role,
      ifMatchVersion,
      input: parsed.data,
    });

    const response = NextResponse.json(updated);
    response.headers.set('ETag', formatETag(updated.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error updating doc:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to update document' }, { status: 500 });
  }
}

export async function DELETE(
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

    const currentDoc = await getDocById(db, {
      orgId: tenant.orgId,
      docId,
      userId: session.userId,
      role: tenant.role,
    });

    const ifMatchHeader = request.headers.get('if-match');
    if (!ifMatchHeader) {
      const err = new PreconditionRequiredError('If-Match header is required to archive a document');
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }

    if (isWeakETag(ifMatchHeader)) {
      const err = new PreconditionFailedError(
        'Weak entity tags are not permitted for state-modifying requests under RFC 9110',
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
        `Precondition failed: target document is at version ${currentDoc.version}`,
        currentDoc
      );
      return NextResponse.json(
        { error: err.code, message: err.message, details: { currentEntity: currentDoc } },
        { status: err.status }
      );
    }

    const archived = await archiveDoc(db, {
      orgId: tenant.orgId,
      docId,
      actorUserId: session.userId,
      role: tenant.role,
      ifMatchVersion,
    });

    const response = NextResponse.json(archived);
    response.headers.set('ETag', formatETag(archived.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error archiving doc:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to archive document' }, { status: 500 });
  }
}
