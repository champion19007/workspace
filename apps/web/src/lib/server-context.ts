import { parseConfig, type AppConfig, type AppPorts } from '@workspace/core';
import { createAppPorts } from '@workspace/adapters';
import { createApiClient, type DatabaseInstance, type Sql } from '@workspace/db';

let cachedConfig: AppConfig | null = null;
let cachedPorts: AppPorts | null = null;
let cachedDb: DatabaseInstance | null = null;
let cachedSql: Sql | null = null;

// Local development only (docker database). Production never falls back to it.
const DEV_DATABASE_URL = 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev';

/**
 * A public deployment must not run with demo sign-in (anyone could sign in as anyone), the session secret
 * committed to this repository, or the local database. Fail with one message listing what is still missing.
 */
export function productionConfigProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is not set');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    problems.push('SESSION_SECRET must be a random value of at least 32 characters');
  }
  if (env.AUTH_PROVIDER !== 'supabase') {
    problems.push("AUTH_PROVIDER must be 'supabase' (demo sign-in is turned off in production)");
  } else if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    problems.push('SUPABASE_URL and SUPABASE_ANON_KEY are required for sign-in');
  }
  return problems;
}

export function getServerContext(): {
  config: AppConfig;
  ports: AppPorts;
  db: DatabaseInstance;
  sql: Sql;
} {
  if (!cachedConfig) {
    const env = process.env;
    if (env.NODE_ENV === 'production') {
      const problems = productionConfigProblems(env);
      if (problems.length > 0) {
        throw new Error(`Production configuration is incomplete:\n- ${problems.join('\n- ')}\nSee docs/deploy-vercel.md.`);
      }
    }

    cachedConfig = parseConfig({
      DATABASE_URL: env.DATABASE_URL || DEV_DATABASE_URL,
      DATABASE_DIRECT_URL: env.DATABASE_DIRECT_URL || env.DATABASE_URL || DEV_DATABASE_URL,
      ORIGIN_VERIFY_SECRET: env.ORIGIN_VERIFY_SECRET || 'workspace-origin-verify-secret-token-32c',
      SESSION_SECRET: env.SESSION_SECRET || 'workspace-session-secret-token-at-least-16c',
      AUTH_PROVIDER: (env.AUTH_PROVIDER as 'mock' | 'supabase' | 'cognito') || 'mock',
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
      // Zoom import needs real OAuth credentials and a durable secret store; unset means the mock client.
      ZOOM_CLIENT_PROVIDER: env.ZOOM_CLIENT_PROVIDER,
      ZOOM_CLIENT_ID: env.ZOOM_CLIENT_ID,
      ZOOM_CLIENT_SECRET: env.ZOOM_CLIENT_SECRET,
      ZOOM_REDIRECT_URI: env.ZOOM_REDIRECT_URI,
      SECRET_STORE_PROVIDER: env.SECRET_STORE_PROVIDER,
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

/** Zoom import works only with real Zoom credentials and a secret store that outlives a serverless request. */
export function isZoomAvailable(config: AppConfig): boolean {
  return (
    process.env.NODE_ENV !== 'production' ||
    (config.ZOOM_CLIENT_PROVIDER === 'http' && config.SECRET_STORE_PROVIDER === 'aws_secrets_manager')
  );
}
