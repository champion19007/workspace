import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parseConfig,
  signInternalApiRequest,
  formatETag,
} from '@workspace/core';
import { buildServer, type ServerInstance } from '../server.js';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  createNode,
  createLabel,
  type DatabaseInstance,
  type Sql,
} from '@workspace/db';

describe('Stage 7 Task Management & Concurrency Test Suite (Requirement W-4)', () => {
  const secret = 'test-origin-verify-secret-token-16-chars';
  const testConfig = parseConfig({
    DATABASE_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    DATABASE_DIRECT_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    ORIGIN_VERIFY_SECRET: secret,
    PORT: 8094,
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
  let viewerUser: { id: string; email: string };
  let outsiderUser: { id: string; email: string };

  let testOrg: { id: string; slug: string };
  let otherOrg: { id: string; slug: string };

  let defaultTeamId: string;
  let defaultProjectId: string;

  beforeAll(async () => {
    server = buildServer(testConfig);
    db = server.db;
    sql = server.sql;

    // 1. Seed test users
    const owner = await findOrCreateUserByEmail(db, { email: 'stage7-owner@example.com', name: 'Stage 7 Owner' });
    ownerUser = { id: owner.id, email: owner.email };

    const member = await findOrCreateUserByEmail(db, { email: 'stage7-member@example.com', name: 'Stage 7 Member' });
    memberUser = { id: member.id, email: member.email };

    const viewer = await findOrCreateUserByEmail(db, { email: 'stage7-viewer@example.com', name: 'Stage 7 Viewer' });
    viewerUser = { id: viewer.id, email: viewer.email };

    const outsider = await findOrCreateUserByEmail(db, { email: 'stage7-outsider@example.com', name: 'Stage 7 Outsider' });
    outsiderUser = { id: outsider.id, email: outsider.email };

    // 2. Primary organization
    const { org: primaryOrg } = await createOrganizationWithOwner(db, {
      name: 'Stage 7 Task Org',
      slug: `stage7-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: primaryOrg.id, slug: primaryOrg.slug };

    // Add member & viewer to primary org
    await sql`
      INSERT INTO memberships (org_id, user_id, role, session_epoch)
      VALUES 
        (${testOrg.id}, ${memberUser.id}, 'member', 1),
        (${testOrg.id}, ${viewerUser.id}, 'viewer', 1)
      ON CONFLICT DO NOTHING
    `;

    // 3. Secondary organization (for cross-org leakage and foreign-key isolation tests)
    const { org: secondaryOrg } = await createOrganizationWithOwner(db, {
      name: 'Stage 7 Other Org',
      slug: `stage7-other-${Date.now()}`,
      userId: outsiderUser.id,
    });
    otherOrg = { id: secondaryOrg.id, slug: secondaryOrg.slug };

    // 4. Create primary team & project
    const team = await createNode(db, {
      orgId: testOrg.id,
      userId: ownerUser.id,
      role: 'owner',
      name: 'Platform Engineering',
      kind: 'team',
      parentId: null,
      visibility: 'public',
    });
    defaultTeamId = team.id;

    const project = await createNode(db, {
      orgId: testOrg.id,
      userId: ownerUser.id,
      role: 'owner',
      name: 'Core API Services',
      kind: 'project',
      parentId: defaultTeamId,
      visibility: 'public',
    });
    defaultProjectId = project.id;
  });

  afterAll(async () => {
    if (testOrg) {
      await sql`DELETE FROM orgs WHERE id = ${testOrg.id}`;
    }
    if (otherOrg) {
      await sql`DELETE FROM orgs WHERE id = ${otherOrg.id}`;
    }
    await sql`DELETE FROM users WHERE email LIKE 'stage7-%'`;
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

  describe('1. Concurrent Key Allocation & Sequence Invariants', () => {
    it('concurrently allocates unique sequential task keys without gaps or duplicates', async () => {
      // Create a dedicated project for concurrency key testing
      const concProj = await createNode(db, {
        orgId: testOrg.id,
        userId: ownerUser.id,
        role: 'owner',
        name: 'Concurrent Key Project',
        kind: 'project',
        parentId: defaultTeamId,
        visibility: 'public',
      });

      const totalConcurrent = 10;

      // Fire 10 parallel task creations
      const promises = Array.from({ length: totalConcurrent }, (_, idx) =>
        server.app.inject({
          method: 'POST',
          url: `/api/v1/orgs/${testOrg.slug}/projects/${concProj.id}/tasks`,
          headers: createAuthHeaders(ownerUser.id, ownerUser.email),
          payload: {
            title: `Concurrent Task ${idx + 1}`,
            status: 'todo',
            priority: 'medium',
          },
        })
      );

      const responses = await Promise.all(promises);

      for (const res of responses) {
        expect(res.statusCode).toBe(201);
      }

      const prefix = concProj.keyPrefix || responses[0].json().key.split('-')[0];
      const keys = responses.map((r) => r.json().key);
      // All keys must be unique
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(totalConcurrent);

      // Verify sequence starts at 1 and goes through 10
      for (let i = 1; i <= totalConcurrent; i++) {
        expect(keys).toContain(`${prefix}-${i}`);
      }

      // Archive task 3, create task 11 - number must strictly advance to 11 (never reuse)
      const task3 = responses.find((r) => r.json().key === `${prefix}-3`)!.json();
      const deleteRes = await server.app.inject({
        method: 'DELETE',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${task3.id}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': formatETag(task3.version),
        },
      });
      expect(deleteRes.statusCode).toBe(200);

      const nextRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${concProj.id}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Post Archive Task',
        },
      });
      expect(nextRes.statusCode).toBe(201);
      expect(nextRes.json().key).toBe(`${prefix}-11`);
    });
  });

  describe('2. Idempotent Task Creation', () => {
    it('returns the identical task when retried with same Idempotency-Key', async () => {
      const idempotencyKey = `idemp-task-${Date.now()}`;
      const payload = {
        title: 'Idempotent Creation Test Task',
        description: 'Should only be created once',
        status: 'todo',
        priority: 'high',
      };

      const res1 = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'idempotency-key': idempotencyKey,
        },
        payload,
      });

      expect(res1.statusCode).toBe(201);
      const data1 = res1.json();

      // Retry exact request
      const res2 = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'idempotency-key': idempotencyKey,
        },
        payload,
      });

      expect(res2.statusCode).toBe(201);
      const data2 = res2.json();

      expect(data1.id).toBe(data2.id);
      expect(data1.key).toBe(data2.key);
      expect(data1.version).toBe(data2.version);
    });
  });

  describe('3. Cross-Org Isolation & Foreign Constraint Enforcement', () => {
    it('rejects labels belonging to a different organisation (422)', async () => {
      // Create label in otherOrg
      const otherLabel = await createLabel(db, {
        orgId: otherOrg.id,
        role: 'owner',
        input: {
          name: 'Secret Tag',
          color: '#ff0000',
        },
      });

      // Attempt to use otherLabel in testOrg
      const response = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Cross Org Label Attack',
          labelIds: [otherLabel.id],
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });

    it('rejects subtask creation under parent task belonging to another organisation (422)', async () => {
      // Create project & task in otherOrg
      const otherTeam = await createNode(db, {
        orgId: otherOrg.id,
        userId: outsiderUser.id,
        role: 'owner',
        name: 'Other Team',
        kind: 'team',
        parentId: null,
      });
      const otherProj = await createNode(db, {
        orgId: otherOrg.id,
        userId: outsiderUser.id,
        role: 'owner',
        name: 'Other Proj',
        kind: 'project',
        parentId: otherTeam.id,
      });

      const otherTaskRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${otherOrg.slug}/projects/${otherProj.id}/tasks`,
        headers: createAuthHeaders(outsiderUser.id, outsiderUser.email),
        payload: { title: 'Other Org Task' },
      });
      expect(otherTaskRes.statusCode).toBe(201);
      const otherTaskId = otherTaskRes.json().id;

      // Attempt to create subtask in testOrg referencing otherTaskId
      const subtaskRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${otherTaskId}/subtasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Cross Org Subtask' },
      });

      // 1. Subtask endpoint returns 404 (zero leakage of foreign org task existence)
      expect(subtaskRes.statusCode).toBe(404);

      // 2. Direct task creation with parentTaskId referencing another org returns 422
      const directSubtaskRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Direct Cross Org Subtask',
          parentTaskId: otherTaskId,
        },
      });
      expect(directSubtaskRes.statusCode).toBe(422);
    });
  });

  describe('4. Private Project Confidentiality & Zero Information Leakage', () => {
    let privateProjectId: string;
    let privateTaskId: string;
    let privateTaskVersion: number;

    beforeAll(async () => {
      const privateProj = await createNode(db, {
        orgId: testOrg.id,
        userId: ownerUser.id,
        role: 'owner',
        name: 'Confidential M&A Project',
        kind: 'project',
        parentId: defaultTeamId,
        visibility: 'private',
      });
      privateProjectId = privateProj.id;

      // Owner creates task
      const taskRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${privateProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Draft Acquisition Agreement',
          status: 'in_progress',
          priority: 'urgent',
        },
      });
      expect(taskRes.statusCode).toBe(201);
      privateTaskId = taskRes.json().id;
      privateTaskVersion = taskRes.json().version;
    });

    it('returns 404 on GET task for non-member user (zero information leakage)', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${privateTaskId}`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });

      // Must be 404, NOT 403 (to avoid leaking existence of private resource)
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('NOT_FOUND');
    });

    it('returns 404 on PATCH task without If-Match for non-member user (does not leak 428 or 412)', async () => {
      const response = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${privateTaskId}`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
        payload: { title: 'Unauthorized Modification' },
      });

      // Must check project permission BEFORE checking If-Match, returning 404!
      expect(response.statusCode).toBe(404);
    });

    it('returns 404 on DELETE task for non-member user', async () => {
      const response = await server.app.inject({
        method: 'DELETE',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${privateTaskId}`,
        headers: {
          ...createAuthHeaders(memberUser.id, memberUser.email),
          'if-match': formatETag(privateTaskVersion),
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 on listing project tasks for non-member user', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${privateProjectId}/tasks`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('5. Role Enforcement: Viewer Cannot Mutate Tasks', () => {
    let viewerTestTaskId: string;
    let viewerTestTaskVersion: number;

    beforeAll(async () => {
      const taskRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Task For Viewer Test' },
      });
      expect(taskRes.statusCode).toBe(201);
      viewerTestTaskId = taskRes.json().id;
      viewerTestTaskVersion = taskRes.json().version;
    });

    it('allows viewer to read tasks (200)', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${viewerTestTaskId}`,
        headers: createAuthHeaders(viewerUser.id, viewerUser.email),
      });

      expect(res.statusCode).toBe(200);
    });

    it('denies viewer creating tasks (403 Forbidden)', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: createAuthHeaders(viewerUser.id, viewerUser.email),
        payload: { title: 'Viewer Illegal Creation' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });

    it('denies viewer updating tasks (403 Forbidden)', async () => {
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${viewerTestTaskId}`,
        headers: {
          ...createAuthHeaders(viewerUser.id, viewerUser.email),
          'if-match': formatETag(viewerTestTaskVersion),
        },
        payload: { title: 'Viewer Illegal Update' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });

    it('denies viewer archiving tasks (403 Forbidden)', async () => {
      const res = await server.app.inject({
        method: 'DELETE',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${viewerTestTaskId}`,
        headers: {
          ...createAuthHeaders(viewerUser.id, viewerUser.email),
          'if-match': formatETag(viewerTestTaskVersion),
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });
  });

  describe('6. Assignee Validation', () => {
    it('rejects assigning a user who is not a member of the organization (422)', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Assign Outsider Task',
          assigneeId: outsiderUser.id,
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('rejects assigning an org member who lacks access to a private project (422)', async () => {
      const privateProj = await createNode(db, {
        orgId: testOrg.id,
        userId: ownerUser.id,
        role: 'owner',
        name: 'Executive Finance',
        kind: 'project',
        parentId: defaultTeamId,
        visibility: 'private',
      });

      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${privateProj.id}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Quarterly Audit Review',
          assigneeId: memberUser.id, // memberUser is not in node_members for this private project
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });
  });

  describe('7. Date-Only Deadline Validation (Asia/Kolkata)', () => {
    it('accepts valid date-only YYYY-MM-DD deadline and preserves it cleanly', async () => {
      const validDate = '2026-11-15';
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Task With Valid Deadline',
          dueDate: validDate,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().dueDate).toBe(validDate);
    });

    it('rejects invalid calendar dates like 2026-02-30 (422)', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Invalid Leap Date Task',
          dueDate: '2026-02-30',
        },
      });

      expect(res.statusCode).toBe(422);
    });

    it('rejects ISO timestamp strings passed as due date (422)', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Timestamp Due Date Task',
          dueDate: '2026-11-15T18:30:00Z',
        },
      });

      expect(res.statusCode).toBe(422);
    });
  });

  describe('8. One-Level Subtask Invariants & Hierarchy Hierarchy Integrity', () => {
    let parentTask: any;
    let subtask: any;

    beforeAll(async () => {
      // 1. Create parent task
      const pRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Parent Epical Task' },
      });
      parentTask = pRes.json();

      // 2. Create subtask
      const cRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${parentTask.id}/subtasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'First Level Subtask' },
      });
      expect(cRes.statusCode).toBe(201);
      subtask = cRes.json();
      expect(subtask.parentTaskId).toBe(parentTask.id);
    });

    it('rejects nesting subtasks beyond one level (subtask of subtask) (422)', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${subtask.id}/subtasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Second Level Subtask (Forbidden)' },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().detail || res.json().message).toContain('One level of subtasks enforced');
    });

    it('rejects reparenting a parent task with children to become a subtask (422)', async () => {
      // Create another root task
      const otherRootRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Another Root Task' },
      });
      const otherRoot = otherRootRes.json();

      // Try to make parentTask a child of otherRoot
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${parentTask.id}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': formatETag(parentTask.version),
        },
        payload: {
          parentTaskId: otherRoot.id,
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().detail || res.json().message).toContain('Cannot convert a parent task with subtasks into a subtask');
    });

    it('rejects self-parenting (422)', async () => {
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${parentTask.id}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': formatETag(parentTask.version),
        },
        payload: {
          parentTaskId: parentTask.id,
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().detail || res.json().message).toContain('cannot parent itself');
    });
  });

  describe('9. Strong Concurrency Contract (RFC 9110 & Strong ETags)', () => {
    let occTask: any;

    beforeAll(async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'OCC Canonical Task', status: 'todo' },
      });
      expect(res.statusCode).toBe(201);
      occTask = res.json();
      expect(occTask.version).toBe(1);
      expect(res.headers['etag']).toBe('"v1"');
    });

    it('returns 428 Precondition Required when If-Match header is omitted on PATCH', async () => {
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${occTask.id}`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Missing If-Match Header Update' },
      });

      expect(res.statusCode).toBe(428);
      expect(res.json().code).toBe('PRECONDITION_REQUIRED');
    });

    it('returns 412 Precondition Failed when weak validator W/"v1" is provided', async () => {
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${occTask.id}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': 'W/"v1"', // Weak tag must fail strong comparison
        },
        payload: { title: 'Weak ETag Attempt' },
      });

      expect(res.statusCode).toBe(412);
      expect(res.json().code).toBe('PRECONDITION_FAILED');
      expect(res.json().currentEntity).toBeDefined();
    });

    it('returns 412 Precondition Failed when version mismatch occurs and returns currentEntity', async () => {
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${occTask.id}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': '"v999"', // Non-matching strong ETag
        },
        payload: { title: 'Version Mismatch Update' },
      });

      expect(res.statusCode).toBe(412);
      expect(res.json().code).toBe('PRECONDITION_FAILED');
      expect(res.json().currentEntity.version).toBe(1);
    });

    it('serializes parallel writers: writer 1 succeeds (200) and writer 2 receives 412 with updated entity', async () => {
      const currentVersion = 1;

      // Two writers concurrently submit modifications against version 1
      const [w1, w2] = await Promise.all([
        server.app.inject({
          method: 'PATCH',
          url: `/api/v1/orgs/${testOrg.slug}/tasks/${occTask.id}`,
          headers: {
            ...createAuthHeaders(ownerUser.id, ownerUser.email),
            'if-match': formatETag(currentVersion),
          },
          payload: { title: 'Writer 1 Content' },
        }),
        server.app.inject({
          method: 'PATCH',
          url: `/api/v1/orgs/${testOrg.slug}/tasks/${occTask.id}`,
          headers: {
            ...createAuthHeaders(memberUser.id, memberUser.email),
            'if-match': formatETag(currentVersion),
          },
          payload: { title: 'Writer 2 Content' },
        }),
      ]);

      const statuses = [w1.statusCode, w2.statusCode].sort();
      expect(statuses).toEqual([200, 412]);

      const successRes = w1.statusCode === 200 ? w1 : w2;
      const conflictRes = w1.statusCode === 412 ? w1 : w2;

      expect(successRes.json().version).toBe(2);
      expect(successRes.headers['etag']).toBe('"v2"');

      expect(conflictRes.json().code).toBe('PRECONDITION_FAILED');
      expect(conflictRes.json().currentEntity.version).toBe(2);
    });
  });

  describe('10. Provenance Integrity: Rejection of Forged AI Provenance', () => {
    it('rejects client attempt to specify source: ai_suggested (422)', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Forged AI Task',
          source: 'ai_suggested',
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('rejects client attempt to pass sourceRef (422)', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${defaultProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Forged Source Ref Task',
          sourceRef: 'urn:transcript:fake-meeting-1',
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });
  });
});
