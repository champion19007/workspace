import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parseConfig,
  signInternalApiRequest,
  formatETag,
  compareRanks,
} from '@workspace/core';
import { buildServer, type ServerInstance } from '../server.js';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  createNode,
  type DatabaseInstance,
  type Sql,
} from '@workspace/db';

describe('Stage 8 Task Views & Fractional Ordering Test Suite (Requirement W-5)', () => {
  const secret = 'test-origin-verify-secret-token-16-chars';
  const testConfig = parseConfig({
    DATABASE_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    DATABASE_DIRECT_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    ORIGIN_VERIFY_SECRET: secret,
    PORT: 8095,
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
  let restrictedUser: { id: string; email: string };

  let testOrg: { id: string; slug: string };
  let defaultTeamId: string;
  let publicProjectId: string;
  let privateProjectId: string;

  beforeAll(async () => {
    server = buildServer(testConfig);
    db = server.db;
    sql = server.sql;

    // 1. Seed test users
    const owner = await findOrCreateUserByEmail(db, {
      email: 'stage8-owner@example.com',
      name: 'Stage 8 Owner',
    });
    ownerUser = { id: owner.id, email: owner.email };

    const member = await findOrCreateUserByEmail(db, {
      email: 'stage8-member@example.com',
      name: 'Stage 8 Member',
    });
    memberUser = { id: member.id, email: member.email };

    const restricted = await findOrCreateUserByEmail(db, {
      email: 'stage8-restricted@example.com',
      name: 'Stage 8 Restricted',
    });
    restrictedUser = { id: restricted.id, email: restricted.email };

    // 2. Primary organization
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Stage 8 Views Org',
      slug: `stage8-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    // Add members to org
    await sql`
      INSERT INTO memberships (org_id, user_id, role, session_epoch)
      VALUES 
        (${testOrg.id}, ${memberUser.id}, 'member', 1),
        (${testOrg.id}, ${restrictedUser.id}, 'member', 1)
      ON CONFLICT DO NOTHING
    `;

    // 3. Create Team
    const team = await createNode(db, {
      orgId: testOrg.id,
      userId: ownerUser.id,
      role: 'owner',
      name: 'Product Delivery',
      kind: 'team',
      parentId: null,
      visibility: 'public',
    });
    defaultTeamId = team.id;

    // 4. Create Public Project
    const publicProj = await createNode(db, {
      orgId: testOrg.id,
      userId: ownerUser.id,
      role: 'owner',
      name: 'Web Application',
      kind: 'project',
      parentId: defaultTeamId,
      visibility: 'public',
    });
    publicProjectId = publicProj.id;

    // 5. Create Private Project (only owner and memberUser belong to it; restrictedUser does NOT)
    const privProj = await createNode(db, {
      orgId: testOrg.id,
      userId: ownerUser.id,
      role: 'owner',
      name: 'Stealth Feature',
      kind: 'project',
      parentId: defaultTeamId,
      visibility: 'private',
    });
    privateProjectId = privProj.id;

    // Add memberUser explicitly to private project
    await sql`
      INSERT INTO node_members (org_id, node_id, user_id)
      VALUES (${testOrg.id}, ${privateProjectId}, ${memberUser.id})
      ON CONFLICT DO NOTHING
    `;
  }, 30000);

  afterAll(async () => {
    if (testOrg) {
      await sql`DELETE FROM orgs WHERE id = ${testOrg.id}`;
    }
    await sql`DELETE FROM users WHERE email LIKE 'stage8-%'`;
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

  describe('1. Normal Move Updates Exactly One Row In Tasks Table', () => {
    it('updates only the moved task row, leaving neighbours untouched and recording outbox event', async () => {
      // Create 3 tasks in todo column
      const res1 = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Task Alpha',
          status: 'todo',
        },
      });
      expect(res1.statusCode).toBe(201);
      const task1 = res1.json();

      const res2 = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Task Beta',
          status: 'todo',
        },
      });
      expect(res2.statusCode).toBe(201);
      const task2 = res2.json();

      const res3 = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Task Gamma',
          status: 'todo',
        },
      });
      expect(res3.statusCode).toBe(201);
      const task3 = res3.json();

      // Verify initial ranks are ascending
      expect(compareRanks(task1.rank, task2.rank)).toBeLessThan(0);
      expect(compareRanks(task2.rank, task3.rank)).toBeLessThan(0);

      // Record before-move database snapshots for task1, task2, task3
      const [snap1Before] = await sql`SELECT id, rank, version, updated_at FROM tasks WHERE id = ${task1.id}`;
      const [snap2Before] = await sql`SELECT id, rank, version, updated_at FROM tasks WHERE id = ${task2.id}`;
      const [snap3Before] = await sql`SELECT id, rank, version, updated_at FROM tasks WHERE id = ${task3.id}`;

      expect(snap1Before!.version).toBe(1);
      expect(snap2Before!.version).toBe(1);
      expect(snap3Before!.version).toBe(1);

      // Move Task Gamma (task3) between Task Alpha (task1) and Task Beta (task2)
      const moveRes = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${task3.id}/move`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': formatETag(task3.version),
        },
        payload: {
          status: 'todo',
          prevTaskId: task1.id,
          nextTaskId: task2.id,
        },
      });

      expect(moveRes.statusCode).toBe(200);
      const movedTask = moveRes.json();
      expect(moveRes.headers['etag']).toBe(formatETag(2));
      expect(movedTask.version).toBe(2);

      // Verify rank is strictly between task1 and task2
      expect(compareRanks(snap1Before!.rank, movedTask.rank)).toBeLessThan(0);
      expect(compareRanks(movedTask.rank, snap2Before!.rank)).toBeLessThan(0);

      // CRITICAL INVARIANT: Directly check all 3 rows in the database
      const [snap1After] = await sql`SELECT id, rank, version, updated_at FROM tasks WHERE id = ${task1.id}`;
      const [snap2After] = await sql`SELECT id, rank, version, updated_at FROM tasks WHERE id = ${task2.id}`;
      const [snap3After] = await sql`SELECT id, rank, version, updated_at FROM tasks WHERE id = ${task3.id}`;

      // 1. Task Alpha (prev neighbour) was NOT updated
      expect(snap1After!.rank).toBe(snap1Before!.rank);
      expect(snap1After!.version).toBe(snap1Before!.version);

      // 2. Task Beta (next neighbour) was NOT updated
      expect(snap2After!.rank).toBe(snap2Before!.rank);
      expect(snap2After!.version).toBe(snap2Before!.version);

      // 3. ONLY Task Gamma was updated: rank changed, version incremented by exactly 1
      expect(snap3After!.version).toBe(2);
      expect(snap3After!.rank).toBe(movedTask.rank);

      // 4. Outbox table recorded task.moved
      const [outboxEvent] = await sql`
        SELECT topic, payload FROM outbox 
        WHERE topic = 'task.moved' AND (payload->>'taskId')::text = ${task3.id}
        ORDER BY created_at DESC LIMIT 1
      `;
      expect(outboxEvent).toBeDefined();
      expect(outboxEvent!.topic).toBe('task.moved');
      expect(outboxEvent!.payload.oldStatus).toBe('todo');
      expect(outboxEvent!.payload.newStatus).toBe('todo');
    });

    it('moves a task to another column and updates status, rank, and version atomically', async () => {
      // Create task in todo
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Cross Column Move Test',
          status: 'todo',
        },
      });
      const task = res.json();

      // Move to in_progress as first item
      const moveRes = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${task.id}/move`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': formatETag(task.version),
        },
        payload: {
          status: 'in_progress',
          prevTaskId: null,
          nextTaskId: null,
        },
      });

      expect(moveRes.statusCode).toBe(200);
      const moved = moveRes.json();
      expect(moved.status).toBe('in_progress');
      expect(moved.version).toBe(2);

      const [dbTask] = await sql`SELECT status, rank, version FROM tasks WHERE id = ${task.id}`;
      expect(dbTask!.status).toBe('in_progress');
      expect(dbTask!.version).toBe(2);
    });
  });

  describe('2. Collation & Lexical Sorting Invariants', () => {
    it('guarantees that database COLLATE "C" matches JavaScript string comparisons', async () => {
      // Verify listTasks returns tasks in exact lexical rank order matching JavaScript sort
      const listRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks?status=todo`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(listRes.statusCode).toBe(200);
      const data = listRes.json();
      const items = data.tasks;
      expect(items.length).toBeGreaterThanOrEqual(3);

      for (let i = 0; i < items.length - 1; i++) {
        const currentRank = items[i].rank;
        const nextRank = items[i + 1].rank;
        // Invariant: currentRank < nextRank in ASCII / C collation
        expect(compareRanks(currentRank, nextRank)).toBeLessThanOrEqual(0);
        // JavaScript `<` operator comparison must agree 100%
        expect(currentRank <= nextRank).toBe(true);
      }
    });
  });

  describe('3. Concurrency Protection & Preconditions', () => {
    it('returns 428 Precondition Required when If-Match header is missing', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Missing Precondition Test',
        },
      });
      const task = res.json();

      const moveRes = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${task.id}/move`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email), // No if-match
        payload: {
          status: 'in_progress',
        },
      });

      expect(moveRes.statusCode).toBe(428);
      expect(moveRes.json().code).toBe('PRECONDITION_REQUIRED');
    });

    it('returns 412 Precondition Failed when If-Match version is stale', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Stale Precondition Test',
        },
      });
      const task = res.json();

      // First update increments version to 2
      await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${task.id}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': formatETag(task.version),
        },
        payload: {
          title: 'Updated title',
        },
      });

      // Attempt move with stale version 1
      const staleMoveRes = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${task.id}/move`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': formatETag(1), // Stale
        },
        payload: {
          status: 'in_progress',
        },
      });

      expect(staleMoveRes.statusCode).toBe(412);
      expect(staleMoveRes.json().code).toBe('PRECONDITION_FAILED');
    });

    it('handles concurrent moves into the same gap without rank collision', async () => {
      // Create Boundary A and Boundary B
      const resA = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Gap Boundary A', status: 'todo' },
      });
      const taskA = resA.json();

      const resB = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Gap Boundary B', status: 'todo' },
      });
      const taskB = resB.json();

      // Create Task C and Task D in done column
      const resC = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Contender C', status: 'done' },
      });
      const taskC = resC.json();

      const resD = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Contender D', status: 'done' },
      });
      const taskD = resD.json();

      // Move C and D into the same gap (between A and B) concurrently
      const [moveC, moveD] = await Promise.all([
        server.app.inject({
          method: 'PATCH',
          url: `/api/v1/orgs/${testOrg.slug}/tasks/${taskC.id}/move`,
          headers: {
            ...createAuthHeaders(ownerUser.id, ownerUser.email),
            'if-match': formatETag(taskC.version),
          },
          payload: {
            status: 'todo',
            prevTaskId: taskA.id,
            nextTaskId: taskB.id,
          },
        }),
        server.app.inject({
          method: 'PATCH',
          url: `/api/v1/orgs/${testOrg.slug}/tasks/${taskD.id}/move`,
          headers: {
            ...createAuthHeaders(ownerUser.id, ownerUser.email),
            'if-match': formatETag(taskD.version),
          },
          payload: {
            status: 'todo',
            prevTaskId: taskA.id,
            nextTaskId: taskB.id,
          },
        }),
      ]);

      expect(moveC.statusCode).toBe(200);
      expect(moveD.statusCode).toBe(200);

      const rankC = moveC.json().rank;
      const rankD = moveD.json().rank;

      // Both must be between A and B
      expect(compareRanks(taskA.rank, rankC)).toBeLessThan(0);
      expect(compareRanks(rankC, taskB.rank)).toBeLessThan(0);

      expect(compareRanks(taskA.rank, rankD)).toBeLessThan(0);
      expect(compareRanks(rankD, taskB.rank)).toBeLessThan(0);

      // Invariant: Ranks must NEVER collide!
      expect(rankC).not.toBe(rankD);
      expect(compareRanks(rankC, rankD)).not.toBe(0);
    });
  });

  describe('4. Neighbour Validation & Boundary Guards', () => {
    it('rejects foreign / cross-project neighbour', async () => {
      // Create task in private project assigned to memberUser
      const privRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${privateProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Private Project Task',
          assigneeId: memberUser.id,
        },
      });
      expect(privRes.statusCode).toBe(201);
      const privTask = privRes.json();

      // Create task in public project
      const pubRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Public Project Task',
        },
      });
      const pubTask = pubRes.json();

      // Attempt to move pubTask using privTask as prevTaskId
      const crossMoveRes = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${pubTask.id}/move`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': formatETag(pubTask.version),
        },
        payload: {
          status: 'todo',
          prevTaskId: privTask.id, // Different project!
        },
      });

      expect([404, 422]).toContain(crossMoveRes.statusCode);
    });

    it('rejects nonexistent neighbour ID with 404 or 422', async () => {
      const pubRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Public Task 2',
        },
      });
      const pubTask = pubRes.json();

      const fakeMoveRes = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${pubTask.id}/move`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': formatETag(pubTask.version),
        },
        payload: {
          status: 'todo',
          prevTaskId: '00000000-0000-0000-0000-000000000000',
        },
      });

      expect([404, 422]).toContain(fakeMoveRes.statusCode);
    });
  });

  describe('5. Column Rank Rebalancing Maintenance', () => {
    it('rebalances dense column ranks back to short base-62 ranks while preserving order', async () => {
      // Create a test project for rebalancing under defaultTeamId
      const rebalProj = await createNode(db, {
        orgId: testOrg.id,
        userId: ownerUser.id,
        role: 'owner',
        name: 'Rebalance Test Project',
        kind: 'project',
        parentId: defaultTeamId,
        visibility: 'public',
      });

      // Create 3 tasks with artificially dense/long ranks (> 32 characters)
      const t1 = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${rebalProj.id}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Dense Task 1', status: 'todo' },
      });
      const t2 = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${rebalProj.id}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Dense Task 2', status: 'todo' },
      });
      const t3 = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${rebalProj.id}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Dense Task 3', status: 'todo' },
      });

      const longRank1 = 'a00000000000000000000000000000001';
      const longRank2 = 'a00000000000000000000000000000002';
      const longRank3 = 'a00000000000000000000000000000003';

      await sql`UPDATE tasks SET rank = ${longRank1} WHERE id = ${t1.json().id}`;
      await sql`UPDATE tasks SET rank = ${longRank2} WHERE id = ${t2.json().id}`;
      await sql`UPDATE tasks SET rank = ${longRank3} WHERE id = ${t3.json().id}`;

      // Trigger rebalance endpoint
      const rebalRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${rebalProj.id}/columns/todo/rebalance`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(rebalRes.statusCode).toBe(200);
      const rebalData = rebalRes.json();
      expect(rebalData.rebalancedCount).toBe(3);
      expect(rebalData.newRanks).toHaveLength(3);

      // Verify new ranks in database
      const rows = await sql`
        SELECT id, rank, version FROM tasks 
        WHERE project_id = ${rebalProj.id} AND status = 'todo'
        ORDER BY rank COLLATE "C" ASC
      `;

      expect(rows.length).toBe(3);
      // All ranks should now be short (< 10 chars)
      for (const row of rows) {
        expect(row.rank.length).toBeLessThan(10);
      }
      // Order is strictly preserved
      expect(rows[0]!.id).toBe(t1.json().id);
      expect(rows[1]!.id).toBe(t2.json().id);
      expect(rows[2]!.id).toBe(t3.json().id);
    });
  });

  describe('6. Organization-wide My Tasks API & Isolation (GET /api/v1/orgs/:orgSlug/me/tasks)', () => {
    it('resolves assignee strictly from session user and rejects/ignores foreign userId spoofing', async () => {
      // Assign task to memberUser
      const taskRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Member Exclusive Task',
          assigneeId: memberUser.id,
          status: 'todo',
        },
      });
      expect(taskRes.statusCode).toBe(201);
      const task = taskRes.json();

      // 1. memberUser requests /me/tasks -> gets their task
      const memberReq = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/me/tasks`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });
      expect(memberReq.statusCode).toBe(200);
      const memberTasks = memberReq.json();
      expect(memberTasks.tasks.some((t: any) => t.id === task.id)).toBe(true);

      // 2. restrictedUser requests /me/tasks while trying to spoof ?userId=memberUser.id -> MUST NOT see memberUser task
      const spoofReq = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/me/tasks?userId=${memberUser.id}`,
        headers: createAuthHeaders(restrictedUser.id, restrictedUser.email),
      });
      expect(spoofReq.statusCode).toBe(200);
      const spoofTasks = spoofReq.json();
      expect(spoofTasks.tasks.some((t: any) => t.id === task.id)).toBe(false);
    });

    it('hides tasks in private projects from users without project membership', async () => {
      // Insert task directly into private project assigned to restrictedUser (simulating user removed from private project)
      const [privTask] = await sql`
        INSERT INTO tasks (org_id, project_id, key, title, status, priority, assignee_id, rank, version, created_by)
        VALUES (${testOrg.id}, ${privateProjectId}, 'PRIV-99', 'Secret Ghost Task', 'todo', 'high', ${restrictedUser.id}, 'a0', 1, ${ownerUser.id})
        RETURNING id
      `;

      // restrictedUser calls /me/tasks -> because project is private and restrictedUser is not a member,
      // it MUST NOT appear in restrictedUser's My Tasks list!
      const restrictedReq = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/me/tasks`,
        headers: createAuthHeaders(restrictedUser.id, restrictedUser.email),
      });
      expect(restrictedReq.statusCode).toBe(200);
      const restrictedList = restrictedReq.json();
      expect(restrictedList.tasks.some((t: any) => t.id === privTask!.id)).toBe(false);

      // But ownerUser (who is org owner) CAN see tasks if assigned to ownerUser
      const ownerTaskRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${privateProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Owner Private Task',
          assigneeId: ownerUser.id,
          status: 'todo',
        },
      });
      expect(ownerTaskRes.statusCode).toBe(201);
      const ownerTask = ownerTaskRes.json();

      const ownerReq = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/me/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });
      expect(ownerReq.statusCode).toBe(200);
      const ownerList = ownerReq.json();
      expect(ownerList.tasks.some((t: any) => t.id === ownerTask.id)).toBe(true);
    });

    it('includes assigned subtasks and provides parent and project context', async () => {
      // Create parent task
      const parentRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Parent Deliverable',
        },
      });
      const parentTask = parentRes.json();

      // Create subtask assigned to memberUser
      const subRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${parentTask.id}/subtasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Subtask Component Alpha',
          assigneeId: memberUser.id,
          status: 'todo',
        },
      });
      expect(subRes.statusCode).toBe(201);
      const subtask = subRes.json();

      // memberUser calls /me/tasks
      const meRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/me/tasks`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });

      expect(meRes.statusCode).toBe(200);
      const meList = meRes.json();
      const foundSub = meList.tasks.find((t: any) => t.id === subtask.id);
      expect(foundSub).toBeDefined();
      expect(foundSub.parentTaskId).toBe(parentTask.id);
      expect(foundSub.parentTitle).toBe('Parent Deliverable');
      expect(foundSub.projectName).toBe('Web Application');
    });

    it('filters accurately by category and computes live category counts', async () => {
      // Seed tasks with various due dates for memberUser
      // 1. Overdue: dueDate = 2020-01-01
      await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Overdue Task',
          assigneeId: memberUser.id,
          status: 'todo',
          dueDate: '2020-01-01',
        },
      });

      // 2. Upcoming: dueDate = 2035-12-31
      await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Upcoming Task',
          assigneeId: memberUser.id,
          status: 'todo',
          dueDate: '2035-12-31',
        },
      });

      // 3. Completed task
      await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Completed Task',
          assigneeId: memberUser.id,
          status: 'done',
        },
      });

      // Fetch all
      const allRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/me/tasks?category=all`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });
      expect(allRes.statusCode).toBe(200);
      const allData = allRes.json();
      expect(allData.counts.overdue).toBeGreaterThanOrEqual(1);
      expect(allData.counts.upcoming).toBeGreaterThanOrEqual(1);
      expect(allData.counts.all).toBeGreaterThanOrEqual(3);

      // Filter category=overdue
      const overdueRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/me/tasks?category=overdue`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });
      expect(overdueRes.statusCode).toBe(200);
      const overdueData = overdueRes.json();
      expect(overdueData.tasks.every((t: any) => t.dueDate === '2020-01-01')).toBe(true);

      // Filter category=pending (must exclude done)
      const pendingRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/me/tasks?category=pending`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });
      expect(pendingRes.statusCode).toBe(200);
      const pendingData = pendingRes.json();
      expect(pendingData.tasks.every((t: any) => t.status !== 'done')).toBe(true);
    });
  });
});
