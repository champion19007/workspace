import { z } from 'zod';
import { OrgRoleSchema } from './roles.js';
import { generateSecureRandomToken, hashToken } from './crypto.js';

export const INVITATION_EXPIRY_DAYS = 7;
export const INVITATION_EXPIRY_MS = INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

export const CreateInvitationInputSchema = z.object({
  email: z.string().email(),
  role: OrgRoleSchema.default('member'),
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationInputSchema>;

export const AcceptInvitationInputSchema = z.object({
  token: z.string().min(16),
});
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationInputSchema>;

export interface GeneratedInvitationToken {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

export function generateInvitationToken(now: Date = new Date()): GeneratedInvitationToken {
  const rawToken = generateSecureRandomToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(now.getTime() + INVITATION_EXPIRY_MS);
  return { rawToken, tokenHash, expiresAt };
}
