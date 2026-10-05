import {
  type AuthPort,
  type AuthUser,
  type AuthSession,
  type AuthTokens,
  type PasswordlessRequestInput,
  type PasswordlessVerifyInput,
  type OAuthUrlInput,
  type OAuthExchangeInput,
  AdapterUnavailableError,
  UnauthorizedError,
  generateUuidV7,
} from '@workspace/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface PendingLoginChallenge {
  email: string;
  codeOrToken: string;
  expiresAt: number;
  used: boolean;
}

/**
 * Controllable Mock Auth Adapter for deterministic unit, integration, and E2E testing.
 * Provides controllable time, simulated token generation, replay protection, and session revocation.
 */
export class ControllableMockAuthAdapter implements AuthPort {
  public readonly provider = 'mock';

  private currentTimeMs: number = Date.now();
  private pendingChallenges: Map<string, PendingLoginChallenge> = new Map();
  private revokedUsers: Set<string> = new Set();
  private oauthCodes: Map<string, { email: string; providerUserId: string; used: boolean; expiresAt: number }> = new Map();

  constructor(initialTimeMs?: number) {
    if (initialTimeMs) {
      this.currentTimeMs = initialTimeMs;
    }
  }

  public setTime(timeMs: number): void {
    this.currentTimeMs = timeMs;
  }

  public advanceTime(ms: number): void {
    this.currentTimeMs += ms;
  }

  public getTime(): number {
    return this.currentTimeMs;
  }

  public setPendingChallenge(tokenOrCode: string, challenge: PendingLoginChallenge): void {
    this.pendingChallenges.set(tokenOrCode, challenge);
  }

  public getPendingChallenge(tokenOrCode: string): PendingLoginChallenge | undefined {
    return this.pendingChallenges.get(tokenOrCode);
  }

  async requestPasswordless(input: PasswordlessRequestInput): Promise<{ messageId?: string; sent: boolean }> {
    const email = input.email.toLowerCase().trim();
    const token = `magic-${Math.random().toString(36).substring(2, 10)}`;
    const ttlMs = 15 * 60 * 1000; // 15 min TTL

    this.pendingChallenges.set(token, {
      email,
      codeOrToken: token,
      expiresAt: this.currentTimeMs + ttlMs,
      used: false,
    });

    // Also store by predictable test code if it's a known test user
    if (email === 'test@workspace.dev' || email === 'owner@workspace.dev') {
      this.pendingChallenges.set('123456', {
        email,
        codeOrToken: '123456',
        expiresAt: this.currentTimeMs + ttlMs,
        used: false,
      });
    }

    return {
      messageId: `mock-msg-${this.currentTimeMs}`,
      sent: true,
    };
  }

  async verifyPasswordless(input: PasswordlessVerifyInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const email = input.email.toLowerCase().trim();
    const tokenOrCode = input.tokenOrCode.trim();

    const challenge = this.pendingChallenges.get(tokenOrCode);
    if (!challenge) {
      // Allow fallback default token in mock test mode if starts with "valid-"
      if (tokenOrCode.startsWith('valid-')) {
        return this.createMockAuthResult(email);
      }
      throw new UnauthorizedError('Invalid or expired login link');
    }

    if (challenge.used) {
      throw new UnauthorizedError('Login link has already been used');
    }

    if (this.currentTimeMs > challenge.expiresAt) {
      throw new UnauthorizedError('Login link has expired');
    }

    if (challenge.email !== email) {
      throw new UnauthorizedError('Email does not match login link recipient');
    }

    // Mark as used for single-use / replay prevention
    challenge.used = true;

    return this.createMockAuthResult(email);
  }

  async getOAuthUrl(input: OAuthUrlInput): Promise<{ url: string; state?: string }> {
    const state = input.state ?? Math.random().toString(36).substring(2, 12);
    const mockCode = `oauth-code-${Math.random().toString(36).substring(2, 10)}`;

    this.oauthCodes.set(mockCode, {
      email: 'google-user@workspace.dev',
      providerUserId: 'google-sub-123456789',
      used: false,
      expiresAt: this.currentTimeMs + 5 * 60 * 1000,
    });

    const parsedRedirect = new URL(input.redirectUrl);
    parsedRedirect.searchParams.set('code', mockCode);
    if (state) {
      parsedRedirect.searchParams.set('state', state);
    }

    return {
      url: parsedRedirect.toString(),
      state,
    };
  }

  async exchangeOAuthCode(input: OAuthExchangeInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const entry = this.oauthCodes.get(input.code);
    if (!entry) {
      if (input.code.startsWith('mock-oauth-code-')) {
        return this.createMockAuthResult('oauth-user@workspace.dev');
      }
      throw new UnauthorizedError('Invalid OAuth authorization code');
    }

    if (entry.used) {
      throw new UnauthorizedError('OAuth code has already been used');
    }

    if (this.currentTimeMs > entry.expiresAt) {
      throw new UnauthorizedError('OAuth code has expired');
    }

    entry.used = true;
    return this.createMockAuthResult(entry.email, entry.providerUserId);
  }

  async refreshSession(refreshToken: string): Promise<AuthTokens> {
    if (!refreshToken || refreshToken === 'invalid' || refreshToken === 'expired') {
      throw new UnauthorizedError('Invalid refresh token');
    }
    return {
      accessToken: `mock-refreshed-jwt-${this.currentTimeMs}`,
      refreshToken: `mock-refresh-token-${this.currentTimeMs}`,
      expiresInSeconds: 3600,
    };
  }

  async verifySessionToken(token: string): Promise<AuthSession | AuthUser> {
    if (!token || token === 'invalid') {
      throw new UnauthorizedError('Invalid authentication token');
    }
    return {
      id: '018f3a55-0000-7000-8000-000000000099',
      email: 'founder@workspace.dev',
      providerUserId: 'mock-sub-founder@workspace.dev',
    };
  }

  async revokeSession(userId: string): Promise<void> {
    this.revokedUsers.add(userId);
  }

  public isUserRevoked(userId: string): boolean {
    return this.revokedUsers.has(userId);
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return { healthy: true, details: { provider: this.provider, currentTime: this.currentTimeMs } };
  }

  private createMockAuthResult(email: string, providerUserId?: string): { user: AuthUser; tokens: AuthTokens } {
    const sub = providerUserId ?? `mock-sub-${email}`;
    const user: AuthUser = {
      id: generateUuidV7(this.currentTimeMs),
      email: email.toLowerCase(),
      providerUserId: sub,
    };
    const tokens: AuthTokens = {
      accessToken: `mock-jwt-token-for-${email}`,
      refreshToken: `mock-refresh-token-for-${email}`,
      expiresInSeconds: 3600,
    };
    return { user, tokens };
  }
}

export { ControllableMockAuthAdapter as MockAuthAdapter };

export interface SupabaseAuthConfig {
  supabaseUrl?: string;
  anonKey?: string;
  serviceRoleKey?: string;
}

export class SupabaseAuthAdapter implements AuthPort {
  public readonly provider = 'supabase';
  private readonly client: SupabaseClient;

  constructor(private readonly config: SupabaseAuthConfig) {
    if (!config.supabaseUrl || !config.anonKey) {
      throw new AdapterUnavailableError(
        'Auth',
        'supabase',
        'Missing SUPABASE_URL or SUPABASE_ANON_KEY.'
      );
    }

    this.client = createClient(config.supabaseUrl, config.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async requestPasswordless(input: PasswordlessRequestInput): Promise<{ messageId?: string; sent: boolean }> {
    const email = input.email.toLowerCase().trim();
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: input.redirectUrl,
        shouldCreateUser: true,
      },
    });

    if (error) {
      throw new UnauthorizedError(error.message, error);
    }

    return {
      messageId: `supabase-otp-${Date.now()}`,
      sent: true,
    };
  }

  async verifyPasswordless(input: PasswordlessVerifyInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const email = input.email.toLowerCase().trim();
    const token = input.tokenOrCode.trim();

    // Distinguish numeric 6-digit OTP vs token hash
    const type = /^\d{6}$/.test(token) ? 'email' : 'magiclink';

    const { data, error } = await this.client.auth.verifyOtp({
      email,
      token,
      type,
    });

    if (error || !data.user || !data.session) {
      throw new UnauthorizedError(error?.message ?? 'Invalid or expired login link');
    }

    return {
      user: {
        id: generateUuidV7(),
        email: data.user.email ?? email,
        providerUserId: data.user.id,
      },
      tokens: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresInSeconds: data.session.expires_in,
      },
    };
  }

  async getOAuthUrl(input: OAuthUrlInput): Promise<{ url: string; state?: string }> {
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: input.redirectUrl,
        scopes: 'email profile',
        queryParams: input.state ? { state: input.state } : undefined,
      },
    });

    if (error || !data.url) {
      throw new UnauthorizedError(error?.message ?? 'Failed to initiate Google OAuth flow');
    }

    return {
      url: data.url,
      state: input.state,
    };
  }

  async exchangeOAuthCode(input: OAuthExchangeInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const { data, error } = await this.client.auth.exchangeCodeForSession(input.code);

    if (error || !data.user || !data.session) {
      throw new UnauthorizedError(error?.message ?? 'Failed to exchange authorization code');
    }

    return {
      user: {
        id: generateUuidV7(),
        email: data.user.email ?? '',
        providerUserId: data.user.id,
      },
      tokens: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresInSeconds: data.session.expires_in,
      },
    };
  }

  async refreshSession(refreshToken: string): Promise<AuthTokens> {
    const { data, error } = await this.client.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      throw new UnauthorizedError(error?.message ?? 'Failed to refresh authentication session');
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresInSeconds: data.session.expires_in,
    };
  }

  async verifySessionToken(token: string): Promise<AuthUser> {
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedError(error?.message ?? 'Invalid session token');
    }

    return {
      id: generateUuidV7(),
      email: data.user.email ?? '',
      providerUserId: data.user.id,
    };
  }

  async revokeSession(userId: string): Promise<void> {
    if (this.config.serviceRoleKey) {
      const adminClient = createClient(this.config.supabaseUrl!, this.config.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await adminClient.auth.admin.signOut(userId, 'global');
    } else {
      await this.client.auth.signOut({ scope: 'global' });
    }
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return {
      healthy: Boolean(this.config.supabaseUrl && this.config.anonKey),
      details: {
        provider: this.provider,
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
    throw new AdapterUnavailableError('Auth', 'cognito', 'Cognito Auth client uninitialized in Architecture A.');
  }

  async verifyPasswordless(_input: PasswordlessVerifyInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    throw new AdapterUnavailableError('Auth', 'cognito', 'Cognito Auth client uninitialized in Architecture A.');
  }

  async getOAuthUrl(_input: OAuthUrlInput): Promise<{ url: string; state?: string }> {
    throw new AdapterUnavailableError('Auth', 'cognito', 'Cognito OAuth uninitialized in Architecture A.');
  }

  async exchangeOAuthCode(_input: OAuthExchangeInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    throw new AdapterUnavailableError('Auth', 'cognito', 'Cognito OAuth exchange uninitialized in Architecture A.');
  }

  async refreshSession(_refreshToken: string): Promise<AuthTokens> {
    throw new AdapterUnavailableError('Auth', 'cognito', 'Cognito refreshSession uninitialized in Architecture A.');
  }

  async verifySessionToken(_token: string): Promise<AuthSession | AuthUser> {
    throw new AdapterUnavailableError('Auth', 'cognito', 'Cognito JWT verification uninitialized in Architecture A.');
  }

  async revokeSession(_userId: string): Promise<void> {
    throw new AdapterUnavailableError('Auth', 'cognito', 'Cognito GlobalSignOut uninitialized in Architecture A.');
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return {
      healthy: false,
      details: {
        provider: this.provider,
        error: 'Cognito Auth uninitialized (Architecture B target)',
        configured: Boolean(this.config.userPoolId),
      },
    };
  }
}
