import { type DatabaseInstance, getOrganizationByIdOrSlug, getMembershipContext } from '@workspace/db';
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
  const org = await getOrganizationByIdOrSlug(db, orgIdentifier);
  if (!org) {
    throw new NotFoundError(`Organization "${orgIdentifier}" was not found`);
  }

  const membership = await getMembershipContext(db, org.id, userId);
  if (!membership) {
    throw new ForbiddenError(`You do not have access to organization "${org.slug}"`);
  }

  return {
    orgId: org.id,
    orgSlug: org.slug,
    orgName: org.name,
    role: membership.role as OrgRole,
    sessionEpoch: membership.sessionEpoch,
  };
}
