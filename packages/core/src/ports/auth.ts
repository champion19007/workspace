import { OrgRoleSchema, type OrgRole } from '../auth/roles.js';

export { OrgRoleSchema, type OrgRole };

export interface AuthUser {
  id: string; // Internal UUIDv7
  email: string;
  providerUserId: string; // cognito_sub or supabase_uid
}

export interface AuthSession {
  userId: string;
  email: string;
  activeOrgId?: string | null;
  role?: OrgRole | null;
  sessionEpoch: number;
  expiresAt: Date;
}

export interface PasswordlessRequestInput {
  email: string;
  redirectUrl?: string;
}

export interface PasswordlessVerifyInput {
  email: string;
  tokenOrCode: string;
}

export interface OAuthUrlInput {
  provider: 'google';
  redirectUrl: string;
  state?: string;
  codeChallenge?: string;
}

export interface OAuthExchangeInput {
  code: string;
  codeVerifier?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
}

export interface AuthPort {
  readonly provider: string;
  /**
   * PKCE providers return codeVerifier from the email-link and OAuth starts: opaque state the caller keeps
   * (httpOnly cookie) and passes back unchanged to exchangeOAuthCode when the provider redirects with ?code=.
   */
  requestPasswordless(
    input: PasswordlessRequestInput
  ): Promise<{ messageId?: string; sent: boolean; codeVerifier?: string }>;
  verifyPasswordless(input: PasswordlessVerifyInput): Promise<{ user: AuthUser; tokens: AuthTokens }>;
  getOAuthUrl(input: OAuthUrlInput): Promise<{ url: string; state?: string; codeVerifier?: string }>;
  exchangeOAuthCode(input: OAuthExchangeInput): Promise<{ user: AuthUser; tokens: AuthTokens }>;
  refreshSession(refreshToken: string): Promise<AuthTokens>;
  verifySessionToken(token: string): Promise<AuthSession | AuthUser>;
  revokeSession(userId: string): Promise<void>;
  checkHealth(): Promise<{ healthy: boolean; details?: unknown }>;
}
