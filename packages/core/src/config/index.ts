import { z } from 'zod';
import { ConfigurationError } from '../errors/index.js';

export const AppConfigSchema = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  REDACT_SENSITIVE_LOGS: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),

  ARCHITECTURE_TIER: z.enum(['architecture_a', 'architecture_b']).default('architecture_a'),

  // Database URLs
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_DIRECT_URL: z.string().min(1, 'DATABASE_DIRECT_URL is required'),
  DB_API_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(10),
  DB_WORKER_POOL_SIZE: z.coerce.number().int().min(1).max(25).default(5),

  // API Server Settings
  PORT: z.coerce.number().int().min(1024).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  ORIGIN_VERIFY_SECRET: z.string().min(16, 'ORIGIN_VERIFY_SECRET must be at least 16 chars'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 chars').optional(),
  // Worker Settings
  WORKER_PORT: z.coerce.number().int().min(1024).max(65535).default(8081),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),

  // Provider Port Selection
  QUEUE_PROVIDER: z.enum(['pgboss', 'sqs', 'in_memory']).default('in_memory'),
  REALTIME_PROVIDER: z.enum(['supabase', 'appsync', 'in_memory']).default('in_memory'),
  LLM_PROVIDER: z.enum(['anthropic', 'bedrock', 'mock']).default('mock'),
  STORAGE_PROVIDER: z.enum(['supabase', 's3', 'in_memory']).default('in_memory'),
  AUTH_PROVIDER: z.enum(['supabase', 'cognito', 'mock']).default('mock'),
  SECRET_STORE_PROVIDER: z.enum(['in_memory', 'aws_secrets_manager']).default('in_memory'),
  ZOOM_CLIENT_PROVIDER: z.enum(['mock', 'http']).default('mock'),
  // 'console' only logs emails (development); 'resend' sends them.
  EMAIL_PROVIDER: z.enum(['resend', 'console']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Workspace <no-reply@localhost>'),
  // Mentions, requests and digests; defaults to EMAIL_FROM. Use a separate subdomain in production.
  EMAIL_FROM_NOTIFICATIONS: z.string().optional(),

  // Zoom Integration Settings
  ZOOM_CLIENT_ID: z.string().default('mock_zoom_client_id'),
  ZOOM_CLIENT_SECRET: z.string().default('mock_zoom_client_secret'),
  ZOOM_WEBHOOK_SECRET_TOKEN: z.string().default('mock_zoom_webhook_secret_token'),
  ZOOM_REDIRECT_URI: z.string().default('http://localhost:3000/api/orgs/default/integrations/zoom/callback'),
  ZOOM_OAUTH_URL: z.string().default('https://zoom.us/oauth'),
  ZOOM_API_URL: z.string().default('https://api.zoom.us/v2'),

  // Architecture A Providers (Optional until live)
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Unset = the adapter's current defaults (claude-haiku-5-5 / claude-sonnet-5-5); set to roll a tier back.
  ANTHROPIC_FAST_MODEL: z.string().optional(),
  ANTHROPIC_STRONG_MODEL: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_MODEL: z.string().default('voyage-3-lite'),

  // Architecture B Providers (Optional until live)
  AWS_REGION: z.string().default('ap-south-1'),
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_CLIENT_ID: z.string().optional(),
  SQS_MEETING_EVENTS_QUEUE_URL: z.string().optional(),
  S3_ATTACHMENTS_BUCKET: z.string().optional(),
  BEDROCK_INDIA_INFERENCE_PROFILE_ARN: z.string().optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export function parseConfig(env: Record<string, unknown> = process.env): AppConfig {
  const result = AppConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigurationError(`Configuration validation failed on startup:\n${issues}`, result.error.format());
  }
  return result.data;
}
