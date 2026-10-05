import { z } from 'zod';

export const OrgRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

export interface AuthUser {
  id: string; // Internal UUIDv7
  email: string;
  providerUserId: string; // cognito_sub or supabase_uid
}

export interface AuthSession {
  userId: string;
  email: string;
  activeOrgId: string;
  role: OrgRole;
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

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
}

export interface AuthPort {
  readonly provider: string;
  requestPasswordless(input: PasswordlessRequestInput): Promise<{ messageId?: string; sent: boolean }>;
  verifyPasswordless(input: PasswordlessVerifyInput): Promise<{ user: AuthUser; tokens: AuthTokens }>;
  verifySessionToken(token: string): Promise<AuthSession>;
  revokeSession(userId: string): Promise<void>;
  checkHealth(): Promise<{ healthy: boolean; details?: unknown }>;
}
