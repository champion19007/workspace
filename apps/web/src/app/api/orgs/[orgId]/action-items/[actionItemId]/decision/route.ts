import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import {
  checkOrCreateIdempotencyKey,
  completeIdempotencyKey,
  decideActionItem,
  failIdempotencyKey,
  getActionItemForUser,
} from '@workspace/db';
import {
  ActionItemDecisionSchema,
  PreconditionFailedError,
  PreconditionRequiredError,
  formatETag,
  parseStrongETag,
} from '@workspace/core';

const OPERATION = 'POST /api/orgs/:orgId/action-items/:actionItemId/decision';

/**
 * Stage 17 human decision (approve | edit | reject) on an AI suggestion.
 * Same contract as POST /api/v1/orgs/:orgSlug/action-items/:id/decision: strong If-Match "v{version}"
 * (428 missing, 412 stale with currentEntity) and Idempotency-Key replay (x-idempotent-replayed: true).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; actionItemId: string }> }
) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier, actionItemId } = await params;
  const { db, sql } = getServerContext();

  let tenant;
  try {
    tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
  } catch (err) {
    return problemFromError(err, instance);
  }
  const body: unknown = await request.json().catch(() => undefined);

  // Idempotency (same storage and semantics as the Fastify idempotency plugin): replay before any other check.
  const rawKey = request.headers.get('idempotency-key');
  const key = rawKey?.trim() ?? null;
  const keyScope = { orgId: tenant.orgId, actorId: session.userId };
  if (rawKey !== null) {
    if (!key || key.length > 128) {
      return problemJson(422, 'VALIDATION_ERROR', 'Idempotency-Key header must be between 1 and 128 characters', instance);
    }
    const fingerprint = crypto
      .createHash('sha256')
      .update(`POST:${instance}:${JSON.stringify(body ?? {})}`)
      .digest('hex');
    const check = await checkOrCreateIdempotencyKey(db, { ...keyScope, key, operation: OPERATION, fingerprint });
    if (check.state === 'in_flight') {
      return problemJson(409, 'IDEMPOTENCY_CONFLICT', 'An identical request is still being processed with this Idempotency-Key', instance);
    }
    if (check.state === 'fingerprint_mismatch') {
      return problemJson(422, 'VALIDATION_ERROR', 'This Idempotency-Key was already used with a different request', instance);
    }
    if (check.state === 'replay') {
      return NextResponse.json(check.responseBody, {
        status: check.statusCode,
        headers: { ...check.headers, 'x-idempotent-replayed': 'true' },
      });
    }
  }

  let response: NextResponse;
  try {
    const parsed = ActionItemDecisionSchema.safeParse(body);
    if (!parsed.success) {
      response = problemJson(422, 'VALIDATION_ERROR', 'Invalid decision payload', instance, {
        details: parsed.error.format(),
      });
    } else {
      const base = { orgId: tenant.orgId, actionItemId, userId: session.userId, role: tenant.role };
      // 404/403 before preconditions so an unreadable item never leaks through 428/412.
      const current = await getActionItemForUser(sql, { ...base, action: 'decide' });
      const ifMatch = request.headers.get('if-match');
      if (!ifMatch) throw new PreconditionRequiredError('If-Match header is required to decide a suggestion');
      const expectedVersion = parseStrongETag(ifMatch); // weak validators parse to null
      if (expectedVersion === null || expectedVersion !== current.version) {
        throw new PreconditionFailedError(
          `Version conflict: suggestion is at version ${current.version} (requested ${ifMatch})`,
          current
        );
      }
      const result = await decideActionItem(sql, { ...base, expectedVersion, input: parsed.data });
      response = NextResponse.json(result);
      response.headers.set('ETag', formatETag(result.actionItem.version!));
    }
  } catch (err) {
    response = problemFromError(err, instance);
  }

  if (key) {
    const payload = await response.clone().json();
    if (response.status < 400) {
      await completeIdempotencyKey(db, {
        ...keyScope,
        key,
        statusCode: response.status,
        headers: { 'content-type': 'application/json', etag: response.headers.get('etag') ?? '' },
        responseBody: payload,
      });
    } else {
      await failIdempotencyKey(db, { ...keyScope, key, statusCode: response.status, errorPayload: payload });
    }
  }
  return response;
}
