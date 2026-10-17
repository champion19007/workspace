import { type DatabaseInstance, resolveOrgMembership } from '@workspace/db';
import { NotFoundError, ForbiddenError, type OrgRole } from '@workspace/core';

export interface ResolvedTenant {
  orgId: string;
  orgSlug: string;
  orgName: string;
  role: OrgRole;
  sessionEpoch: number;
}

export async function resolveTenantForUser(
  db: DatabaseInstance,
  orgIdentifier: string,
  userId: string
): Promise<ResolvedTenant> {
  const org = await resolveOrgMembership(db, orgIdentifier, userId);
  if (!org) {
    throw new NotFoundError(`Organization "${orgIdentifier}" was not found`);
  }

  const membership = org.membership;
  if (!membership) {
    throw new ForbiddenError(`You do not have access to organization "${org.orgSlug}"`);
  }

  return {
    orgId: org.orgId,
    orgSlug: org.orgSlug,
    orgName: membership.orgName,
    role: membership.role,
    sessionEpoch: membership.sessionEpoch,
  };
}
