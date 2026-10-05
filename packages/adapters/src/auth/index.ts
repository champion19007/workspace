import {
  type AuthPort,
  type AuthUser,
  type AuthSession,
  type AuthTokens,
  type PasswordlessRequestInput,
  type PasswordlessVerifyInput,
  AdapterUnavailableError,
} from '@workspace/core';

export class MockAuthAdapter implements AuthPort {
  public readonly provider = 'mock';

  async requestPasswordless(_input: PasswordlessRequestInput): Promise<{ messageId?: string; sent: boolean }> {
    return {
      messageId: `mock-msg-${Date.now()}`,
      sent: true,
    };
  }

  async verifyPasswordless(input: PasswordlessVerifyInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const user: AuthUser = {
      id: '018f3a55-0000-7000-8000-000000000099',
      email: input.email,
      providerUserId: `mock-sub-${input.email}`,
    };
    const tokens: AuthTokens = {
      accessToken: `mock-jwt-token-for-${input.email}`,
      refreshToken: `mock-refresh-token`,
      expiresInSeconds: 3600,
    };
    return { user, tokens };
  }

  async verifySessionToken(token: string): Promise<AuthSession> {
    if (!token || token === 'invalid') {
      throw new Error('Invalid authentication token');
    }
    return {
      userId: '018f3a55-0000-7000-8000-000000000099',
      email: 'founder@workspace.dev',
      activeOrgId: '018f3a55-0000-7000-8000-000000000001',
      role: 'owner',
      sessionEpoch: 1,
      expiresAt: new Date(Date.now() + 3600 * 1000),
    };
  }

  async revokeSession(_userId: string): Promise<void> {
    // noop
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return { healthy: true, details: { provider: this.provider } };
  }
}

export interface SupabaseAuthConfig {
  supabaseUrl?: string;
  anonKey?: string;
}

export class SupabaseAuthAdapter implements AuthPort {
  public readonly provider = 'supabase';

  constructor(private readonly config: SupabaseAuthConfig) {
    if (!config.supabaseUrl || !config.anonKey) {
      throw new AdapterUnavailableError(
        'Auth',
        'supabase',
        'Missing SUPABASE_URL or SUPABASE_ANON_KEY.'
      );
    }
  }

  async requestPasswordless(_input: PasswordlessRequestInput): Promise<{ messageId?: string; sent: boolean }> {
    throw new AdapterUnavailableError('Auth', 'supabase', 'Supabase Auth client uninitialized.');
  }

  async verifyPasswordless(_input: PasswordlessVerifyInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    throw new AdapterUnavailableError('Auth', 'supabase', 'Supabase Auth client uninitialized.');
  }

  async verifySessionToken(_token: string): Promise<AuthSession> {
    throw new AdapterUnavailableError('Auth', 'supabase', 'Supabase Auth JWT verification uninitialized.');
  }

  async revokeSession(_userId: string): Promise<void> {
    throw new AdapterUnavailableError('Auth', 'supabase', 'Supabase Auth revocation uninitialized.');
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return {
      healthy: false,
      details: {
        provider: this.provider,
        error: 'Supabase Auth uninitialized',
        configured: Boolean(this.config.supabaseUrl),
      },
    };
  }
}

export interface CognitoAuthConfig {
  userPoolId?: string;
  clientId?: string;
  region?: string;
}

export class CognitoAuthAdapter implements AuthPort {
  public readonly provider = 'cognito';

  constructor(private readonly config: CognitoAuthConfig) {
    if (!config.userPoolId || !config.clientId) {
      throw new AdapterUnavailableError(
        'Auth',
        'cognito',
        'Missing COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID.'
      );
    }
  }

  async requestPasswordless(_input: PasswordlessRequestInput): Promise<{ messageId?: string; sent: boolean }> {
    throw new AdapterUnavailableError('Auth', 'cognito', 'Cognito Auth client uninitialized.');
  }

  async verifyPasswordless(_input: PasswordlessVerifyInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    throw new AdapterUnavailableError('Auth', 'cognito', 'Cognito Auth client uninitialized.');
  }

  async verifySessionToken(_token: string): Promise<AuthSession> {
    throw new AdapterUnavailableError('Auth', 'cognito', 'Cognito JWT verification uninitialized.');
  }

  async revokeSession(_userId: string): Promise<void> {
    throw new AdapterUnavailableError('Auth', 'cognito', 'Cognito GlobalSignOut uninitialized.');
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return {
      healthy: false,
      details: {
        provider: this.provider,
        error: 'Cognito Auth uninitialized',
        configured: Boolean(this.config.userPoolId),
      },
    };
  }
}
