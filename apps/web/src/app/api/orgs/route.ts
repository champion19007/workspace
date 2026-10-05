import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerContext } from '@/lib/server-context';
import {
  SESSION_COOKIE_NAME,
  getCookieOptions,
  verifyAndRefreshSession,
  serializeSession,
} from '@/lib/session';
import { createOrganizationWithOwner, getUserOrganizations } from '@workspace/db';
import { rotateSession, DomainError } from '@workspace/core';

const CreateOrgSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(255),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/, 'Slug must be alphanumeric lowercase with hyphens'),
  plan: z.string().optional(),
  retentionDays: z.number().int().min(30).max(365).optional(),
});

export async function POST(request: NextRequest) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = CreateOrgSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.format() },
      { status: 422 }
    );
  }

  try {
    const { db } = getServerContext();
    const result = await createOrganizationWithOwner(db, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      userId: session.userId,
      plan: parsed.data.plan,
      retentionDays: parsed.data.retentionDays,
    });

    // Rotate session to activate new organization
    const rotated = rotateSession(session, {
      activeOrgId: result.org.id,
      role: 'owner',
      sessionEpoch: result.membership.sessionEpoch,
    });

    const response = NextResponse.json(result, { status: 201 });
    response.cookies.set(SESSION_COOKIE_NAME, serializeSession(rotated), getCookieOptions());
    return response;
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('Org creation error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to create organization' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { session } = verifyAndRefreshSession(rawCookie);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { db } = getServerContext();
  const orgs = await getUserOrganizations(db, session.userId);
  return NextResponse.json({ organizations: orgs });
}
