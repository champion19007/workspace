import { z } from 'zod';
import { OrgRoleSchema, type OrgRole } from './roles.js';

export const SESSION_COOKIE_NAME = 'workspace_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days in seconds
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;
export const SESSION_ROLLING_REFRESH_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export const SessionPayloadSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  activeOrgId: z.string().uuid().nullable().optional(),
  role: OrgRoleSchema.nullable().optional(),
  sessionEpoch: z.number().int().default(1),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  providerRefreshToken: z.string().optional(),
});

export type SessionPayload = z.infer<typeof SessionPayloadSchema>;

export interface CreateSessionOptions {
  userId: string;
  email: string;
  activeOrgId?: string | null;
  role?: OrgRole | null;
  sessionEpoch?: number;
  providerRefreshToken?: string;
  now?: number;
}

/**
 * Creates a new session with a 30-day rolling expiration window.
 */
export function createSessionPayload(options: CreateSessionOptions): SessionPayload {
  const currentTime = options.now ?? Date.now();
  return {
    userId: options.userId,
    email: options.email.toLowerCase(),
    activeOrgId: options.activeOrgId ?? null,
    role: options.role ?? null,
    sessionEpoch: options.sessionEpoch ?? 1,
    createdAt: currentTime,
    expiresAt: currentTime + SESSION_MAX_AGE_MS,
    providerRefreshToken: options.providerRefreshToken,
  };
}

/**
 * Checks if a session is expired based on its expiresAt timestamp.
 */
export function isSessionExpired(session: SessionPayload, now: number = Date.now()): boolean {
  return now >= session.expiresAt;
}

/**
 * Determines whether the rolling session window should be refreshed.
 * We refresh if session has passed the threshold (e.g. 1 hour) and is not expired.
 */
export function shouldRefreshSession(session: SessionPayload, now: number = Date.now()): boolean {
  if (isSessionExpired(session, now)) {
    return false;
  }
  const elapsedSinceCreation = now - session.createdAt;
  const remainingLife = session.expiresAt - now;
  // If more than 1 hour elapsed or less than 29 days remaining, roll it forward
  return elapsedSinceCreation >= SESSION_ROLLING_REFRESH_THRESHOLD_MS || remainingLife < (SESSION_MAX_AGE_MS - SESSION_ROLLING_REFRESH_THRESHOLD_MS);
}

/**
 * Rolls the session window forward by 30 days.
 */
export function rollSessionExpiry(session: SessionPayload, now: number = Date.now()): SessionPayload {
  return {
    ...session,
    expiresAt: now + SESSION_MAX_AGE_MS,
  };
}

/**
 * Rotates a session, e.g. after login or org switch, resetting session createdAt and rolling expiry.
 */
export function rotateSession(
  session: SessionPayload,
  updates: Partial<Pick<SessionPayload, 'activeOrgId' | 'role' | 'sessionEpoch' | 'providerRefreshToken'>> = {},
  now: number = Date.now()
): SessionPayload {
  return {
    ...session,
    ...updates,
    createdAt: now,
    expiresAt: now + SESSION_MAX_AGE_MS,
  };
}
