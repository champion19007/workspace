import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  type RealtimePort,
  type RealtimeEvent,
  type RealtimeEventType,
  AdapterUnavailableError,
} from '@workspace/core';

export class InMemoryRealtimeAdapter implements RealtimePort {
  public readonly provider = 'in_memory';
  public readonly publishedEvents: { channel: string; event: RealtimeEvent<RealtimeEventType> }[] = [];

  async publish<T extends RealtimeEventType>(
    channel: string,
    event: RealtimeEvent<T>
  ): Promise<void> {
    this.publishedEvents.push({ channel, event });
  }

  async mintToken(userId: string, orgId: string, channels: string[]): Promise<string> {
    return `in_memory_rt_token:${userId}:${orgId}:${channels.join(',')}`;
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return { healthy: true, details: { provider: this.provider, eventCount: this.publishedEvents.length } };
  }
}

export interface SupabaseRealtimeConfig {
  supabaseUrl?: string;
  serviceRoleKey?: string;
}

export class SupabaseRealtimeAdapter implements RealtimePort {
  public readonly provider = 'supabase';
  private client: SupabaseClient | null = null;

  constructor(private readonly config: SupabaseRealtimeConfig) {
    if (!config.supabaseUrl || !config.serviceRoleKey) {
      throw new AdapterUnavailableError(
        'Realtime',
        'supabase',
        'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.'
      );
    }
  }

  private getClient(): SupabaseClient {
    if (!this.client) {
      this.client = createClient(this.config.supabaseUrl!, this.config.serviceRoleKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return this.client;
  }

  async publish<T extends RealtimeEventType>(
    channel: string,
    event: RealtimeEvent<T>
  ): Promise<void> {
    const client = this.getClient();
    const rtChannel = client.channel(channel);
    await rtChannel.send({
      type: 'broadcast',
      event: event.type,
      payload: event.payload,
    });
  }

  async mintToken(userId: string, orgId: string, channels: string[]): Promise<string> {
    const claims = {
      sub: userId,
      org_id: orgId,
      channels,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    return Buffer.from(JSON.stringify(claims)).toString('base64url');
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return {
      healthy: Boolean(this.config.supabaseUrl && this.config.serviceRoleKey),
      details: {
        provider: this.provider,
        configured: Boolean(this.config.supabaseUrl && this.config.serviceRoleKey),
      },
    };
  }
}

export interface AppSyncRealtimeConfig {
  endpoint?: string;
  region?: string;
}

export class AppSyncRealtimeAdapter implements RealtimePort {
  public readonly provider = 'appsync';

  constructor(private readonly config: AppSyncRealtimeConfig) {
    if (!config.endpoint) {
      throw new AdapterUnavailableError(
        'Realtime',
        'appsync',
        'Missing AppSync Events endpoint configuration.'
      );
    }
  }

  async publish<T extends RealtimeEventType>(
    _channel: string,
    _event: RealtimeEvent<T>
  ): Promise<void> {
    throw new AdapterUnavailableError(
      'Realtime',
      'appsync',
      'AppSync Events HTTP publish client uninitialized.'
    );
  }

  async mintToken(_userId: string, _orgId: string, _channels: string[]): Promise<string> {
    throw new AdapterUnavailableError('Realtime', 'appsync', 'Cognito JWT authentication required for AppSync.');
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return {
      healthy: false,
      details: {
        provider: this.provider,
        error: 'AppSync Events uninitialized',
        configured: Boolean(this.config.endpoint),
      },
    };
  }
}
