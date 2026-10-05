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

export async function withTenantContext<T>(
  sql: postgres.Sql,
  orgId: string,
  callback: (txn: postgres.TransactionSql) => Promise<T>
): Promise<T> {
  const result = await sql.begin(async (txn) => {
    // Set local org_id for transaction lifetime; safe for connection poolers
    await txn`SET LOCAL app.org_id = ${orgId}`;
    return callback(txn);
  });
  return result as T;
}
