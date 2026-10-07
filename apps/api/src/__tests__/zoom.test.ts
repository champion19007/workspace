import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parseConfig,
  signInternalApiRequest,
  ZOOM_REQUIRED_SCOPES,
} from '@workspace/core';
import { buildServer, type ServerInstance } from '../server.js';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  getOrRefreshZoomCredentials,
  type DatabaseInstance,
  type Sql,
} from '@workspace/db';
import { MockZoomClientAdapter } from '@workspace/adapters';

describe('Stage 11: Zoom Account Connection, Credential Lifecycle, and Host Opt-In (Requirement M-1)', () => {
  const secret = 'test-origin-verify-secret-token-16-chars';
  const testConfig = parseConfig({
    DATABASE_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    DATABASE_DIRECT_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    ORIGIN_VERIFY_SECRET: secret,
    PORT: 8096,
    QUEUE_PROVIDER: 'in_memory',
    REALTIME_PROVIDER: 'in_memory',
    LLM_PROVIDER: 'mock',
    STORAGE_PROVIDER: 'in_memory',
    AUTH_PROVIDER: 'mock',
    SECRET_STORE_PROVIDER: 'in_memory',
    ZOOM_CLIENT_PROVIDER: 'mock',
  });

  let server: ServerInstance;
  let db: DatabaseInstance;
  let sql: Sql;

  let ownerUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let viewerUser: { id: string; email: string };
  let outsiderUser: { id: string; email: string };

  let testOrg: { id: string; slug: string };
  let otherOrg: { id: string; slug: string };

  beforeAll(async () => {
    server = buildServer(testConfig);
    db = server.db;
    sql = server.sql;

    // 1. Seed users
    const owner = await findOrCreateUserByEmail(db, { email: 'stage11-owner@example.com', name: 'Stage 11 Owner' });
    ownerUser = { id: owner.id, email: owner.email };

    const member = await findOrCreateUserByEmail(db, { email: 'stage11-member@example.com', name: 'Stage 11 Member' });
    memberUser = { id: member.id, email: member.email };

    const viewer = await findOrCreateUserByEmail(db, { email: 'stage11-viewer@example.com', name: 'Stage 11 Viewer' });
    viewerUser = { id: viewer.id, email: viewer.email };

    const outsider = await findOrCreateUserByEmail(db, { email: 'stage11-outsider@example.com', name: 'Stage 11 Outsider' });
    outsiderUser = { id: outsider.id, email: outsider.email };

    // 2. Primary organization
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Stage 11 Primary Org',
      slug: `stage11-primary-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    // Add member and viewer memberships
    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${testOrg.id}, ${memberUser.id}, 'member'),
             (${testOrg.id}, ${viewerUser.id}, 'viewer')
    `;

    // 3. Secondary organization (for multi-tenant collision tests)
    const { org: secondaryOrg } = await createOrganizationWithOwner(db, {
      name: 'Stage 11 Colliding Org',
      slug: `stage11-colliding-org-${Date.now()}`,
      userId: outsiderUser.id,
    });
    otherOrg = { id: secondaryOrg.id, slug: secondaryOrg.slug };
  }, 30000);

  afterAll(async () => {
    if (testOrg) {
      await sql`DELETE FROM orgs WHERE id = ${testOrg.id}`;
    }
    if (otherOrg) {
      await sql`DELETE FROM orgs WHERE id = ${otherOrg.id}`;
    }
    await sql`DELETE FROM users WHERE email LIKE 'stage11-%'`;
    await server.close();
  }, 30000);

  function createAuthHeaders(userId: string, email: string, timestamp = Date.now()) {
    const signature = signInternalApiRequest({ userId, email, timestamp }, secret);
    return {
      'x-workspace-user-id': userId,
      'x-workspace-user-email': email,
      'x-workspace-timestamp': timestamp.toString(),
      'x-workspace-signature': signature,
    };
  }

  describe('1. Initial Integration Query & Authorization Initiation', () => {
    it('returns null integration status before any connection is made', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/integrations/zoom`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.integration).toBeNull();
    });

    it('rejects connection initiation from non-admin / non-owner members with 403', async () => {
      const memberRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/integrations/zoom/authorize`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
        payload: {},
      });
      expect(memberRes.statusCode).toBe(403);

      const viewerRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/integrations/zoom/authorize`,
        headers: createAuthHeaders(viewerUser.id, viewerUser.email),
        payload: {},
      });
      expect(viewerRes.statusCode).toBe(403);
    });

    it('allows owner to initiate connection, generating single-use PKCE state and official Zoom auth URL', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/integrations/zoom/authorize`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          redirectUri: 'https://app.workspace.test/api/integrations/zoom/callback',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.state).toBeDefined();
      expect(body.authorizationUrl).toContain('https://zoom.us/oauth/authorize');
      expect(body.authorizationUrl).toContain(`state=${body.state}`);
      expect(body.authorizationUrl).toContain('code_challenge=');
      expect(body.authorizationUrl).toContain('code_challenge_method=S256');

      // Verify all required granular scopes are in the URL
      for (const scope of ZOOM_REQUIRED_SCOPES) {
        expect(decodeURIComponent(body.authorizationUrl)).toContain(scope);
      }
    });
  });

  describe('2. OAuth Callback, Secret Store Isolation & Single-Use State', () => {
    let validState: string;

    beforeAll(async () => {
      // Initiate a valid auth request to capture state
      const initRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/integrations/zoom/authorize`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {},
      });
      const body = JSON.parse(initRes.payload);
      validState = body.state;
    });

    it('rejects callback with invalid or unknown state parameter with 422', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/integrations/zoom/callback`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          code: 'valid_mock_code',
          state: 'non_existent_or_forged_state',
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.payload);
      expect(body.detail).toContain('Invalid or already-consumed OAuth state');
    });

    it('completes callback successfully, storing tokens in Secret Store and syncing hosts', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/integrations/zoom/callback`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          code: 'valid_mock_code',
          state: validState,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.integration).toBeDefined();
      expect(body.integration.status).toBe('connected');
      expect(body.integration.accountId).toBe('zoom_act_test_123');
      expect(body.integration.connectionGeneration).toBe(1);
      expect(body.integration.installedBy).toBe(ownerUser.id);

      // Verify ZERO token fields returned or stored in integrations table
      expect(body.integration.accessToken).toBeUndefined();
      expect(body.integration.refreshToken).toBeUndefined();

      // Verify secret was stored in the secretStore port by inspecting direct DB row
      const [dbRow] = await sql<Array<{ secret_arn: string }>>`
        SELECT secret_arn FROM integrations WHERE org_id = ${testOrg.id} AND provider = 'zoom'
      `;
      expect(dbRow?.secret_arn).toMatch(/^arn:workspace:secret:local:zoom:/);

      // Verify secret payload exists in the secret store port
      const storedSecret = await server.ports.secretStore.getSecret(dbRow!.secret_arn);
      expect(storedSecret).not.toBeNull();
      expect(storedSecret?.accessToken).toMatch(/^mock_zoom_access_token_/);
      expect(storedSecret?.refreshToken).toMatch(/^mock_zoom_refresh_token_/);

      // Verify outbox event was recorded
      const outboxEvents = await sql<Array<{ topic: string }>>`
        SELECT topic FROM outbox
        WHERE org_id = ${testOrg.id} AND topic = 'integration.zoom.connected'
      `;
      expect(outboxEvents.length).toBeGreaterThan(0);
    });

    it('replaying the exact same state parameter fails (guaranteeing single-use protection)', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/integrations/zoom/callback`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          code: 'valid_mock_code',
          state: validState,
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.payload);
      expect(body.detail).toContain('Invalid or already-consumed OAuth state');
    });
  });

  describe('3. Multi-Tenant Isolation & Account Collision Prevention', () => {
    it('rejects attempt to link the same Zoom account to a second workspace organization with 409', async () => {
      // 1. Authorize for second org
      const authRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${otherOrg.slug}/integrations/zoom/authorize`,
        headers: createAuthHeaders(outsiderUser.id, outsiderUser.email),
        payload: {},
      });
      expect(authRes.statusCode).toBe(200);
      const otherState = JSON.parse(authRes.payload).state;

      // 2. Mock client returns the same account_id ('zoom_act_test_123')
      // Try callback on second org
      const callbackRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${otherOrg.slug}/integrations/zoom/callback`,
        headers: createAuthHeaders(outsiderUser.id, outsiderUser.email),
        payload: {
          code: 'valid_mock_code',
          state: otherState,
        },
      });

      expect(callbackRes.statusCode).toBe(409);
      const body = JSON.parse(callbackRes.payload);
      expect(body.detail).toContain('already connected to another organization');
    });
  });

  describe('4. Host Opt-In & Admin Consent Management', () => {
    it('lists discovered account hosts with initial unknown consent status', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/integrations/zoom/hosts`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(Array.isArray(body.hosts)).toBe(true);
      expect(body.hosts.length).toBeGreaterThan(0);

      const ownerHost = body.hosts.find((h: { zoomUserId: string }) => h.zoomUserId === 'zoom_usr_owner_123');
      expect(ownerHost).toBeDefined();
      expect(ownerHost.consentStatus).toBe('unknown');
      expect(ownerHost.adminDisabled).toBe(false);
    });

    it('rejects viewer attempts to toggle adminDisabled with 403', async () => {
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/integrations/zoom/hosts/zoom_usr_owner_123`,
        headers: createAuthHeaders(viewerUser.id, viewerUser.email),
        payload: {
          adminDisabled: true,
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('allows admin/owner to grant opt-in consent and toggle adminDisabled', async () => {
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/integrations/zoom/hosts/zoom_usr_owner_123`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          consentStatus: 'opted_in',
          adminDisabled: false,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.host.consentStatus).toBe('opted_in');
      expect(body.host.consentTimestamp).toBeDefined();
      expect(body.host.adminDisabled).toBe(false);
    });
  });

  describe('5. Credential Refresh Coordinator & Generation Fencing', () => {
    it('returns valid credentials directly when token has > 5 minutes remaining', async () => {
      const creds = await getOrRefreshZoomCredentials(
        sql,
        server.ports.secretStore,
        server.ports.zoomClient,
        testOrg.id
      );

      expect(creds.accessToken).toMatch(/^mock_zoom_access_token_/);
      expect(creds.accountId).toBe('zoom_act_test_123');
    });

    it('refreshes near-expiry token, updating Secret Store and recording outbox event', async () => {
      // 1. Artificially age the secret in Secret Store so it expires in 60 seconds (< 300s threshold)
      const [integration] = await sql<Array<{ secret_arn: string }>>`
        SELECT secret_arn FROM integrations WHERE org_id = ${testOrg.id} AND provider = 'zoom'
      `;
      const secret = await server.ports.secretStore.getSecret(integration!.secret_arn);
      expect(secret).not.toBeNull();

      secret!.expiresAt = new Date(Date.now() + 60 * 1000).toISOString();
      const { secretArn: agedArn } = await server.ports.secretStore.storeSecret(`zoom:${testOrg.id}`, secret!);
      await sql`UPDATE integrations SET secret_arn = ${agedArn} WHERE org_id = ${testOrg.id} AND provider = 'zoom'`;

      // 2. Call getOrRefreshZoomCredentials
      const creds = await getOrRefreshZoomCredentials(
        sql,
        server.ports.secretStore,
        server.ports.zoomClient,
        testOrg.id
      );

      // Verify token rotated
      expect(creds.accessToken).toContain('rotated');

      // Verify outbox recorded refreshed event
      const refreshEvents = await sql<Array<{ topic: string }>>`
        SELECT topic FROM outbox
        WHERE org_id = ${testOrg.id} AND topic = 'integration.zoom.refreshed'
      `;
      expect(refreshEvents.length).toBeGreaterThan(0);
    });

    it('transitions to needs_reauthorization and emits degraded event when refresh token is revoked', async () => {
      // 1. Manually set mock client to simulate invalid_grant on refresh
      (server.ports.zoomClient as MockZoomClientAdapter).simulateInvalidGrant = true;

      // 2. Age the secret so refresh is triggered
      const [integration] = await sql<Array<{ secret_arn: string }>>`
        SELECT secret_arn FROM integrations WHERE org_id = ${testOrg.id} AND provider = 'zoom'
      `;
      const secret = await server.ports.secretStore.getSecret(integration!.secret_arn);
      secret!.expiresAt = new Date(Date.now() + 30 * 1000).toISOString();
      const { secretArn: agedArn } = await server.ports.secretStore.storeSecret(`zoom:${testOrg.id}`, secret!);
      await sql`UPDATE integrations SET secret_arn = ${agedArn} WHERE org_id = ${testOrg.id} AND provider = 'zoom'`;

      // 3. Attempt refresh -> should catch and degrade gracefully
      await expect(
        getOrRefreshZoomCredentials(
          sql,
          server.ports.secretStore,
          server.ports.zoomClient,
          testOrg.id
        )
      ).rejects.toThrow('reauthorization required');

      // 4. Verify integration status in DB is now needs_reauthorization
      const [updated] = await sql<Array<{ status: string; last_error_category: string }>>`
        SELECT status, last_error_category FROM integrations WHERE org_id = ${testOrg.id} AND provider = 'zoom'
      `;
      expect(updated?.status).toBe('needs_reauthorization');
      expect(updated?.last_error_category).toBe('token_revoked');

      // Verify outbox emitted degraded event
      const degradedEvents = await sql<Array<{ topic: string }>>`
        SELECT topic FROM outbox
        WHERE org_id = ${testOrg.id} AND topic = 'integration.zoom.degraded'
      `;
      expect(degradedEvents.length).toBeGreaterThan(0);

      // Restore simulated flag
      (server.ports.zoomClient as MockZoomClientAdapter).simulateInvalidGrant = false;
    });
  });

  describe('6. Disconnect Lifecycle & Secret Purge', () => {
    it('rejects disconnect from non-admin with 403', async () => {
      const res = await server.app.inject({
        method: 'DELETE',
        url: `/api/v1/orgs/${testOrg.slug}/integrations/zoom`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });

      expect(res.statusCode).toBe(403);
    });

    it('allows owner to disconnect: marks status disconnected, bumps generation, and immediately purges secret', async () => {
      const [beforeRow] = await sql<Array<{ secret_arn: string; connection_generation: number }>>`
        SELECT secret_arn, connection_generation FROM integrations WHERE org_id = ${testOrg.id} AND provider = 'zoom'
      `;
      const secretArn = beforeRow!.secret_arn;
      const initialGen = beforeRow!.connection_generation;

      const res = await server.app.inject({
        method: 'DELETE',
        url: `/api/v1/orgs/${testOrg.slug}/integrations/zoom`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.integration.status).toBe('disconnected');
      expect(body.integration.connectionGeneration).toBe(initialGen + 1);

      // Verify secret was completely purged from the secret store
      const secretAfter = await server.ports.secretStore.getSecret(secretArn);
      expect(secretAfter).toBeNull();

      // Verify outbox emitted disconnected event
      const disconnectEvents = await sql<Array<{ topic: string }>>`
        SELECT topic FROM outbox
        WHERE org_id = ${testOrg.id} AND topic = 'integration.zoom.disconnected'
      `;
      expect(disconnectEvents.length).toBeGreaterThan(0);

      // Verify subsequent getOrRefresh throws disconnected error
      await expect(
        getOrRefreshZoomCredentials(
          sql,
          server.ports.secretStore,
          server.ports.zoomClient,
          testOrg.id
        )
      ).rejects.toThrow('disconnected');
    });
  });
});
