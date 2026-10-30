import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';
import { hashToken } from '@workspace/core';
import * as schema from '../schema/index.js';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  createMemberInvitation,
  acceptMemberInvitation,
  getOrganizationMembers,
} from '../auth-operations.js';
import { createNode, listProjects, addNodeMember } from '../node-operations.js';
import { createTask, listTasks, getTaskById } from '../task-operations.js';
import { createDoc, listDocs } from '../doc-operations.js';
import { tenantSql } from '../client.js';

// A client joins by invitation and only ever sees the projects an Owner or Manager added them to (0016).
describe('client access level (Real PostgreSQL)', () => {
  const directUrl =
    process.env.DATABASE_DIRECT_URL ||
    'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev?sslmode=disable';

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let orgId: string;
  let ownerId: string;
  let developerId: string;
  let clientId: string;
  let sharedProjectId: string;
  let otherProjectId: string;
  let otherTaskId: string;
  let sharedDocId: string;
  let asClient: { orgId: string; userId: string; role: string };

  beforeAll(async () => {
    sql = postgres(directUrl, { max: 5 });
    db = drizzle(sql, { schema });
    const stamp = Date.now();
    const mk = (who: string) => findOrCreateUserByEmail(db, { email: `client-access-${who}-${stamp}@workspace.dev`, name: who });
    const [owner, developer, client] = [await mk('owner'), await mk('developer'), await mk('client')];
    [ownerId, developerId, clientId] = [owner.id, developer.id, client.id];

    const { org } = await createOrganizationWithOwner(db, { name: 'Client Access Org', slug: `client-access-${stamp}`, userId: ownerId });
    orgId = org.id;
    await sql`INSERT INTO memberships (org_id, user_id, role) VALUES (${orgId}, ${developerId}, 'member')`;

    const asOwner = { orgId, userId: ownerId, role: 'owner' };
    const team = await createNode(db, { ...asOwner, name: 'Clients', kind: 'team' });
    sharedProjectId = (await createNode(db, { ...asOwner, name: 'Acme website', kind: 'project', parentId: team.id })).id;
    otherProjectId = (await createNode(db, { ...asOwner, name: 'Globex app', kind: 'project', parentId: team.id })).id;
    for (const projectId of [sharedProjectId, otherProjectId]) {
      const task = await createTask(db, { orgId, actorUserId: ownerId, role: 'owner', input: { projectId, title: 'Kickoff', status: 'todo', priority: 'medium' } });
      if (projectId === otherProjectId) otherTaskId = task.id;
      const doc = await createDoc(db, { orgId, actorUserId: ownerId, role: 'owner', input: { nodeId: projectId, title: 'Brief', bodyMd: '' } });
      if (projectId === sharedProjectId) sharedDocId = doc.id;
    }

    const rawToken = randomUUID();
    await createMemberInvitation(db, {
      orgId,
      actorUserId: ownerId,
      email: client.email,
      role: 'client',
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await acceptMemberInvitation(db, { tokenHash: hashToken(rawToken), userId: clientId, userEmail: client.email });
    await addNodeMember(db, { orgId, nodeId: sharedProjectId, targetUserId: clientId, actorUserId: ownerId, role: 'owner' });
    asClient = { orgId, userId: clientId, role: 'client' };
  });

  afterAll(async () => {
    if (orgId) await sql`DELETE FROM orgs WHERE id = ${orgId}`;
    await sql.end({ timeout: 5 });
  });

  it('accepting the invitation makes them a client and marks it used', async () => {
    const [m] = await sql`SELECT role FROM memberships WHERE org_id = ${orgId} AND user_id = ${clientId}`;
    expect(m!.role).toBe('client');
    const [inv] = await sql`SELECT accepted_at FROM invitations WHERE org_id = ${orgId}`;
    expect(inv!.accepted_at).not.toBeNull();
  });

  it('sees only the projects, tasks and docs they were added to', async () => {
    const { projects } = await listProjects(db, asClient);
    expect(projects.map((p) => p.id)).toEqual([sharedProjectId]);

    const tasks = await listTasks(db, asClient);
    expect(tasks.map((t) => t.projectId)).toEqual([sharedProjectId]);
    await expect(getTaskById(db, { ...asClient, taskId: otherTaskId })).rejects.toThrow();

    const { docs } = await listDocs(db, { ...asClient, query: {} as never });
    expect(docs.map((d) => d.nodeId)).toEqual([sharedProjectId]);
  });

  it("can't change anything", async () => {
    await expect(
      createTask(db, { orgId, actorUserId: clientId, role: 'client', input: { projectId: sharedProjectId, title: 'Sneaky', status: 'todo', priority: 'low' } })
    ).rejects.toThrow(/not permitted/);
    await expect(
      createDoc(db, { orgId, actorUserId: clientId, role: 'client', input: { nodeId: sharedProjectId, title: 'Sneaky', bodyMd: '' } })
    ).rejects.toThrow(/not permitted/);
  });

  it("sees activity only on their projects, and not the member list", async () => {
    await expect(getOrganizationMembers(db, orgId, clientId)).rejects.toThrow(/Clients cannot/);
    const targets = async (userId: string, role: string) =>
      (await tenantSql(sql, { orgId, userId, role })<{ target: string }[]>`SELECT target_id AS target FROM activity_log`).map((r) => r.target);
    expect((await targets(ownerId, 'owner')).length).toBeGreaterThan(1);
    expect(await targets(clientId, 'client')).toEqual([sharedDocId]);
    const [meetingsSeen] = await tenantSql(sql, { orgId, userId: clientId, role: 'client' })<{ n: number }[]>`SELECT count(*)::int AS n FROM meetings`;
    expect(meetingsSeen!.n).toBe(0);
  });

  it('only Owners and Managers decide which projects a client sees', async () => {
    await expect(
      addNodeMember(db, { orgId, nodeId: otherProjectId, targetUserId: clientId, actorUserId: developerId, role: 'member' })
    ).rejects.toThrow(/Only Owners and Managers/);
    await expect(
      addNodeMember(db, { orgId, nodeId: otherProjectId, targetUserId: developerId, actorUserId: clientId, role: 'client' })
    ).rejects.toThrow(/cannot change who is on a project/);
  });
});
