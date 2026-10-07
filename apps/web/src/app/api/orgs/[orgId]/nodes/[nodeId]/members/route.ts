import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { listNodeMembers, addNodeMember, removeNodeMember } from '@workspace/db';
import { AddNodeMemberSchema, DomainError } from '@workspace/core';

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
    const members = await listNodeMembers(db, {
      orgId: tenant.orgId,
      nodeId,
      actorUserId: session.userId,
      role: tenant.role,
    });

    return NextResponse.json({ members });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error listing node members:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to list members' }, { status: 500 });
  }
}

export async function POST(
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
    const parsed = AddNodeMemberSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid member payload', details: parsed.error.format() },
        { status: 422 }
      );
    }

    await addNodeMember(db, {
      orgId: tenant.orgId,
      nodeId,
      actorUserId: session.userId,
      role: tenant.role,
      targetUserId: parsed.data.userId,
    });

    return NextResponse.json({ success: true, userId: parsed.data.userId }, { status: 201 });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error adding node member:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to add member' }, { status: 500 });
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
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'userId query parameter is required' }, { status: 422 });
    }

    const result = await removeNodeMember(db, {
      orgId: tenant.orgId,
      nodeId,
      actorUserId: session.userId,
      role: tenant.role,
      targetUserId: userId,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Error removing node member:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to remove member' }, { status: 500 });
  }
}
