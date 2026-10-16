import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';

export type { Sql };
export type DatabaseInstance = ReturnType<typeof drizzle<typeof schema>>;

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

import { sql as dsql } from 'drizzle-orm';

export type TenantTransaction = Parameters<Parameters<DatabaseInstance['transaction']>[0]>[0];

/** RLS-enforced runtime roles assumed by every tenant transaction (see migration 0015). */
export const TENANT_DB_ROLE = 'workspace_app';
export const SYSTEM_DB_ROLE = 'workspace_system';

function tenantSettings(context: TenantContext): [string, string, string, string] {
  if (!context.orgId || typeof context.orgId !== 'string') {
    throw new Error('TenantContext error: orgId is required and must be a valid string');
  }
  return context.system
    ? [SYSTEM_DB_ROLE, context.orgId, '', 'system']
    : [TENANT_DB_ROLE, context.orgId, context.userId ?? '', context.role ?? ''];
}

/**
 * Runs a database operation inside a transaction-scoped, RLS-enforced tenant context.
 *
 * The first statement switches to the restricted runtime role (`SET LOCAL ROLE workspace_app`, or
 * `workspace_system` for `system: true`) and sets app.org_id / app.user_id / app.user_role with
 * set_config(..., is_local = true). Everything is transaction-local, so it resets at COMMIT/ROLLBACK
 * and never leaks to the next borrower of a pooled connection (safe behind Supabase's transaction
 * pooler and RDS Proxy). Missing context makes RLS policies fail closed.
 *
 * Passing a postgres.js transaction (e.g. from an enclosing withTenantContext) applies the context
 * to that transaction and runs the callback in it instead of opening a new one.
 */
export function withTenantContext<T>(
  target: DatabaseInstance,
  context: TenantContext,
  callback: (tx: TenantTransaction) => Promise<T>
): Promise<T>;
export function withTenantContext<T>(
  target: postgres.Sql | postgres.TransactionSql,
  context: TenantContext,
  callback: (txn: postgres.TransactionSql) => Promise<T>
): Promise<T>;
export async function withTenantContext<T>(
  target: DatabaseInstance | postgres.Sql | postgres.TransactionSql,
  context: TenantContext,
  callback: ((tx: TenantTransaction) => Promise<T>) | ((txn: postgres.TransactionSql) => Promise<T>)
): Promise<T> {
  const [role, orgId, userId, userRole] = tenantSettings(context);

  if ('transaction' in target && typeof target.transaction === 'function') {
    return (target as DatabaseInstance).transaction(async (tx) => {
      await tx.execute(
        dsql`SELECT set_config('role', ${role}, true), set_config('app.org_id', ${orgId}, true), set_config('app.user_id', ${userId}, true), set_config('app.user_role', ${userRole}, true)`
      );
      return (callback as (tx: TenantTransaction) => Promise<T>)(tx);
    });
  }

  const run = async (txn: postgres.TransactionSql) => {
    await txn`SELECT set_config('role', ${role}, true), set_config('app.org_id', ${orgId}, true), set_config('app.user_id', ${userId}, true), set_config('app.user_role', ${userRole}, true)`;
    return (callback as (txn: postgres.TransactionSql) => Promise<T>)(txn);
  };

  if (typeof (target as postgres.Sql).begin === 'function') {
    return (await (target as postgres.Sql).begin(run)) as T;
  }
  return run(target as postgres.TransactionSql);
}
