import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { getNodeById, updateNode, moveSubtree, deleteOrArchiveNode } from '@workspace/db';
import {
  UpdateNodeSchema,
  DomainError,
  PreconditionFailedError,
  formatETag,
  parseETag,
  parseStrongETag,
  isWeakETag,
} from '@workspace/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; nodeId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, nodeId } = await params;
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const node = await getNodeById(db, {
      orgId: tenant.orgId,
      nodeId,
      userId: session.userId,
      role: tenant.role,
      includeArchived: true,
    });

    const response = NextResponse.json(node);
    response.headers.set('ETag', formatETag(node.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error fetching node:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch node' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; nodeId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, nodeId } = await params;
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const body = await request.json().catch(() => ({}));
    const parsed = UpdateNodeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid node update input', details: parsed.error.format() },
        { status: 422 }
      );
    }

    let currentNode = await getNodeById(db, {
      orgId: tenant.orgId,
      nodeId,
      userId: session.userId,
      role: tenant.role,
    });

    const ifMatchHeader = request.headers.get('if-match');
    if (ifMatchHeader) {
      if (isWeakETag(ifMatchHeader)) {
        throw new PreconditionFailedError(
          `Weak entity tags (${ifMatchHeader}) do not satisfy strong comparison for If-Match. Strong ETag required (e.g. "v${currentNode.version}").`,
          currentNode
        );
      }
      const expectedVersion = parseStrongETag(ifMatchHeader);
      if (expectedVersion === null || expectedVersion !== currentNode.version) {
        throw new PreconditionFailedError(
          `Version conflict: node has been updated to version ${currentNode.version} (requested ${ifMatchHeader})`,
          currentNode
        );
      }
    }

    // Subtree move
    if (parsed.data.parentId !== undefined && parsed.data.parentId !== currentNode.parentId) {
      const moveResult = await moveSubtree(db, {
        orgId: tenant.orgId,
        nodeId,
        newParentId: parsed.data.parentId,
        actorUserId: session.userId,
        role: tenant.role,
        ifMatchVersion: currentNode.version,
      });
      currentNode = moveResult.movedRoot;
    }

    // Attribute updates
    if (
      parsed.data.name !== undefined ||
      parsed.data.description !== undefined ||
      parsed.data.visibility !== undefined
    ) {
      currentNode = await updateNode(db, {
        orgId: tenant.orgId,
        nodeId,
        actorUserId: session.userId,
        role: tenant.role,
        ifMatchVersion: currentNode.version,
        name: parsed.data.name,
        description: parsed.data.description,
        visibility: parsed.data.visibility,
      });
    }

    const response = NextResponse.json(currentNode);
    response.headers.set('ETag', formatETag(currentNode.version));
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error updating node:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to update node' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; nodeId: string }> }
) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  const { orgId: orgIdentifier, nodeId } = await params;
  const { db } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const archiveParam = request.nextUrl.searchParams.get('archive');
    const archive = archiveParam === 'true';

    const ifMatchHeader = request.headers.get('if-match');
    const ifMatchVersion = typeof ifMatchHeader === 'string' ? parseETag(ifMatchHeader) ?? undefined : undefined;

    const result = await deleteOrArchiveNode(db, {
      orgId: tenant.orgId,
      nodeId,
      actorUserId: session.userId,
      role: tenant.role,
      archive,
      ifMatchVersion,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error deleting node:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to delete node' }, { status: 500 });
  }
}
