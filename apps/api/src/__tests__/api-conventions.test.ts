import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parseConfig,
  signInternalApiRequest,
} from '@workspace/core';
import { buildServer, type ServerInstance } from '../server.js';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  type DatabaseInstance,
  type Sql,
} from '@workspace/db';

describe('Stage 5 Shared API Conventions, Concurrency, Idempotency & Outbox Test Suite', () => {
  const secret = 'test-origin-verify-secret-token-16-chars';
  const testConfig = parseConfig({
    DATABASE_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    DATABASE_DIRECT_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    ORIGIN_VERIFY_SECRET: secret,
    PORT: 8092,
    QUEUE_PROVIDER: 'in_memory',
    REALTIME_PROVIDER: 'in_memory',
    LLM_PROVIDER: 'mock',
    STORAGE_PROVIDER: 'in_memory',
    AUTH_PROVIDER: 'mock',
  });

  let server: ServerInstance;
  let db: DatabaseInstance;
  let sql: Sql;

  let ownerUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let outsiderUser: { id: string; email: string };
  let testOrg: { id: string; slug: string };

  beforeAll(async () => {
    server = buildServer(testConfig);
    db = server.db;
    sql = server.sql;

    // Seed test users
    const owner = await findOrCreateUserByEmail(db, { email: 'stage5-owner@example.com', name: 'Stage 5 Owner' });
    ownerUser = { id: owner.id, email: owner.email };

    const member = await findOrCreateUserByEmail(db, { email: 'stage5-member@example.com', name: 'Stage 5 Member' });
    memberUser = { id: member.id, email: member.email };

    const outsider = await findOrCreateUserByEmail(db, { email: 'stage5-outsider@example.com', name: 'Stage 5 Outsider' });
    outsiderUser = { id: outsider.id, email: outsider.email };

    // Create test organization
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Stage 5 Conventions Org',
      slug: `stage5-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    // Add member to org
    await sql`
      INSERT INTO memberships (org_id, user_id, role, session_epoch)
      VALUES (${testOrg.id}, ${memberUser.id}, 'member', 1)
    `;
  });

  afterAll(async () => {
    if (testOrg) {
      await sql`DELETE FROM orgs WHERE id = ${testOrg.id}`;
    }
    await sql`DELETE FROM users WHERE email LIKE 'stage5-%'`;
    await server.close();
  });

  function createAuthHeaders(userId: string, email: string, timestamp = Date.now()) {
    const signature = signInternalApiRequest({ userId, email, timestamp }, secret);
    return {
      'x-workspace-user-id': userId,
      'x-workspace-user-email': email,
      'x-workspace-timestamp': timestamp.toString(),
      'x-workspace-signature': signature,
    };
  }

  describe('RFC 9457 Problem Details and Error Responses', () => {
    it('returns application/problem+json with code UNAUTHORIZED on missing credentials', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.id}/members`,
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain('application/problem+json');

      const body = JSON.parse(response.payload);
      expect(body.status).toBe(401);
      expect(body.title).toContain('Authentication');
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.type).toContain('/errors/unauthorized');
      expect(body.instance).toBe(`/api/v1/orgs/${testOrg.id}/members`);
    });

    it('returns application/problem+json with code NOT_FOUND on nonexistent organization', async () => {
      const nonexistentOrg = '00000000-0000-7000-8000-000000000000';
      const response = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${nonexistentOrg}/members`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');

      const body = JSON.parse(response.payload);
      expect(body.status).toBe(404);
      expect(body.code).toBe('NOT_FOUND');
      expect(body.title).toContain('not found');
      expect(body.detail).toContain('not found');
    });

    it('returns application/problem+json with code FORBIDDEN when user lacks membership', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.id}/members`,
        headers: createAuthHeaders(outsiderUser.id, outsiderUser.email),
      });

      expect(response.statusCode).toBe(403);
      expect(response.headers['content-type']).toContain('application/problem+json');

      const body = JSON.parse(response.payload);
      expect(body.status).toBe(403);
      expect(body.code).toBe('FORBIDDEN');
    });

    it('returns application/problem+json with code VALIDATION_ERROR and invalidParams on malformed input', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.id}/invitations`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          email: 'not-an-email',
          role: 'invalid_role',
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.headers['content-type']).toContain('application/problem+json');

      const body = JSON.parse(response.payload);
      expect(body.status).toBe(422);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.invalidParams).toBeDefined();
    });
  });

  describe('OpenAPI 3.1 Specification and Documentation', () => {
    it('serves valid OpenAPI 3.1 spec on /documentation/json', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/documentation/json',
      });

      expect(response.statusCode).toBe(200);
      const spec = JSON.parse(response.payload);
      expect(spec.openapi).toBe('3.1.0');
      expect(spec.info.title).toBe('Workspace v1 API');
      expect(spec.paths).toBeDefined();
    });
  });

  describe('Optimistic Concurrency Control (OCC) with ETag and If-Match', () => {
    it('returns ETag on resource read and handles conditional updates correctly', async () => {
      // 1. Initial GET returns ETag
      const getRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.id}/concurrency-resource`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(getRes.statusCode).toBe(200);
      const etag = getRes.headers['etag'] as string;
      expect(etag).toBeDefined();
      expect(etag).toBe('"v1"');

      // 2. PATCH without If-Match returns 428 Precondition Required
      const noMatchRes = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.id}/concurrency-resource`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { name: 'unconditional update' },
      });

      expect(noMatchRes.statusCode).toBe(428);
      const noMatchBody = JSON.parse(noMatchRes.payload);
      expect(noMatchBody.code).toBe('PRECONDITION_REQUIRED');

      // 2b. PATCH with weak If-Match returns 412 Precondition Failed (weak tags fail strong comparison)
      const weakMatchRes = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.id}/concurrency-resource`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': 'W/"v1"',
        },
        payload: { name: 'weak tag update' },
      });

      expect(weakMatchRes.statusCode).toBe(412);
      const weakMatchBody = JSON.parse(weakMatchRes.payload);
      expect(weakMatchBody.code).toBe('PRECONDITION_FAILED');

      // 3. PATCH with stale strong If-Match returns 412 Precondition Failed with current state
      const staleRes = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.id}/concurrency-resource`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': '"v99"',
        },
        payload: { name: 'stale update' },
      });

      expect(staleRes.statusCode).toBe(412);
      const staleBody = JSON.parse(staleRes.payload);
      expect(staleBody.code).toBe('PRECONDITION_FAILED');
      expect(staleBody.currentEntity).toBeDefined();
      expect(staleBody.currentEntity.version).toBe(1);

      // 4. PATCH with matching strong If-Match succeeds and returns updated strong ETag
      const matchRes = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.id}/concurrency-resource`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': '"v1"',
        },
        payload: { name: 'version-2-update' },
      });

      expect(matchRes.statusCode).toBe(200);
      expect(matchRes.headers['etag']).toBe('"v2"');
      const matchBody = JSON.parse(matchRes.payload);
      expect(matchBody.version).toBe(2);
      expect(matchBody.name).toBe('version-2-update');
    });
  });

  describe('PostgreSQL Idempotency Management', () => {
    it('executes mutation, caches response, and replays on repeated identical Idempotency-Key', async () => {
      const idempotencyKey = `idemp-key-${Date.now()}`;
      const payload = { name: 'resource-alpha', count: 42 };

      // 1. Initial execution
      const res1 = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.id}/idempotency-test`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'idempotency-key': idempotencyKey,
        },
        payload,
      });

      expect(res1.statusCode).toBe(201);
      expect(res1.headers['x-idempotent-replayed']).toBeUndefined();
      const body1 = JSON.parse(res1.payload);
      expect(body1.createdId).toBeDefined();
      expect(body1.name).toBe('resource-alpha');
      expect(body1.count).toBe(42);

      // 2. Replay with identical key and payload returns cached response
      const res2 = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.id}/idempotency-test`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'idempotency-key': idempotencyKey,
        },
        payload,
      });

      expect(res2.statusCode).toBe(201);
      expect(res2.headers['x-idempotent-replayed']).toBe('true');
      const body2 = JSON.parse(res2.payload);
      expect(body2.createdId).toBe(body1.createdId);
      expect(body2.processedAt).toBe(body1.processedAt);

      // 3. Request with same key but DIFFERENT payload returns 422 fingerprint mismatch
      const res3 = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.id}/idempotency-test`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'idempotency-key': idempotencyKey,
        },
        payload: { name: 'resource-different', count: 999 },
      });

      expect(res3.statusCode).toBe(422);
      const body3 = JSON.parse(res3.payload);
      expect(body3.code).toBe('VALIDATION_ERROR');
      expect(body3.detail).toContain('different request payload');

      // 4. Verification that replay re-evaluates authorization
      const res4 = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.id}/idempotency-test`,
        headers: {
          ...createAuthHeaders(outsiderUser.id, outsiderUser.email),
          'idempotency-key': idempotencyKey,
        },
        payload,
      });

      expect(res4.statusCode).toBe(403);
    });
  });

  describe('Cursor Pagination and updatedSince Filtering', () => {
    it('paginates members list with opaque cursors and pageInfo', async () => {
      // 1. Fetch first page with limit=1
      const resPage1 = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.id}/members?limit=1`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(resPage1.statusCode).toBe(200);
      const data1 = JSON.parse(resPage1.payload);
      expect(data1.members).toHaveLength(1);
      expect(data1.pageInfo.hasNextPage).toBe(true);
      expect(data1.pageInfo.endCursor).toBeDefined();

      // 2. Fetch second page using endCursor
      const nextCursor = data1.pageInfo.endCursor;
      const resPage2 = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.id}/members?limit=1&cursor=${encodeURIComponent(nextCursor)}`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(resPage2.statusCode).toBe(200);
      const data2 = JSON.parse(resPage2.payload);
      expect(data2.members).toHaveLength(1);
      expect(data2.members[0].userId).not.toBe(data1.members[0].userId);

      // 3. Limit exceeding maximum 100 is rejected
      const overLimitRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.id}/members?limit=105`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });
      expect(overLimitRes.statusCode).toBe(422);

      // 4. Invalid cursor is rejected with RFC 9457 error
      const badCursorRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.id}/members?cursor=not-a-valid-cursor`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });
      expect(badCursorRes.statusCode).toBe(422);
    });

    it('filters member results using updatedSince parameter', async () => {
      // Filter with future timestamp returns empty list
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const resFuture = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.id}/members?updatedSince=${encodeURIComponent(futureDate)}`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(resFuture.statusCode).toBe(200);
      const futureData = JSON.parse(resFuture.payload);
      expect(futureData.members).toHaveLength(0);

      // Filter with past timestamp returns all members
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const resPast = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.id}/members?updatedSince=${encodeURIComponent(pastDate)}`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(resPast.statusCode).toBe(200);
      const pastData = JSON.parse(resPast.payload);
      expect(pastData.members.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Request Tracking and Sensitive Logging Redaction', () => {
    it('echoes or generates UUIDv7 request ID on x-request-id header', async () => {
      const customId = 'req-trace-custom-uuid-12345';
      const response = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.id}/members`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'x-request-id': customId,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-request-id']).toBe(customId);
    });
  });
});
