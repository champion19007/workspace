import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parseConfig,
  signInternalApiRequest,
} from '@workspace/core';
import { buildServer, type ServerInstance } from '../server.js';
import { findOrCreateUserByEmail } from '@workspace/db';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@workspace/db';

describe('Fastify API Authentication, Onboarding & RBAC Integration Tests', () => {
  const secret = 'test-origin-verify-secret-token-16-chars';
  const testConfig = parseConfig({
    DATABASE_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    DATABASE_DIRECT_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    ORIGIN_VERIFY_SECRET: secret,
    PORT: 8091,
    QUEUE_PROVIDER: 'in_memory',
    REALTIME_PROVIDER: 'in_memory',
    LLM_PROVIDER: 'mock',
    STORAGE_PROVIDER: 'in_memory',
    AUTH_PROVIDER: 'mock',
  });

  let server: ServerInstance;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    server = buildServer(testConfig);
    db = drizzle(server.sql, { schema });
  });

  afterAll(async () => {
    await server.close();
  });

  function createAuthHeaders(userId: string, email: string, timestamp = Date.now(), sessionEpoch?: number) {
    const signature = signInternalApiRequest({ userId, email, timestamp }, secret);
    const headers: Record<string, string> = {
      'x-workspace-user-id': userId,
      'x-workspace-user-email': email,
      'x-workspace-timestamp': timestamp.toString(),
      'x-workspace-signature': signature,
    };
    if (sessionEpoch !== undefined) {
      headers['x-workspace-session-epoch'] = sessionEpoch.toString();
    }
    return headers;
  }

  describe('Authentication Gates & Spoofing Defense', () => {
    it('rejects requests without authentication credentials with 401', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/v1/orgs',
        payload: { name: 'Acme', slug: 'acme' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('rejects forged headers with invalid HMAC signature with 401', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/v1/orgs',
        headers: {
          'x-workspace-user-id': '018f3a55-0000-7000-8000-000000000001',
          'x-workspace-user-email': 'attacker@example.com',
          'x-workspace-timestamp': Date.now().toString(),
          'x-workspace-signature': '0000000000000000000000000000000000000000000000000000000000000000',
        },
        payload: { name: 'Acme', slug: 'acme' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('rejects replayed requests with timestamp older than 300 seconds', async () => {
      const oldTimestamp = Date.now() - 400 * 1000;
      const headers = createAuthHeaders('018f3a55-0000-7000-8000-000000000001', 'user@workspace.dev', oldTimestamp);

      const response = await server.app.inject({
        method: 'POST',
        url: '/api/v1/orgs',
        headers,
        payload: { name: 'Acme', slug: 'acme' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Organization Onboarding Journey', () => {
    it('allows authenticated caller to provision an organization and become Owner', async () => {
      const user = await findOrCreateUserByEmail(db, { email: `api-founder-${Date.now()}@workspace.dev` });
      const slug = `api-org-${Date.now()}`;
      const headers = createAuthHeaders(user.id, user.email);

      const response = await server.app.inject({
        method: 'POST',
        url: '/api/v1/orgs',
        headers,
        payload: {
          name: 'API Test Org',
          slug,
          plan: 'pro',
          retentionDays: 90,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.org.slug).toBe(slug);
      expect(body.org.retentionDays).toBe(90);
      expect(body.membership.role).toBe('owner');
      expect(body.membership.sessionEpoch).toBe(1);

      // Verify user orgs endpoint
      const listResponse = await server.app.inject({
        method: 'GET',
        url: '/api/v1/user/orgs',
        headers,
      });

      expect(listResponse.statusCode).toBe(200);
      const listBody = JSON.parse(listResponse.payload);
      expect(listBody.organizations.some((o: { orgSlug: string }) => o.orgSlug === slug)).toBe(true);
    });
  });

  describe('Organization Access & Multi-Tenant RBAC', () => {
    it('allows members to view org details and rejects non-members with 403', async () => {
      const owner = await findOrCreateUserByEmail(db, { email: `owner-${Date.now()}@workspace.dev` });
      const stranger = await findOrCreateUserByEmail(db, { email: `stranger-${Date.now()}@workspace.dev` });
      const slug = `private-org-${Date.now()}`;

      // Create org
      const createRes = await server.app.inject({
        method: 'POST',
        url: '/api/v1/orgs',
        headers: createAuthHeaders(owner.id, owner.email),
        payload: { name: 'Private Org', slug },
      });
      const orgId = JSON.parse(createRes.payload).org.id;

      // Owner can view details
      const ownerView = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${orgId}`,
        headers: createAuthHeaders(owner.id, owner.email),
      });
      expect(ownerView.statusCode).toBe(200);
      expect(JSON.parse(ownerView.payload).currentRole).toBe('owner');

      // Stranger gets 403 Forbidden
      const strangerView = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${orgId}`,
        headers: createAuthHeaders(stranger.id, stranger.email),
      });
      expect(strangerView.statusCode).toBe(403);
    });

    it('enforces invitation creation restrictions and email-verified acceptance', async () => {
      const owner = await findOrCreateUserByEmail(db, { email: `inv-owner-${Date.now()}@workspace.dev` });
      const inviteeEmail = `invited-${Date.now()}@workspace.dev`;
      const invitee = await findOrCreateUserByEmail(db, { email: inviteeEmail });

      const createRes = await server.app.inject({
        method: 'POST',
        url: '/api/v1/orgs',
        headers: createAuthHeaders(owner.id, owner.email),
        payload: { name: 'Invite Org', slug: `invite-slug-${Date.now()}` },
      });
      const orgId = JSON.parse(createRes.payload).org.id;

      // 1. Owner creates invitation
      const inviteRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${orgId}/invitations`,
        headers: createAuthHeaders(owner.id, owner.email),
        payload: { email: inviteeEmail, role: 'member' },
      });

      expect(inviteRes.statusCode).toBe(201);
      const inviteToken = JSON.parse(inviteRes.payload).invitation.rawToken;
      expect(inviteToken).toBeDefined();

      // 2. Invitee accepts invitation
      const acceptRes = await server.app.inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: createAuthHeaders(invitee.id, invitee.email),
        payload: { token: inviteToken },
      });

      expect(acceptRes.statusCode).toBe(200);
      expect(JSON.parse(acceptRes.payload).membership.role).toBe('member');

      // 3. Invitee now has member access
      const memberView = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${orgId}`,
        headers: createAuthHeaders(invitee.id, invitee.email),
      });
      expect(memberView.statusCode).toBe(200);
      expect(JSON.parse(memberView.payload).currentRole).toBe('member');
    });

    it('increments session_epoch on role update and rejects stale session epochs', async () => {
      const owner = await findOrCreateUserByEmail(db, { email: `epoch-owner-${Date.now()}@workspace.dev` });
      const member = await findOrCreateUserByEmail(db, { email: `epoch-member-${Date.now()}@workspace.dev` });

      const createRes = await server.app.inject({
        method: 'POST',
        url: '/api/v1/orgs',
        headers: createAuthHeaders(owner.id, owner.email),
        payload: { name: 'Epoch Org', slug: `epoch-slug-${Date.now()}` },
      });
      const orgId = JSON.parse(createRes.payload).org.id;

      // Add member directly
      await db.insert(schema.memberships).values({
        orgId,
        userId: member.id,
        role: 'member',
        sessionEpoch: 1,
      });

      // Member makes request with valid epoch 1
      const res1 = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${orgId}`,
        headers: createAuthHeaders(member.id, member.email, Date.now(), 1),
      });
      expect(res1.statusCode).toBe(200);

      // Owner promotes member to admin
      const updateRes = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${orgId}/members/${member.id}`,
        headers: createAuthHeaders(owner.id, owner.email),
        payload: { role: 'admin' },
      });
      expect(updateRes.statusCode).toBe(200);
      expect(JSON.parse(updateRes.payload).membership.sessionEpoch).toBe(2);

      // Member makes request with OLD epoch 1 -> REJECTED 401
      const res2 = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${orgId}`,
        headers: createAuthHeaders(member.id, member.email, Date.now(), 1),
      });
      expect(res2.statusCode).toBe(401);
      expect(JSON.parse(res2.payload).detail).toContain('Session has been revoked');

      // Member makes request with NEW epoch 2 -> SUCCEEDS
      const res3 = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${orgId}`,
        headers: createAuthHeaders(member.id, member.email, Date.now(), 2),
      });
      expect(res3.statusCode).toBe(200);
      expect(JSON.parse(res3.payload).currentRole).toBe('admin');
    });

    it('prevents removing or demoting the final Owner', async () => {
      const soleOwner = await findOrCreateUserByEmail(db, { email: `sole-owner-${Date.now()}@workspace.dev` });

      const createRes = await server.app.inject({
        method: 'POST',
        url: '/api/v1/orgs',
        headers: createAuthHeaders(soleOwner.id, soleOwner.email),
        payload: { name: 'Sole Owner API', slug: `sole-api-${Date.now()}` },
      });
      const orgId = JSON.parse(createRes.payload).org.id;

      // Attempt to delete sole owner fails 422
      const deleteRes = await server.app.inject({
        method: 'DELETE',
        url: `/api/v1/orgs/${orgId}/members/${soleOwner.id}`,
        headers: createAuthHeaders(soleOwner.id, soleOwner.email),
      });
      expect(deleteRes.statusCode).toBe(422);

      // Attempt to demote sole owner fails 422
      const demoteRes = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${orgId}/members/${soleOwner.id}`,
        headers: createAuthHeaders(soleOwner.id, soleOwner.email),
        payload: { role: 'admin' },
      });
      expect(demoteRes.statusCode).toBe(422);
    });
  });
});
