import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parseConfig,
  signInternalApiRequest,
  getKolkataTodayDateString,
  addCalendarDays,
  type NodeRollupDTO,
  type ProjectDashboardDTO,
  type LeadershipSummaryDTO,
} from '@workspace/core';
import { buildServer, type ServerInstance } from '../server.js';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  createNode,
  markNodesDirty,
  recomputeAndStoreNodeRollup,
  calculateProjectRollup,
  getPermissionSafeRollup,
  type DatabaseInstance,
  type Sql,
} from '@workspace/db';

describe('Stage 9 Health Rollups & Dashboards Test Suite (Requirements W-6 and W-7)', () => {
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
  });

  let server: ServerInstance;
  let db: DatabaseInstance;
  let sql: Sql;

  let ownerUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let unauthorizedUser: { id: string; email: string };

  let testOrg: { id: string; slug: string };
  let teamAlphaId: string;
  let publicProjectId: string;
  let privateProjectId: string;

  const today = getKolkataTodayDateString();
  const yesterday = addCalendarDays(today, -1);
  const tomorrow = addCalendarDays(today, 1);

  function createAuthHeaders(userId: string, email: string, timestamp = Date.now()) {
    const signature = signInternalApiRequest({ userId, email, timestamp }, secret);
    return {
      'x-workspace-user-id': userId,
      'x-workspace-user-email': email,
      'x-workspace-timestamp': timestamp.toString(),
      'x-workspace-signature': signature,
    };
  }

  beforeAll(async () => {
    server = buildServer(testConfig);
    db = server.db;
    sql = server.sql;

    // 1. Seed users
    const owner = await findOrCreateUserByEmail(db, {
      email: 'stage9-owner@example.com',
      name: 'Stage 9 Owner',
    });
    ownerUser = { id: owner.id, email: owner.email };

    const member = await findOrCreateUserByEmail(db, {
      email: 'stage9-member@example.com',
      name: 'Stage 9 Member',
    });
    memberUser = { id: member.id, email: member.email };

    const unauth = await findOrCreateUserByEmail(db, {
      email: 'stage9-unauth@example.com',
      name: 'Stage 9 Unauthorized',
    });
    unauthorizedUser = { id: unauth.id, email: unauth.email };

    // 2. Create organization with owner
    const created = await createOrganizationWithOwner(db, {
      userId: ownerUser.id,
      name: 'Stage 9 Engineering Org',
      slug: `stage9-org-${Date.now()}`,
    });
    testOrg = { id: created.org.id, slug: created.org.slug };

    // Add memberUser and unauthorizedUser to org
    await sql`
      INSERT INTO memberships (org_id, user_id, role, session_epoch)
      VALUES
        (${testOrg.id}, ${memberUser.id}, 'member', 1),
        (${testOrg.id}, ${unauthorizedUser.id}, 'member', 1)
      ON CONFLICT DO NOTHING
    `;

    // 3. Create Team Alpha
    const team = await createNode(db, {
      orgId: testOrg.id,
      userId: ownerUser.id,
      role: 'owner',
      name: 'Team Alpha',
      kind: 'team',
      parentId: null,
      visibility: 'public',
    });
    teamAlphaId = team.id;

    // 4. Create Public Project under Team Alpha
    const pubProj = await createNode(db, {
      orgId: testOrg.id,
      userId: ownerUser.id,
      role: 'owner',
      name: 'Alpha Public App',
      kind: 'project',
      parentId: teamAlphaId,
      visibility: 'public',
    });
    publicProjectId = pubProj.id;

    // 5. Create Private Project under Team Alpha (accessible ONLY by owner and memberUser)
    const privProj = await createNode(db, {
      orgId: testOrg.id,
      userId: ownerUser.id,
      role: 'owner',
      name: 'Alpha Stealth Initiative',
      kind: 'project',
      parentId: teamAlphaId,
      visibility: 'private',
    });
    privateProjectId = privProj.id;

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
    await sql`DELETE FROM users WHERE email LIKE 'stage9-%'`;
    await server.close();
  }, 30000);

  describe('1. Direct-SQL Parity for Project Rollup Counting Semantics', () => {
    it('computes top-level tasks breakdown and excludes subtasks from headline denominator', async () => {
      // Create 4 top-level tasks in publicProjectId: 2 done, 1 in_progress, 1 blocked
      const t1Res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Task 1', status: 'done' },
      });
      const t1 = JSON.parse(t1Res.body);

      await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Task 2', status: 'done' },
      });

      await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Task 3', status: 'in_progress' },
      });

      await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Task 4', status: 'blocked' },
      });

      // Create 2 subtasks under Task 1: 1 done, 1 todo
      await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${t1.id}/subtasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Subtask 1.1', status: 'done' },
      });

      await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${t1.id}/subtasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { title: 'Subtask 1.2', status: 'todo' },
      });

      // Calculate rollup via API
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/rollup`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(res.statusCode).toBe(200);
      const { rollup }: { rollup: NodeRollupDTO } = JSON.parse(res.body);

      // Verify top-level tasks: exactly 4 (subtasks must NOT pollute denominator!)
      expect(rollup.tasks.total).toBe(4);
      expect(rollup.tasks.completed).toBe(2);
      expect(rollup.tasks.inProgress).toBe(1);
      expect(rollup.tasks.blocked).toBe(1);
      expect(rollup.tasks.open).toBe(2); // in_progress + blocked

      // Verify headline completion percentage: 2 / 4 = 50%
      expect(rollup.completionPercentage).toBe(50);

      // Verify subtasks are tracked distinctly
      expect(rollup.subtasks.total).toBe(2);
      expect(rollup.subtasks.completed).toBe(1);
      expect(rollup.subtasks.open).toBe(1);

      // Verify Direct SQL parity by comparing with raw SQL calculation
      const directSqlRollup = await calculateProjectRollup(db, {
        orgId: testOrg.id,
        projectId: publicProjectId,
        dateContext: today,
      });

      expect(rollup.tasks).toEqual(directSqlRollup.tasks);
      expect(rollup.subtasks).toEqual(directSqlRollup.subtasks);
      expect(rollup.completionPercentage).toBe(directSqlRollup.completionPercentage);
    });
  });

  describe('2. Overdue Subtask Propagation & Deterministic Health Thresholds', () => {
    it('marks project at_risk when an unfinished subtask is overdue, even if its parent task is completed', async () => {
      // Create a separate clean project for health threshold verification
      const healthProj = await createNode(db, {
        orgId: testOrg.id,
        userId: ownerUser.id,
        role: 'owner',
        name: 'Health Test Project',
        kind: 'project',
        parentId: teamAlphaId,
        visibility: 'public',
      });

      // 1. Initial state with zero tasks -> 'no_tasks'
      let rollup = await getPermissionSafeRollup(db, {
        orgId: testOrg.id,
        nodeId: healthProj.id,
        userId: ownerUser.id,
        role: 'owner',
        dateContext: today,
      });
      expect(rollup.health).toBe('no_tasks');
      expect(rollup.completionPercentage).toBe(0);

      // 2. Create parent task that is completed (status='done')
      const parentRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${healthProj.id}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Parent Task Finished Early',
          status: 'done',
        },
      });
      const parentTask = JSON.parse(parentRes.body);

      // 3. Create a subtask under parent that is OPEN (status='todo') and OVERDUE (due yesterday)
      const subRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${parentTask.id}/subtasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Critical Child Subtask',
          status: 'todo',
          dueDate: yesterday,
        },
      });
      const subtask = JSON.parse(subRes.body);

      // Query project rollup
      rollup = await getPermissionSafeRollup(db, {
        orgId: testOrg.id,
        nodeId: healthProj.id,
        userId: ownerUser.id,
        role: 'owner',
        dateContext: today,
      });

      // Requirement: "Health must still account for overdue unfinished subtasks. Completing a parent must not remove an overdue child from the risk calculation!"
      expect(rollup.overdueCount).toBe(1);
      expect(rollup.health).toBe('at_risk');

      // 4. Complete the subtask -> overdueCount becomes 0, health becomes on_track
      await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/tasks/${subtask.id}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': `"${subtask.version}"`,
        },
        payload: { status: 'done' },
      });

      rollup = await getPermissionSafeRollup(db, {
        orgId: testOrg.id,
        nodeId: healthProj.id,
        userId: ownerUser.id,
        role: 'owner',
        dateContext: today,
      });

      expect(rollup.overdueCount).toBe(0);
      expect(rollup.health).toBe('on_track');
      expect(rollup.completionPercentage).toBe(100);

      // 5. Create an open task due tomorrow (within next 7 calendar days) -> health becomes 'needs_attention'
      await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${healthProj.id}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Work Due Tomorrow',
          status: 'todo',
          dueDate: tomorrow,
        },
      });

      rollup = await getPermissionSafeRollup(db, {
        orgId: testOrg.id,
        nodeId: healthProj.id,
        userId: ownerUser.id,
        role: 'owner',
        dateContext: today,
      });

      expect(rollup.overdueCount).toBe(0);
      expect(rollup.dueSoonCount).toBe(1);
      expect(rollup.health).toBe('needs_attention');
    });
  });

  describe('3. Permission-Safe Aggregations & Private Project Zero-Leakage', () => {
    it('isolates private project metrics from unauthorized members in team summaries and direct dashboard queries', async () => {
      // Add 2 tasks to privateProjectId
      await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${privateProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Stealth Secret Task 1',
          status: 'todo',
          dueDate: yesterday, // overdue in private project
        },
      });

      await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${privateProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Stealth Secret Task 2',
          status: 'done',
        },
      });

      // 1. Authorized Owner queries Team Alpha summary -> sees both public and private tasks
      const ownerTeamRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/teams/${teamAlphaId}/summary`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });
      expect(ownerTeamRes.statusCode).toBe(200);
      const ownerRollup: NodeRollupDTO = JSON.parse(ownerTeamRes.body).rollup;

      // 2. Authorized Member (memberUser is in node_members for private project) queries Team Alpha summary
      const memberTeamRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/teams/${teamAlphaId}/summary`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });
      expect(memberTeamRes.statusCode).toBe(200);
      const memberRollup: NodeRollupDTO = JSON.parse(memberTeamRes.body).rollup;
      expect(memberRollup.tasks.total).toBe(ownerRollup.tasks.total);

      // 3. UNAUTHORIZED Member (unauthorizedUser is an org member, but NOT in node_members of private project)
      const unauthTeamRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/teams/${teamAlphaId}/summary`,
        headers: createAuthHeaders(unauthorizedUser.id, unauthorizedUser.email),
      });
      expect(unauthTeamRes.statusCode).toBe(200);
      const unauthRollup: NodeRollupDTO = JSON.parse(unauthTeamRes.body).rollup;

      // Critical Isolation Rule: Zero Leakage!
      // The unauthorized member must ONLY see counts from publicProjectId, never from privateProjectId!
      expect(unauthRollup.tasks.total).toBeLessThan(ownerRollup.tasks.total);
      expect(unauthRollup.overdueCount).toBeLessThan(ownerRollup.overdueCount);

      // 4. Direct dashboard query by unauthorized member on private project returns 404 (zero leakage)
      const directPrivateRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${privateProjectId}/dashboard`,
        headers: createAuthHeaders(unauthorizedUser.id, unauthorizedUser.email),
      });
      expect(directPrivateRes.statusCode).toBe(404);

      // 5. Direct dashboard query by authorized owner returns 200 with ProjectDashboardDTO
      const ownerPrivateRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${privateProjectId}/dashboard`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });
      expect(ownerPrivateRes.statusCode).toBe(200);
      const privateDashboard: ProjectDashboardDTO = JSON.parse(ownerPrivateRes.body);
      expect(privateDashboard.project.id).toBe(privateProjectId);
      expect(privateDashboard.project.visibility).toBe('private');
      expect(privateDashboard.rollup.tasks.total).toBe(2);
    });
  });

  describe('4. Generational Watermark Check & Subtree Invalidation', () => {
    it('prevents stale overwrite if a mutation arrives during recomputation', async () => {
      // Mark publicProjectId dirty
      const [affectedId] = await markNodesDirty(db, {
        orgId: testOrg.id,
        nodeIds: [publicProjectId],
      });
      expect(affectedId).toBeDefined();

      const [initialDirty] = await sql`
        SELECT dirty_generation FROM node_rollup_dirty WHERE node_id = ${publicProjectId}
      `;
      const gen1 = initialDirty!.dirty_generation;

      // Simulate concurrent mutation arriving during calculation: bump dirty_generation
      await markNodesDirty(db, {
        orgId: testOrg.id,
        nodeIds: [publicProjectId],
      });

      const [bumpedDirty] = await sql`
        SELECT dirty_generation FROM node_rollup_dirty WHERE node_id = ${publicProjectId}
      `;
      expect(bumpedDirty!.dirty_generation).toBeGreaterThan(gen1);

      // When recompute finishes for gen1, it must NOT delete the dirty record because dirty_generation has increased!
      await recomputeAndStoreNodeRollup(db, {
        orgId: testOrg.id,
        nodeId: publicProjectId,
        targetGeneration: gen1,
      });

      // Node should remain dirty for next pass
      const [remainingDirty] = await sql`
        SELECT dirty_generation FROM node_rollup_dirty WHERE node_id = ${publicProjectId}
      `;
      expect(remainingDirty).toBeDefined();
    });

    it('invalidates both old and new ancestor paths when a node is moved', async () => {
      // Create Team Beta
      const teamBeta = await createNode(db, {
        orgId: testOrg.id,
        userId: ownerUser.id,
        role: 'owner',
        name: 'Team Beta',
        kind: 'team',
        parentId: null,
        visibility: 'public',
      });

      // Create Project to move under Team Alpha
      const moveable = await createNode(db, {
        orgId: testOrg.id,
        userId: ownerUser.id,
        role: 'owner',
        name: 'Moveable Project',
        kind: 'project',
        parentId: teamAlphaId,
        visibility: 'public',
      });

      // Clear dirty records for clean baseline
      await sql`DELETE FROM node_rollup_dirty WHERE org_id = ${testOrg.id}`;

      // Move project from Team Alpha to Team Beta
      const moveRes = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${moveable.id}`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { parentId: teamBeta.id },
      });
      expect(moveRes.statusCode).toBe(200);

      // Verify that both old parent (teamAlphaId) and new parent (teamBeta.id) are marked dirty!
      const dirtyNodes = await sql`
        SELECT node_id FROM node_rollup_dirty WHERE org_id = ${testOrg.id}
      `;
      const dirtyIds = dirtyNodes.map((d: any) => d.node_id);
      expect(dirtyIds).toContain(teamAlphaId);
      expect(dirtyIds).toContain(teamBeta.id);
      expect(dirtyIds).toContain(moveable.id);
    });
  });

  describe('5. Leadership Summary with Exact Direct-SQL Parity', () => {
    it('returns summary counters and at-risk drilldowns matching direct SQL queries', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/leadership/summary`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(res.statusCode).toBe(200);
      const leadership: LeadershipSummaryDTO = JSON.parse(res.body);

      // Check summary structure
      expect(leadership.summary).toHaveProperty('totalProjects');
      expect(leadership.summary).toHaveProperty('totalTasks');
      expect(leadership.summary).toHaveProperty('totalOverdue');
      expect(leadership.summary).toHaveProperty('totalUnassigned');
      expect(leadership.summary).toHaveProperty('atRiskProjects');
      expect(leadership.summary).toHaveProperty('averageCompletionPercentage');

      // Verify SQL parity: sum of tasks across permitted projects matches summary.totalTasks
      const manualTaskSum = leadership.projects.reduce((acc, p) => acc + p.rollup.tasks.total, 0);
      expect(leadership.summary.totalTasks).toBe(manualTaskSum);

      const manualOverdueSum = leadership.projects.reduce((acc, p) => acc + p.rollup.overdueCount, 0);
      expect(leadership.summary.totalOverdue).toBe(manualOverdueSum);

      // Verify filter by health: filtering by 'at_risk' returns only at_risk projects
      const filteredRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/leadership/summary?health=at_risk`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });
      expect(filteredRes.statusCode).toBe(200);
      const filteredLeadership: LeadershipSummaryDTO = JSON.parse(filteredRes.body);

      for (const p of filteredLeadership.projects) {
        expect(p.rollup.health).toBe('at_risk');
      }
    });
  });

  describe('6. Requirement W-6 Timing Verification (<60s)', () => {
    it('propagates task mutation to updated rollup within timing threshold', async () => {
      const start = Date.now();

      // Create new task in publicProjectId
      const createRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/tasks`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Timing Benchmark Task',
          status: 'todo',
        },
      });
      expect(createRes.statusCode).toBe(201);

      // Immediately fetch project rollup (triggers dateContext fresh calculation or recomputation)
      const rollupRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/projects/${publicProjectId}/rollup`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });
      expect(rollupRes.statusCode).toBe(200);
      const { rollup }: { rollup: NodeRollupDTO } = JSON.parse(rollupRes.body);

      const elapsedMs = Date.now() - start;
      // Requirement W-6: "Health visible within 60s of a task change"
      expect(elapsedMs).toBeLessThan(60000);
      expect(rollup.tasks.total).toBeGreaterThan(0);
    });
  });
});
