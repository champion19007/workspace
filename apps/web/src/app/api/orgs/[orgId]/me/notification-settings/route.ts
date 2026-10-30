import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { getEmailPreferences, setEmailPreference } from '@workspace/db';

const ChangeSchema = z.object({ kind: z.enum(['mentions', 'requests', 'digest']), enabled: z.boolean() });

type Params = { params: Promise<{ orgId: string }> };

/** Which emails the signed-in person gets from this organization: `{ mentions, requests, digest }`. */
export async function GET(request: NextRequest, { params }: Params) {
  return handle(request, params, null);
}

/** Turns one kind of email on or off, `{ kind, enabled }`. Anyone can, whatever their access level. */
export async function PUT(request: NextRequest, { params }: Params) {
  const parsed = ChangeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return problemJson(422, 'VALIDATION_ERROR', 'Choose an email and whether to get it.', request.nextUrl.pathname);
  }
  return handle(request, params, parsed.data);
}

async function handle(request: NextRequest, params: Params['params'], change: z.infer<typeof ChangeSchema> | null) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);
  try {
    const { db, sql } = getServerContext();
    const tenant = await resolveTenantForUser(db, (await params).orgId, session.userId);
    if (change) await setEmailPreference(sql, { orgId: tenant.orgId, userId: session.userId, ...change });
    return NextResponse.json(await getEmailPreferences(sql, { orgId: tenant.orgId, userId: session.userId, role: tenant.role }));
  } catch (err) {
    return problemFromError(err, instance);
  }
}
