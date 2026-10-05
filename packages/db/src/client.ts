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
  role?: 'owner' | 'admin' | 'member' | 'viewer';
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

/**
 * Runs a database operation within a strict, transaction-local tenant context.
 * Sets app.org_id, app.user_id, and app.user_role inside the transaction using set_config(..., true).
 * Because is_local = true is scoped to transaction duration, context never leaks across pooled connections.
 * Missing context causes RLS policies to fail closed.
 */
export function withTenantContext<T>(
  target: DatabaseInstance,
  context: TenantContext,
  callback: (tx: TenantTransaction) => Promise<T>
): Promise<T>;
export function withTenantContext<T>(
  target: postgres.Sql,
  context: TenantContext,
  callback: (txn: postgres.TransactionSql) => Promise<T>
): Promise<T>;
export async function withTenantContext<T>(
  target: DatabaseInstance | postgres.Sql,
  context: TenantContext,
  callback: ((tx: TenantTransaction) => Promise<T>) | ((txn: postgres.TransactionSql) => Promise<T>)
): Promise<T> {
  if (!context.orgId || typeof context.orgId !== 'string') {
    throw new Error('TenantContext error: orgId is required and must be a valid string');
  }

  const userId = context.userId ?? '';
  const userRole = context.role ?? '';

  if ('transaction' in target && typeof target.transaction === 'function') {
    return (target as DatabaseInstance).transaction(async (tx) => {
      await tx.execute(dsql`SELECT set_config('app.org_id', ${context.orgId}, true)`);
      await tx.execute(dsql`SELECT set_config('app.user_id', ${userId}, true)`);
      await tx.execute(dsql`SELECT set_config('app.user_role', ${userRole}, true)`);
      return (callback as (tx: TenantTransaction) => Promise<T>)(tx);
    });
  } else {
    const psql = target as postgres.Sql;
    const result = await psql.begin(async (txn) => {
      await txn`SELECT set_config('app.org_id', ${context.orgId}, true)`;
      await txn`SELECT set_config('app.user_id', ${userId}, true)`;
      await txn`SELECT set_config('app.user_role', ${userRole}, true)`;
      return (callback as (txn: postgres.TransactionSql) => Promise<T>)(txn);
    });
    return result as T;
  }
}
