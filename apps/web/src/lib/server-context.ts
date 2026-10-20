import { parseConfig, type AppConfig, type AppPorts } from '@workspace/core';
import { createAppPorts } from '@workspace/adapters';
import { createApiClient, type DatabaseInstance, type Sql } from '@workspace/db';

type ServerContext = { config: AppConfig; ports: AppPorts; db: DatabaseInstance; sql: Sql };

// `next dev` evaluates this module once per route bundle (and again after HMR). Module-level variables would
// give each route its own ports and DB pool: the mock auth adapter's OAuth codes issued by one route would be
// unknown to the callback route, and every route would open another pool. One instance per process instead.
const globalForContext = globalThis as typeof globalThis & { __workspaceServerContext?: ServerContext };

export function getServerContext(): ServerContext {
  if (!globalForContext.__workspaceServerContext) {
    const config = parseConfig({
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
      DATABASE_DIRECT_URL: process.env.DATABASE_DIRECT_URL || 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
      ORIGIN_VERIFY_SECRET: process.env.ORIGIN_VERIFY_SECRET || 'workspace-origin-verify-secret-token-32c',
      SESSION_SECRET: process.env.SESSION_SECRET || 'workspace-session-secret-token-at-least-16c',
      AUTH_PROVIDER: (process.env.AUTH_PROVIDER as 'mock' | 'supabase' | 'cognito') || 'mock',
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    const { sql, db } = createApiClient({ connectionString: config.DATABASE_URL, maxConnections: 5 });
    globalForContext.__workspaceServerContext = { config, ports: createAppPorts(config), db, sql };
  }
  return globalForContext.__workspaceServerContext;
}
