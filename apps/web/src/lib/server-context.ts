import { parseConfig, type AppConfig, type AppPorts } from '@workspace/core';
import { createAppPorts } from '@workspace/adapters';
import { createApiClient, type DatabaseInstance, type Sql } from '@workspace/db';

let cachedConfig: AppConfig | null = null;
let cachedPorts: AppPorts | null = null;
let cachedDb: DatabaseInstance | null = null;
let cachedSql: Sql | null = null;

export function getServerContext(): {
  config: AppConfig;
  ports: AppPorts;
  db: DatabaseInstance;
  sql: Sql;
} {
  if (!cachedConfig) {
    cachedConfig = parseConfig({
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
      DATABASE_DIRECT_URL: process.env.DATABASE_DIRECT_URL || 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
      ORIGIN_VERIFY_SECRET: process.env.ORIGIN_VERIFY_SECRET || 'workspace-origin-verify-secret-token-32c',
      SESSION_SECRET: process.env.SESSION_SECRET || 'workspace-session-secret-token-at-least-16c',
      AUTH_PROVIDER: (process.env.AUTH_PROVIDER as 'mock' | 'supabase' | 'cognito') || 'mock',
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
  }

  if (!cachedPorts) {
    cachedPorts = createAppPorts(cachedConfig);
  }

  if (!cachedDb || !cachedSql) {
    const { sql, db } = createApiClient({
      connectionString: cachedConfig.DATABASE_URL,
      maxConnections: 5,
    });
    cachedDb = db;
    cachedSql = sql;
  }

  return {
    config: cachedConfig,
    ports: cachedPorts,
    db: cachedDb,
    sql: cachedSql,
  };
}
