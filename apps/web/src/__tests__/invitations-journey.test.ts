import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { createSessionPayload, hashToken, type OrgRole } from '@workspace/core';
import { createOrganizationWithOwner, findOrCreateUserByEmail } from '@workspace/db';
import { SESSION_COOKIE_NAME, serializeSession } from '../lib/session';
import { getServerContext } from '../lib/server-context';
import { POST as inviteBFF } from '../app/api/orgs/[orgId]/invitations/route';
import { GET as membersBFF } from '../app/api/orgs/[orgId]/members/route';
import { PATCH as updateRoleBFF, DELETE as removeBFF } from '../app/api/orgs/[orgId]/members/[userId]/route';
import { POST as acceptBFF } from '../app/api/invitations/accept/route';

/**
 * Team management on a web-only (Vercel) deployment: the BFF invites, the invitee accepts with the link, and
 * owners/admins change roles and remove people, through the same @workspace/db operations as the Fastify API.
 */
describe('Web BFF Journey: invite, accept, change role, remove', () => {
  const SECRET = 'a-super-secret-key-that-is-at-least-32-chars-long!';
  const ts = Date.now();

  type U = { id: string; email: string; cookie: string };
  let owner: U, admin: U, member: U, viewer: U, invitee: U;
  let org: { id: string; slug: string };
  let rawToken: string;

  const req = (path: string, u: U | null, method = 'GET', body?: unknown) =>
    new NextRequest(`http://localhost${path}`, {
      method,
      headers: { ...(u ? { cookie: `${SESSION_COOKIE_NAME}=${u.cookie}` } : {}), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const invite = (u: U | null, body: unknown) =>
    inviteBFF(req(`/api/orgs/${org.slug}/invitations`, u, 'POST', body), { params: Promise.resolve({ orgId: org.slug }) });
  const accept = (u: U, token: string) => acceptBFF(req('/api/invitations/accept', u, 'POST', { token }));
  const listMembers = (u: U) =>
    membersBFF(req(`/api/orgs/${org.slug}/members`, u), { params: Promise.resolve({ orgId: org.slug }) });
  const setRole = (u: U, targetId: string, role: OrgRole) =>
    updateRoleBFF(req(`/api/orgs/${org.slug}/members/${targetId}`, u, 'PATCH', { role }), {
      params: Promise.resolve({ orgId: org.slug, userId: targetId }),
    });
  const remove = (u: U, targetId: string) =>
    removeBFF(req(`/api/orgs/${org.slug}/members/${targetId}`, u, 'DELETE'), {
      params: Promise.resolve({ orgId: org.slug, userId: targetId }),
    });
  const roleOf = async (u: U) => {
    const { members } = (await (await listMembers(owner)).json()) as { members: Array<{ id: string; role: string }> };
    return members.find((m) => m.id === u.id)?.role ?? null;
  };

  beforeAll(async () => {
    process.env.SESSION_SECRET = SECRET;
    process.env.ORIGIN_VERIFY_SECRET = SECRET;
    const { db, sql } = getServerContext();

    const mk = async (tag: string): Promise<U> => {
      const u = await findOrCreateUserByEmail(db, { email: `web-inv-${tag}-${ts}@example.com`, name: `Inv ${tag}` });
      return { id: u.id, email: u.email, cookie: '' };
    };
    owner = await mk('owner');
    admin = await mk('admin');
    member = await mk('member');
    viewer = await mk('viewer');
    invitee = await mk('invitee');

    ({ org } = await createOrganizationWithOwner(db, { name: 'Web Invitations Org', slug: `web-inv-${ts}`, userId: owner.id }));
    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${org.id}, ${admin.id}, 'admin'), (${org.id}, ${member.id}, 'member'), (${org.id}, ${viewer.id}, 'viewer')
    `;

    const signIn = (u: U, role: OrgRole | null) => {
      u.cookie = serializeSession(
        createSessionPayload({ userId: u.id, email: u.email, activeOrgId: role ? org.id : null, role, sessionEpoch: 1 })
      );
    };
    signIn(owner, 'owner');
    signIn(admin, 'admin');
    signIn(member, 'member');
    signIn(viewer, 'viewer');
    signIn(invitee, null); // signed in, no organization yet
  });

  afterAll(async () => {
    const { sql } = getServerContext();
    if (org) await sql`DELETE FROM orgs WHERE id = ${org.id}`;
  });

  it('rejects an invitation without a session', async () => {
    expect((await invite(null, { email: invitee.email })).status).toBe(401);
  });

  it('only lets owners and admins invite, and admins only as member or viewer', async () => {
    for (const u of [member, viewer]) {
      const res = await invite(u, { email: invitee.email, role: 'viewer' });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe('FORBIDDEN');
    }
    expect((await invite(admin, { email: invitee.email, role: 'owner' })).status).toBe(403);
    expect((await invite(admin, { email: member.email })).status).toBe(409); // already a member
    expect((await invite(admin, { email: 'not-an-email' })).status).toBe(422);
  });

  it('invites by email; only the invited account can join with the link, once', async () => {
    const res = await invite(admin, { email: invitee.email.toUpperCase(), role: 'member' });
    expect(res.status).toBe(201);
    const { invitation } = await res.json();
    expect(invitation).toMatchObject({ email: invitee.email, role: 'member' });
    rawToken = invitation.rawToken;

    const { sql } = getServerContext();
    const [row] = await sql<{ token: string }[]>`SELECT token FROM invitations WHERE id = ${invitation.id}`;
    expect(row!.token).toBe(hashToken(rawToken)); // only the hash is stored

    expect((await accept(viewer, rawToken)).status).toBe(401); // issued for another email

    const accepted = await accept(invitee, rawToken);
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).org.id).toBe(org.id);
    invitee.cookie = accepted.cookies.get(SESSION_COOKIE_NAME)!.value; // session rotated into the org
    expect(await roleOf(invitee)).toBe('member');
    expect((await listMembers(invitee)).status).toBe(200);

    expect((await accept(invitee, rawToken)).status).toBe(409);
  });

  it('lets owners and admins change roles within the role rules', async () => {
    expect((await setRole(member, viewer.id, 'member')).status).toBe(403);
    expect((await setRole(viewer, invitee.id, 'viewer')).status).toBe(403);
    expect((await setRole(admin, owner.id, 'member')).status).toBe(403);

    const toViewer = await setRole(admin, invitee.id, 'viewer');
    expect(toViewer.status).toBe(200);
    expect((await toViewer.json()).membership.role).toBe('viewer');
    expect((await setRole(owner, invitee.id, 'admin')).status).toBe(200);
    expect(await roleOf(invitee)).toBe('admin');

    expect((await setRole(admin, invitee.id, 'member')).status).toBe(403); // admins can't change other admins
    expect((await setRole(owner, invitee.id, 'superuser' as OrgRole)).status).toBe(422);
    expect((await setRole(owner, 'not-a-user-id', 'member')).status).toBe(404);
  });

  it('lets owners and admins remove people; removal takes effect on the next request', async () => {
    expect((await remove(member, viewer.id)).status).toBe(403);
    expect((await remove(viewer, member.id)).status).toBe(403);
    expect((await remove(admin, invitee.id)).status).toBe(403); // invitee is an admin now

    expect((await remove(owner, invitee.id)).status).toBe(200);
    expect(await roleOf(invitee)).toBeNull();
    expect((await listMembers(invitee)).status).toBe(403); // even though the session still names this org

    expect((await remove(admin, viewer.id)).status).toBe(200);
    expect(await roleOf(viewer)).toBeNull();
  });
});
