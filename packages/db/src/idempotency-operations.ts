import { eq, and } from 'drizzle-orm';
import { loginSql, withTenantContext, type DatabaseInstance, type TenantTransaction } from './client.js';
import { idempotencyKeys } from './schema/index.js';

export interface IdempotencyCheckResultNew {
  state: 'new';
  recordId: string;
}

export interface IdempotencyCheckResultInFlight {
  state: 'in_flight';
}

export interface IdempotencyCheckResultMismatch {
  state: 'fingerprint_mismatch';
}

export interface IdempotencyCheckResultReplay {
  state: 'replay';
  statusCode: number;
  headers: Record<string, string>;
  responseBody: unknown;
}

export type IdempotencyCheckResult =
  | IdempotencyCheckResultNew
  | IdempotencyCheckResultInFlight
  | IdempotencyCheckResultMismatch
  | IdempotencyCheckResultReplay;

export interface IdempotencyKeyParams {
  orgId: string;
  actorId: string;
  key: string;
  operation: string;
  fingerprint: string;
  retentionHours?: number;
}

type Db = DatabaseInstance | TenantTransaction;

/** Each statement in its own tenant transaction, so a failed insert (23505) can be followed by a re-read. */
function scoped(db: Db, orgId: string, actorId: string) {
  return <T>(fn: (tx: TenantTransaction) => Promise<T>) => withTenantContext(db, { orgId, userId: actorId }, fn);
}

export async function checkOrCreateIdempotencyKey(
  db: Db,
  params: IdempotencyKeyParams
): Promise<IdempotencyCheckResult> {
  const { orgId, actorId, key, operation, fingerprint, retentionHours = 24 } = params;
  const run = scoped(db, orgId, actorId);
  const now = new Date();

  // 1. Check existing record
  const [existing] = await run((tx) => tx
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.orgId, orgId),
        eq(idempotencyKeys.actorId, actorId),
        eq(idempotencyKeys.key, key)
      )
    )
    .limit(1));

  if (existing) {
    // If expired, remove and allow fresh execution
    if (existing.expiresAt < now) {
      await run((tx) => tx
        .delete(idempotencyKeys)
        .where(eq(idempotencyKeys.id, existing.id)));
    } else {
      if (existing.status === 'pending') {
        return { state: 'in_flight' };
      }

      if (existing.fingerprint !== fingerprint) {
        return { state: 'fingerprint_mismatch' };
      }

      return {
        state: 'replay',
        statusCode: existing.statusCode ?? 200,
        headers: (existing.headers as Record<string, string>) ?? {},
        responseBody: existing.responseBody,
      };
    }
  }

  // 2. Insert new pending record
  const expiresAt = new Date(now.getTime() + retentionHours * 3600 * 1000);

  try {
    const [inserted] = await run((tx) => tx
      .insert(idempotencyKeys)
      .values({
        orgId,
        actorId,
        key,
        operation,
        fingerprint,
        status: 'pending',
        expiresAt,
      })
      .returning({ id: idempotencyKeys.id }));

    if (!inserted) {
      throw new Error('Failed to insert idempotency key');
    }

    return {
      state: 'new',
      recordId: inserted.id,
    };
  } catch (err: unknown) {
    // Handle concurrent insertion race condition (PostgreSQL unique constraint 23505)
    const pgError = err as { code?: string };
    if (pgError.code === '23505') {
      const [racing] = await run((tx) => tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.orgId, orgId),
            eq(idempotencyKeys.actorId, actorId),
            eq(idempotencyKeys.key, key)
          )
        )
        .limit(1));

      if (racing && racing.status === 'completed') {
        if (racing.fingerprint !== fingerprint) {
          return { state: 'fingerprint_mismatch' };
        }
        return {
          state: 'replay',
          statusCode: racing.statusCode ?? 200,
          headers: (racing.headers as Record<string, string>) ?? {},
          responseBody: racing.responseBody,
        };
      }
      return { state: 'in_flight' };
    }
    throw err;
  }
}

export async function completeIdempotencyKey(
  db: Db,
  params: {
    orgId: string;
    actorId: string;
    key: string;
    statusCode: number;
    headers?: Record<string, string>;
    responseBody?: unknown;
  }
): Promise<void> {
  await scoped(db, params.orgId, params.actorId)((tx) => tx
    .update(idempotencyKeys)
    .set({
      status: 'completed',
      statusCode: params.statusCode,
      headers: params.headers ?? {},
      responseBody: params.responseBody ?? null,
    })
    .where(
      and(
        eq(idempotencyKeys.orgId, params.orgId),
        eq(idempotencyKeys.actorId, params.actorId),
        eq(idempotencyKeys.key, params.key)
      )
    ));
}

export async function failIdempotencyKey(
  db: Db,
  params: {
    orgId: string;
    actorId: string;
    key: string;
    statusCode?: number;
    errorPayload?: unknown;
  }
): Promise<void> {
  await scoped(db, params.orgId, params.actorId)((tx) => tx
    .update(idempotencyKeys)
    .set({
      status: 'failed',
      statusCode: params.statusCode ?? 500,
      responseBody: params.errorPayload ?? null,
    })
    .where(
      and(
        eq(idempotencyKeys.orgId, params.orgId),
        eq(idempotencyKeys.actorId, params.actorId),
        eq(idempotencyKeys.key, params.key)
      )
    ));
}

/** Expired keys of every organization (narrowly privileged entry point of migration 0015; worker only). */
export async function purgeExpiredIdempotencyKeys(
  db: DatabaseInstance
): Promise<number> {
  const [row] = await loginSql(db)<Array<{ purged: number }>>`SELECT sys_idempotency_purge() AS purged`;
  return row!.purged;
}
