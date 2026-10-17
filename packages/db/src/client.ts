import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as dsql } from 'drizzle-orm';
import * as schema from './schema/index.js';

export type { Sql };
export type DatabaseInstance = ReturnType<typeof drizzle<typeof schema>>;
export type TenantTransaction = Parameters<Parameters<DatabaseInstance['transaction']>[0]>[0];
/** What a db operation accepts: the drizzle instance, a pooled client, or a client/transaction bound to a tenant. */
export type DbOrSql = DatabaseInstance | postgres.Sql | postgres.TransactionSql;

export interface DatabasePoolOptions {
  connectionString: string;
  maxConnections?: number;
  idleTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
}

export interface TenantContext {
  orgId: string;
  userId?: string;
  role?: string;
  /**
   * Background processing with no acting user (worker only). Runs as `workspace_system`, which is
   * still confined to `orgId` by the tenant policies but is not subject to the per-user
   * private-project policies. Only the worker login role is a member of `workspace_system`, so an
   * API/BFF connection that asks for it fails closed with "permission denied to set role".
   */
  system?: boolean;
}

export function createApiClient(options: DatabasePoolOptions): {
  sql: postgres.Sql;
  db: DatabaseInstance;
} {
  const sql = postgres(options.connectionString, {
    max: options.maxConnections ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 30,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    prepare: false, // Required for transaction-mode poolers (Supabase pooler / RDS Proxy)
  });

  const db = drizzle(sql, { schema });
  return { sql, db };
}

export function createWorkerClient(options: DatabasePoolOptions): {
  sql: postgres.Sql;
  db: DatabaseInstance;
} {
  const sql = postgres(options.connectionString, {
    max: options.maxConnections ?? 5,
    idle_timeout: options.idleTimeoutSeconds ?? 60,
    connect_timeout: options.connectTimeoutSeconds ?? 15,
    prepare: true, // Direct session connection allows prepared statements and advisory locks
  });

  const db = drizzle(sql, { schema });
  return { sql, db };
}

export async function checkDatabaseHealth(
  sql: postgres.Sql
): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
  const start = performance.now();
  try {
    await sql`SELECT 1 as health_check`;
    const latencyMs = Math.round(performance.now() - start);
    return { healthy: true, latencyMs };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { healthy: false, error };
  }
}

// ---------------------------------------------------------------------------
// Runtime RLS enforcement (Stage 17b, ADR "17b — Runtime RLS enforcement")
//
// The API/BFF and worker log in as `workspace_api` / `workspace_worker`: non-superuser, NOBYPASSRLS
// and NOINHERIT, so they hold no table privileges of their own. Tenant work runs inside transactions
// that first `SET LOCAL ROLE` into an RLS-enforced role and set the app.* GUCs; cross-tenant system
// work goes through the SECURITY DEFINER entry points of migration 0015 via `loginSql`.
// ---------------------------------------------------------------------------

/** RLS-enforced runtime roles assumed by every tenant transaction (see migration 0015). */
export const TENANT_DB_ROLE = 'workspace_app';
export const SYSTEM_DB_ROLE = 'workspace_system';

/** Clients and transactions already bound to a tenant, and the pooled login client behind them. */
const boundContexts = new WeakMap<object, TenantContext>();
const loginClients = new WeakMap<object, postgres.Sql>();

type Settings = [role: string, orgId: string, userId: string, userRole: string];

function tenantSettings(context: TenantContext): Settings {
  if (!context.orgId || typeof context.orgId !== 'string') {
    throw new Error('TenantContext error: orgId is required and must be a valid string');
  }
  return context.system
    ? [SYSTEM_DB_ROLE, context.orgId, '', 'system']
    : [TENANT_DB_ROLE, context.orgId, context.userId ?? '', context.role ?? ''];
}

function assertSameTenant(bound: TenantContext, requested: TenantContext): void {
  if (bound.orgId !== requested.orgId) {
    throw new Error(`Tenant scope mismatch: bound to org ${bound.orgId}, operation asked for org ${requested.orgId}`);
  }
  // A user-bound scope is never widened to another user's visibility (a system scope serves any caller).
  if (!bound.system && requested.userId && requested.userId !== bound.userId) {
    throw new Error('Tenant scope mismatch: operation asked for a different acting user than its caller bound');
  }
}

async function applyContext(txn: postgres.TransactionSql, [role, orgId, userId, userRole]: Settings) {
  await txn`SELECT set_config('role', ${role}, true), set_config('app.org_id', ${orgId}, true), set_config('app.user_id', ${userId}, true), set_config('app.user_role', ${userRole}, true)`;
}

function beginTenant<T>(
  raw: postgres.Sql,
  context: TenantContext,
  callback: (txn: postgres.TransactionSql) => T | Promise<T>,
  options = ''
): Promise<T> {
  const settings = tenantSettings(context);
  return raw.begin(options, async (txn) => {
    await applyContext(txn, settings);
    boundContexts.set(txn, context);
    loginClients.set(txn, raw);
    return callback(txn);
  }) as Promise<T>;
}

/**
 * Runs a callback inside ONE transaction-scoped, RLS-enforced tenant context.
 *
 * The first statement switches to the restricted runtime role (`workspace_app`, or `workspace_system`
 * for `system: true`) and sets app.org_id / app.user_id / app.user_role with set_config(..., true).
 * Everything is transaction-local, so it resets at COMMIT/ROLLBACK and never leaks to the next
 * borrower of a pooled connection (safe behind Supabase's transaction pooler and RDS Proxy).
 * Missing context makes RLS policies fail closed.
 *
 * A target that is already bound (a tenant transaction or a `tenantSql` client) keeps its binding:
 * nested operations inherit their caller's context instead of re-entering a new one.
 */
export function withTenantContext<T>(
  target: DatabaseInstance | TenantTransaction,
  context: TenantContext,
  callback: (tx: TenantTransaction) => Promise<T>
): Promise<T>;
export function withTenantContext<T>(
  target: postgres.Sql | postgres.TransactionSql,
  context: TenantContext,
  callback: (txn: postgres.TransactionSql) => Promise<T>
): Promise<T>;
export async function withTenantContext<T>(
  target: DatabaseInstance | TenantTransaction | postgres.Sql | postgres.TransactionSql,
  context: TenantContext,
  callback: ((tx: TenantTransaction) => Promise<T>) | ((txn: postgres.TransactionSql) => Promise<T>)
): Promise<T> {
  const run = callback as (t: unknown) => Promise<T>;
  const bound = boundContexts.get(target);
  if (bound) {
    assertSameTenant(bound, context);
    // A bound client opens one transaction under its own binding; a bound transaction is reused.
    const client = target as postgres.Sql;
    return typeof client.begin === 'function' ? (client.begin(run) as Promise<T>) : run(target);
  }

  if ('transaction' in target && typeof target.transaction === 'function') {
    const [role, orgId, userId, userRole] = tenantSettings(context);
    return (target as DatabaseInstance).transaction(async (tx) => {
      await tx.execute(
        dsql`SELECT set_config('role', ${role}, true), set_config('app.org_id', ${orgId}, true), set_config('app.user_id', ${userId}, true), set_config('app.user_role', ${userRole}, true)`
      );
      boundContexts.set(tx, context);
      return run(tx);
    });
  }

  const client = target as postgres.Sql;
  if (typeof client.begin === 'function') {
    return beginTenant(client, context, run);
  }

  // A transaction opened directly on a login client: bind it for the rest of its lifetime.
  const txn = target as postgres.TransactionSql;
  await applyContext(txn, tenantSettings(context));
  boundContexts.set(txn, context);
  return run(txn);
}

/**
 * Returns a client bound to `context`, the way every tenant operation reaches the database.
 *
 * Each statement awaited on it runs in its own short tenant transaction (the same autocommit semantics
 * as the pooled client, but under RLS); `begin()` runs a callback in one tenant transaction. A target
 * that is already bound is returned unchanged, so nested operations inherit their caller's context.
 */
export function tenantSql(target: DbOrSql, context: TenantContext): postgres.Sql {
  const bound = boundContexts.get(target);
  if (bound) {
    assertSameTenant(bound, context);
    if (typeof target !== 'function') {
      throw new Error('tenantSql: a drizzle transaction cannot be used for raw SQL operations');
    }
    return target as postgres.Sql;
  }
  const raw = loginSql(target);
  if (typeof raw.begin !== 'function') {
    throw new Error('tenantSql: cannot scope an unbound transaction; open it with withTenantContext()');
  }
  tenantSettings(context);
  return createScopedSql(raw, context);
}

/**
 * The pooled login-role client behind `target`. Use it only to call the narrowly privileged
 * SECURITY DEFINER entry points of migration 0015 (cross-tenant system work and auth bootstrap):
 * the tenant roles cannot execute them, and the login role cannot read tenant tables directly.
 */
export function loginSql(target: DbOrSql): postgres.Sql {
  const t = target as unknown as Record<string, unknown>;
  return (loginClients.get(t) ?? ('$client' in t ? t.$client : t)) as postgres.Sql;
}

type Statement = Promise<unknown> & { execute: () => unknown };
const settled = Promise.prototype.then;

function createScopedSql(raw: postgres.Sql, context: TenantContext): postgres.Sql {
  // Statements built here stay genuine postgres.js Query objects, so they still inline as fragments in
  // other queries. Awaiting one runs it inside its own short tenant transaction, and the caller resumes
  // only after COMMIT, so the next statement (possibly on another pooled connection) sees its writes.
  // postgres.js executes a query through the `handler` of the sql instance that built it; the
  // transaction's handler re-targets it at that connection. runtime-rls.test.ts guards these internals.
  const bind = <Q>(query: Q): Q => {
    const statement = query as unknown as Statement;
    let done: Promise<unknown> | undefined;
    const run = () =>
      (done ??= beginTenant(raw, context, (txn) => {
        (txn`SELECT 1` as unknown as { handler: (q: unknown) => void }).handler(statement);
        return settled.call(statement, (rows: unknown) => rows);
      }));
    Object.assign(statement, {
      then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        run().then(onFulfilled, onRejected),
      catch: (onRejected?: (e: unknown) => unknown) => run().catch(onRejected),
      finally: (onFinally?: () => void) => run().finally(onFinally),
      execute: () => (run(), statement),
    });
    return query;
  };

  const rawFn = raw as unknown as (...args: unknown[]) => unknown;
  const scoped = Object.assign(
    (first: unknown, ...rest: unknown[]) => {
      const result = rawFn(first, ...rest);
      // Tagged templates are statements; identifier/list helpers are values and pass through.
      return Array.isArray((first as { raw?: unknown })?.raw) ? bind(result) : result;
    },
    {
      unsafe: (...args: Parameters<postgres.Sql['unsafe']>) => bind(raw.unsafe(...args)),
      begin: (options: unknown, fn?: unknown) =>
        typeof options === 'function'
          ? beginTenant(raw, context, options as (txn: postgres.TransactionSql) => unknown)
          : beginTenant(raw, context, fn as (txn: postgres.TransactionSql) => unknown, options as string),
      json: raw.json,
      array: raw.array,
      typed: raw.typed,
      types: raw.types,
      options: raw.options,
    }
  );
  boundContexts.set(scoped, context);
  loginClients.set(scoped, raw);
  return scoped as unknown as postgres.Sql;
}
