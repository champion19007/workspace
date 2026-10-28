import { type AppConfig, type AppPorts, AdapterUnavailableError } from '@workspace/core';
import { InMemoryQueueAdapter, PgBossQueueAdapter, SqsQueueAdapter } from './queue/index.js';
import { InMemoryRealtimeAdapter, SupabaseRealtimeAdapter, AppSyncRealtimeAdapter } from './realtime/index.js';
import { MockLlmAdapter, AnthropicLlmAdapter, BedrockLlmAdapter } from './llm/index.js';
import { InMemoryBlobStoreAdapter, SupabaseBlobStoreAdapter, S3BlobStoreAdapter } from './blob-store/index.js';
import { ConsoleEmailAdapter, ResendEmailAdapter } from './email/index.js';
import { MockAuthAdapter, SupabaseAuthAdapter, CognitoAuthAdapter } from './auth/index.js';
import { InMemorySecretStoreAdapter, AwsSecretsManagerAdapter } from './secret-store/index.js';
import { MockZoomClientAdapter, HttpZoomClientAdapter } from './zoom/index.js';

export function createAppPorts(config: AppConfig): AppPorts {
  // 1. Queue Port
  let queue;
  switch (config.QUEUE_PROVIDER) {
    case 'in_memory':
      queue = new InMemoryQueueAdapter();
      break;
    case 'pgboss':
      queue = new PgBossQueueAdapter({ databaseUrl: config.DATABASE_DIRECT_URL });
      break;
    case 'sqs':
      queue = new SqsQueueAdapter({
        region: config.AWS_REGION,
        queueUrl: config.SQS_MEETING_EVENTS_QUEUE_URL,
      });
      break;
    default:
      throw new AdapterUnavailableError('Queue', config.QUEUE_PROVIDER, 'Unsupported queue provider');
  }

  // 2. Realtime Port
  let realtime;
  switch (config.REALTIME_PROVIDER) {
    case 'in_memory':
      realtime = new InMemoryRealtimeAdapter();
      break;
    case 'supabase':
      realtime = new SupabaseRealtimeAdapter({
        supabaseUrl: config.SUPABASE_URL,
        serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
      });
      break;
    case 'appsync':
      realtime = new AppSyncRealtimeAdapter({
        region: config.AWS_REGION,
        endpoint: process.env['APPSYNC_ENDPOINT'],
      });
      break;
    default:
      throw new AdapterUnavailableError('Realtime', config.REALTIME_PROVIDER, 'Unsupported realtime provider');
  }

  // 3. LLM Port
  let llm;
  switch (config.LLM_PROVIDER) {
    case 'mock':
      llm = new MockLlmAdapter();
      break;
    case 'anthropic':
      llm = new AnthropicLlmAdapter({
        apiKey: config.ANTHROPIC_API_KEY,
        voyageApiKey: config.VOYAGE_API_KEY,
        voyageModel: config.VOYAGE_MODEL,
      });
      break;
    case 'bedrock':
      llm = new BedrockLlmAdapter({
        region: config.AWS_REGION,
        indiaInferenceProfileArn: config.BEDROCK_INDIA_INFERENCE_PROFILE_ARN,
      });
      break;
    default:
      throw new AdapterUnavailableError('LLM', config.LLM_PROVIDER, 'Unsupported LLM provider');
  }

  // 4. BlobStore Port
  let blobStore;
  switch (config.STORAGE_PROVIDER) {
    case 'in_memory':
      blobStore = new InMemoryBlobStoreAdapter();
      break;
    case 'supabase':
      blobStore = new SupabaseBlobStoreAdapter({
        supabaseUrl: config.SUPABASE_URL,
        serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
      });
      break;
    case 's3':
      blobStore = new S3BlobStoreAdapter({
        bucket: config.S3_ATTACHMENTS_BUCKET,
        region: config.AWS_REGION,
      });
      break;
    default:
      throw new AdapterUnavailableError('BlobStore', config.STORAGE_PROVIDER, 'Unsupported storage provider');
  }

  // 5. Auth Port
  let auth;
  switch (config.AUTH_PROVIDER) {
    case 'mock':
      auth = new MockAuthAdapter();
      break;
    case 'supabase':
      auth = new SupabaseAuthAdapter({
        supabaseUrl: config.SUPABASE_URL,
        anonKey: config.SUPABASE_ANON_KEY,
      });
      break;
    case 'cognito':
      auth = new CognitoAuthAdapter({
        userPoolId: config.COGNITO_USER_POOL_ID,
        clientId: config.COGNITO_CLIENT_ID,
        region: config.AWS_REGION,
      });
      break;
    default:
      throw new AdapterUnavailableError('Auth', config.AUTH_PROVIDER, 'Unsupported auth provider');
  }

  // 6. Secret Store Port
  let secretStore;
  switch (config.SECRET_STORE_PROVIDER) {
    case 'in_memory':
      secretStore = new InMemorySecretStoreAdapter();
      break;
    case 'aws_secrets_manager':
      secretStore = new AwsSecretsManagerAdapter({ region: config.AWS_REGION });
      break;
    default:
      throw new AdapterUnavailableError('SecretStore', config.SECRET_STORE_PROVIDER, 'Unsupported secret store provider');
  }

  // 7. Zoom Client Port
  let zoomClient;
  switch (config.ZOOM_CLIENT_PROVIDER) {
    case 'mock':
      zoomClient = new MockZoomClientAdapter();
      break;
    case 'http':
      zoomClient = new HttpZoomClientAdapter({
        clientId: config.ZOOM_CLIENT_ID,
        clientSecret: config.ZOOM_CLIENT_SECRET,
        oauthUrl: config.ZOOM_OAUTH_URL,
        apiUrl: config.ZOOM_API_URL,
      });
      break;
    default:
      throw new AdapterUnavailableError('ZoomClient', config.ZOOM_CLIENT_PROVIDER, 'Unsupported zoom client provider');
  }

  // 8. Email Port
  let email;
  switch (config.EMAIL_PROVIDER) {
    case 'console':
      email = new ConsoleEmailAdapter();
      break;
    case 'resend':
      email = new ResendEmailAdapter({
        apiKey: config.RESEND_API_KEY,
        from: config.EMAIL_FROM,
        notificationsFrom: config.EMAIL_FROM_NOTIFICATIONS ?? config.EMAIL_FROM,
      });
      break;
    default:
      throw new AdapterUnavailableError('Email', config.EMAIL_PROVIDER, 'Unsupported email provider');
  }

  return { queue, realtime, llm, blobStore, auth, secretStore, zoomClient, email };
}
