import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parseConfig,
  signInternalApiRequest,
  generateUuidV7,
} from '@workspace/core';
import { buildServer, type ServerInstance } from '../server.js';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  moveSubtree,
  uuidToLtreeLabel,
  type DatabaseInstance,
  type Sql,
} from '@workspace/db';

describe('Stage 6 Organisation/Team/Project Tree & Subtree Movement Test Suite', () => {
  const secret = 'test-origin-verify-secret-token-16-chars';
  const testConfig = parseConfig({
    DATABASE_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    DATABASE_DIRECT_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    ORIGIN_VERIFY_SECRET: secret,
    PORT: 8093,
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
  let testOrg: { id: string; slug: string };

  beforeAll(async () => {
    server = buildServer(testConfig);
    db = server.db;
    sql = server.sql;

    // Seed test users
    const owner = await findOrCreateUserByEmail(db, { email: 'stage6-owner@example.com', name: 'Stage 6 Owner' });
    ownerUser = { id: owner.id, email: owner.email };

    const member = await findOrCreateUserByEmail(db, { email: 'stage6-member@example.com', name: 'Stage 6 Member' });
    memberUser = { id: member.id, email: member.email };

    // Create test organization
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Stage 6 Tree Org',
      slug: `stage6-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    // Add member to org
    await sql`
      INSERT INTO memberships (org_id, user_id, role, session_epoch)
      VALUES (${testOrg.id}, ${memberUser.id}, 'member', 1)
      ON CONFLICT DO NOTHING
    `;
  });

  afterAll(async () => {
    if (testOrg) {
      await sql`DELETE FROM orgs WHERE id = ${testOrg.id}`;
    }
    await sql`DELETE FROM users WHERE email LIKE 'stage6-%'`;
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

  describe('1. Node Hierarchy & Allowed Root Placement Invariants', () => {
    let engineeringTeamId: string;
    let backendTeamId: string;
    let apiProjectId: string;

    it('allows creating a root team (parentId: null)', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          name: 'Engineering',
          kind: 'team',
          parentId: null,
          visibility: 'public',
          description: 'All engineering disciplines',
        },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.name).toBe('Engineering');
      expect(data.kind).toBe('team');
      expect(data.parentId).toBeNull();
      expect(data.version).toBe(1);
      expect(response.headers['etag']).toBe('"v1"');
      engineeringTeamId = data.id;
    });

    it('allows creating a nested team beneath an existing team', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          name: 'Backend Platform',
          kind: 'team',
          parentId: engineeringTeamId,
          visibility: 'public',
        },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.name).toBe('Backend Platform');
      expect(data.parentId).toBe(engineeringTeamId);
      expect(data.path).toContain(uuidToLtreeLabel(engineeringTeamId));
      expect(data.path).toContain(uuidToLtreeLabel(data.id));
      backendTeamId = data.id;
    });

    it('allows creating a project under a team', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          name: 'API Gateway v2',
          kind: 'project',
          parentId: backendTeamId,
          visibility: 'public',
        },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.name).toBe('API Gateway v2');
      expect(data.kind).toBe('project');
      expect(data.parentId).toBe(backendTeamId);
      apiProjectId = data.id;
    });

    it('rejects creating a project at the root level (projects must be under a team)', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          name: 'Root Orphan Project',
          kind: 'project',
          parentId: null,
          visibility: 'public',
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });

    it('rejects creating any node under a project (projects are leaf nodes)', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          name: 'Sub-Project Under Leaf',
          kind: 'project',
          parentId: apiProjectId,
          visibility: 'public',
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });
  });

  describe('2. Path Stability and Renaming', () => {
    let teamAId: string;
    let childTeamId: string;
    let initialChildPath: string;

    it('creates a parent and child team, then renames parent without altering child path', async () => {
      // 1. Create parent team
      const parentRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { name: 'Operations', kind: 'team', parentId: null },
      });
      teamAId = parentRes.json().id;

      // 2. Create child team
      const childRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { name: 'DevOps', kind: 'team', parentId: teamAId },
      });
      childTeamId = childRes.json().id;
      initialChildPath = childRes.json().path;

      // 3. Rename parent team
      const renameRes = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${teamAId}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': '"v1"',
        },
        payload: { name: 'Global Operations & Cloud' },
      });

      expect(renameRes.statusCode).toBe(200);
      expect(renameRes.json().name).toBe('Global Operations & Cloud');
      expect(renameRes.json().version).toBe(2);
      expect(renameRes.headers['etag']).toBe('"v2"');

      // 4. Verify child team path remains completely unchanged
      const childAfterRename = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${childTeamId}`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(childAfterRename.statusCode).toBe(200);
      expect(childAfterRename.json().path).toBe(initialChildPath);
    });
  });

  describe('3. Private Project Permissions & Zero Information Leakage', () => {
    let parentTeamId: string;
    let privateProjectId: string;

    beforeAll(async () => {
      const teamRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { name: 'Executive Strategy', kind: 'team', parentId: null },
      });
      parentTeamId = teamRes.json().id;

      const projRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          name: 'Project M&A Confidential',
          kind: 'project',
          parentId: parentTeamId,
          visibility: 'private',
        },
      });
      privateProjectId = projRes.json().id;
    });

    it('allows owner to access private project', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${privateProjectId}`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Project M&A Confidential');
    });

    it('returns 404 and does NOT leak existence to non-member user', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${privateProjectId}`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });

      // Fails closed with 404 NOT_FOUND instead of 403 to prevent guessing IDs
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('NOT_FOUND');
    });

    it('excludes private project from tree listing for unauthorized user', async () => {
      const memberTree = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/tree`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });

      expect(memberTree.statusCode).toBe(200);
      const nodes = memberTree.json().nodes as Array<{ id: string; name: string }>;
      const found = nodes.find((n) => n.id === privateProjectId);
      expect(found).toBeUndefined();
    });

    it('excludes private project from projects directory for unauthorized user', async () => {
      const memberProjects = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/projects`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });

      expect(memberProjects.statusCode).toBe(200);
      const projects = memberProjects.json().projects as Array<{ id: string; name: string }>;
      const found = projects.find((p) => p.id === privateProjectId);
      expect(found).toBeUndefined();
    });

    it('grants access when member is added to node_members and revokes upon removal', async () => {
      // 1. Add member
      const addRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${privateProjectId}/members`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { userId: memberUser.id, role: 'member' },
      });
      expect(addRes.statusCode).toBe(201);

      // 2. Member can now access
      const memberAccess = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${privateProjectId}`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });
      expect(memberAccess.statusCode).toBe(200);
      expect(memberAccess.json().id).toBe(privateProjectId);

      // 3. Remove member
      const removeRes = await server.app.inject({
        method: 'DELETE',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${privateProjectId}/members/${memberUser.id}`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });
      expect(removeRes.statusCode).toBe(200);

      // 4. Access is immediately revoked
      const revokedAccess = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${privateProjectId}`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });
      expect(revokedAccess.statusCode).toBe(404);
    });
  });

  describe('4. Optimistic Concurrency Control (OCC)', () => {
    let testNodeId: string;

    beforeAll(async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { name: 'OCC Team Test', kind: 'team', parentId: null },
      });
      testNodeId = res.json().id;
    });

    it('rejects update when If-Match version is mismatched', async () => {
      const response = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${testNodeId}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': '"v999"', // Obsolete version
        },
        payload: { name: 'Attempted Conflicting Name' },
      });

      expect(response.statusCode).toBe(412);
      expect(response.json().code).toBe('PRECONDITION_FAILED');
    });

    it('succeeds update with correct If-Match version and increments version', async () => {
      const response = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${testNodeId}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': '"v1"',
        },
        payload: { name: 'OCC Team Valid Name' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().version).toBe(2);
      expect(response.headers['etag']).toBe('"v2"');
    });
  });

  describe('5. Subtree Movement and Cycle Prevention', () => {
    let rootA: string;
    let childA: string;
    let grandchildA: string;
    let rootB: string;

    beforeAll(async () => {
      const rA = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { name: 'Root A', kind: 'team', parentId: null },
      });
      rootA = rA.json().id;

      const cA = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { name: 'Child A', kind: 'team', parentId: rootA },
      });
      childA = cA.json().id;

      const gA = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { name: 'Grandchild Project A', kind: 'project', parentId: childA },
      });
      grandchildA = gA.json().id;

      const rB = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { name: 'Root B', kind: 'team', parentId: null },
      });
      rootB = rB.json().id;
    });

    it('rejects moving a parent under its own descendant (hierarchy cycle prevented)', async () => {
      const response = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${rootA}`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { parentId: childA },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe('VALIDATION_ERROR');
      expect(response.json().detail).toContain('hierarchy cycle prevented');
    });

    it('moves a child team and its subtree under a new parent root team', async () => {
      const response = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${childA}`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { parentId: rootB },
      });

      expect(response.statusCode).toBe(200);
      const moved = response.json();
      expect(moved.parentId).toBe(rootB);

      // Verify grandchild project path is rewritten under rootB
      const grandchildRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${grandchildA}`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(grandchildRes.statusCode).toBe(200);
      const gPath = grandchildRes.json().path as string;
      expect(gPath).toContain(uuidToLtreeLabel(rootB));
      expect(gPath).toContain(uuidToLtreeLabel(childA));
      expect(gPath).toContain(uuidToLtreeLabel(grandchildA));
      expect(gPath).not.toContain(uuidToLtreeLabel(rootA));
    });
  });

  describe('6. Safe Deletion & Subtree Archiving', () => {
    let parentToDelete: string;
    let childOfParent: string;

    beforeAll(async () => {
      const p = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { name: 'Team With Active Child', kind: 'team', parentId: null },
      });
      parentToDelete = p.json().id;

      const c = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { name: 'Active Project Inside', kind: 'project', parentId: parentToDelete },
      });
      childOfParent = c.json().id;
    });

    it('rejects deletion of a non-empty team without archive=true', async () => {
      const response = await server.app.inject({
        method: 'DELETE',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${parentToDelete}`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('CONFLICT');
    });

    it('archives the entire subtree when archive=true is specified', async () => {
      const response = await server.app.inject({
        method: 'DELETE',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${parentToDelete}?archive=true`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().archived).toBe(true);
      expect(response.json().affectedCount).toBe(2);

      // Verify nodes are excluded from active tree
      const treeRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/tree`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      const nodes = treeRes.json().nodes as Array<{ id: string }>;
      expect(nodes.some((n) => n.id === parentToDelete)).toBe(false);
      expect(nodes.some((n) => n.id === childOfParent)).toBe(false);
    });
  });

  describe('7. 500-Node Subtree Movement Performance Benchmark (Requirement W-3)', () => {
    it('moves a 500-node hierarchy in one atomic transaction in < 500 ms', async () => {
      // 1. Create source container team and destination team
      const sourceId = generateUuidV7();
      const srcLabel = uuidToLtreeLabel(sourceId);
      await sql`
        INSERT INTO nodes (id, org_id, parent_id, kind, name, path, visibility, rollup, version, created_by)
        VALUES (${sourceId}, ${testOrg.id}, NULL, 'team', 'Benchmark Source Root', 
                ${srcLabel}::ltree, 'public', '{}'::jsonb, 1, ${ownerUser.id})
      `;

      const destId = generateUuidV7();
      const dstLabel = uuidToLtreeLabel(destId);
      await sql`
        INSERT INTO nodes (id, org_id, parent_id, kind, name, path, visibility, rollup, version, created_by)
        VALUES (${destId}, ${testOrg.id}, NULL, 'team', 'Benchmark Destination Root',
                ${dstLabel}::ltree, 'public', '{}'::jsonb, 1, ${ownerUser.id})
      `;

      // 2. Generate 500 nodes beneath sourceId
      // 50 subteams, each containing 9 child projects = 50 + 450 = 500 nodes
      const nodeValues: Array<{
        id: string;
        parentId: string;
        kind: string;
        name: string;
        path: string;
      }> = [];

      for (let i = 0; i < 50; i++) {
        const teamId = generateUuidV7();
        const teamLabel = uuidToLtreeLabel(teamId);
        const teamPath = `${srcLabel}.${teamLabel}`;
        nodeValues.push({
          id: teamId,
          parentId: sourceId,
          kind: 'team',
          name: `Bench Subteam ${i}`,
          path: teamPath,
        });

        for (let j = 0; j < 9; j++) {
          const projId = generateUuidV7();
          const projLabel = uuidToLtreeLabel(projId);
          const projPath = `${teamPath}.${projLabel}`;
          nodeValues.push({
            id: projId,
            parentId: teamId,
            kind: 'project',
            name: `Bench Project ${i}-${j}`,
            path: projPath,
          });
        }
      }

      expect(nodeValues.length).toBe(500);

      // Insert 500 nodes within an atomic transaction
      await sql.begin(async (txn) => {
        for (const n of nodeValues) {
          await txn`
            INSERT INTO nodes (id, org_id, parent_id, kind, name, path, visibility, rollup, version, created_by)
            VALUES (${n.id}, ${testOrg.id}, ${n.parentId}, ${n.kind}, ${n.name}, ${n.path}::ltree, 'public', '{}'::jsonb, 1, ${ownerUser.id})
          `;
        }
      });

      // Verify count in database
      const [countRow] = await sql`
        SELECT count(*)::int as count 
        FROM nodes 
        WHERE org_id = ${testOrg.id} AND path <@ ${srcLabel}::ltree AND id != ${sourceId}
      `;
      expect(countRow?.count).toBe(500);

      // 3. Benchmark moveSubtree: move sourceId beneath destId
      const startTime = performance.now();

      const result = await moveSubtree(db, {
        orgId: testOrg.id,
        nodeId: sourceId,
        newParentId: destId,
        actorUserId: ownerUser.id,
        role: 'owner',
      });

      const durationMs = performance.now() - startTime;

      // 4. Verify Performance Requirement: MUST be < 500 ms!
      // (Total affected: 501 nodes: the source team + its 500 descendants)
      expect(result.affectedCount).toBe(501);
      expect(durationMs).toBeLessThan(500);

      // 5. Verify correctness: all 500 descendants have the new destination path prefix
      const expectedNewPrefix = `${dstLabel}.${srcLabel}`;
      const [movedCountRow] = await sql`
        SELECT count(*)::int as count 
        FROM nodes 
        WHERE org_id = ${testOrg.id} AND path <@ ${expectedNewPrefix}::ltree
      `;
      expect(movedCountRow?.count).toBe(501);
    });
  });
});
