import { createSessionPayload, type AuthUser, type OrgRole } from '@workspace/core';
import { findOrCreateUserByEmail, getUserOrganizations, type DatabaseInstance } from '@workspace/db';
import { serializeSession } from './session';

/**
 * Turns someone the auth provider has vouched for into a session: their user (created on first sign-in), their
 * first organization, and the encrypted cookie value (30 days, rolling). `destination` is where they go next: the
 * safe `returnTo` (e.g. an invitation to accept) when there is one, else their organization or onboarding.
 */
export async function startSession(
  db: DatabaseInstance,
  authUser: AuthUser,
  providerRefreshToken: string | undefined,
  returnTo: string | null
): Promise<{ cookieValue: string; destination: string }> {
  const user = await findOrCreateUserByEmail(db, { email: authUser.email, supabaseUid: authUser.providerUserId });
  const [first] = await getUserOrganizations(db, user.id);
  const cookieValue = serializeSession(
    createSessionPayload({
      userId: user.id,
      email: user.email,
      activeOrgId: first?.orgId ?? null,
      role: (first?.role as OrgRole | undefined) ?? null,
      sessionEpoch: first?.sessionEpoch ?? 1,
      providerRefreshToken,
    })
  );
  return { cookieValue, destination: returnTo ?? (first ? `/orgs/${first.orgId}` : '/onboarding') };
}
