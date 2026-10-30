import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../schema/index.js';
import { findOrCreateUserByEmail, createOrganizationWithOwner } from '../auth-operations.js';
import { createNode, addNodeMember } from '../node-operations.js';
import { getTaskById } from '../task-operations.js';
import { listNotifications } from '../comment-operations.js';
import {
  decideRequest,
  getPublicRequestForm,
  listRequests,
  saveRequestForm,
  submitPublicRequest,
} from '../request-operations.js';

// Request forms (0019): anyone with the link sends a request; the team accepts it as a task or declines it.
describe('request forms (Real PostgreSQL)', () => {
  const directUrl =
    process.env.DATABASE_DIRECT_URL ||
    'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev?sslmode=disable';

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let orgId: string;
  let ownerId: string;
  let developerId: string;
  let clientId: string;
  let projectId: string;
  let token: string;
  const as = (userId: string, role: string) => ({ orgId, userId, role });
  const send = (title: string) => submitPublicRequest(sql, token, { title, details: 'By Friday please', name: 'Dana', email: 'dana@client.example' });

  beforeAll(async () => {
    sql = postgres(directUrl, { max: 5 });
    db = drizzle(sql, { schema });
    const stamp = Date.now();
    const mk = (who: string) => findOrCreateUserByEmail(db, { email: `requests-${who}-${stamp}@workspace.dev`, name: who });
    [ownerId, developerId, clientId] = [(await mk('Owner')).id, (await mk('Dev')).id, (await mk('Client')).id];
    const { org } = await createOrganizationWithOwner(db, { name: 'Requests Org', slug: `requests-${stamp}`, userId: ownerId });
    orgId = org.id;
    await sql`INSERT INTO memberships (org_id, user_id, role) VALUES (${orgId}, ${developerId}, 'member'), (${orgId}, ${clientId}, 'client')`;
    const asOwner = { orgId, userId: ownerId, role: 'owner' };
    const team = await createNode(db, { ...asOwner, name: 'Delivery', kind: 'team' });
    projectId = (await createNode(db, { ...asOwner, name: 'Acme website', kind: 'project', parentId: team.id })).id;
    await addNodeMember(db, { orgId, nodeId: projectId, targetUserId: clientId, actorUserId: ownerId, role: 'owner' });
  });

  afterAll(async () => {
    if (orgId) await sql`DELETE FROM orgs WHERE id = ${orgId}`;
    await sql.end({ timeout: 5 });
  });

  it('takes requests from anyone with the link, and tells the Owners and the form creator', async () => {
    const form = await saveRequestForm(db, { orgId, actorUserId: developerId, role: 'member', nodeId: projectId, enabled: true, intro: 'We reply in 2 days' });
    token = form.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(await getPublicRequestForm(sql, token)).toEqual({ orgName: 'Requests Org', projectName: 'Acme website', intro: 'We reply in 2 days' });

    expect(await send('New landing page')).toMatch(/^[0-9a-f-]{36}$/);
    for (const [userId, role] of [[ownerId, 'owner'], [developerId, 'member']] as const) {
      const { notifications } = await listNotifications(db, as(userId, role));
      expect(notifications.map((n) => [n.kind, n.title, n.href])).toEqual([
        ['request', 'New request: New landing page', `/orgs/${orgId}/inbox?tab=requests`],
      ]);
    }
    expect((await listNotifications(db, as(clientId, 'client'))).notifications).toEqual([]);
    expect(await getPublicRequestForm(sql, 'no-such-token-at-all-000')).toBeNull();
  });

  it('keeps requests away from clients', async () => {
    expect((await listRequests(db, { ...as(developerId, 'member'), status: 'new' })).map((r) => r.title)).toEqual(['New landing page']);
    expect(await listRequests(db, { ...as(clientId, 'client'), status: 'new' })).toEqual([]);
    await expect(
      saveRequestForm(db, { orgId, actorUserId: clientId, role: 'client', nodeId: projectId, enabled: false, intro: '' })
    ).rejects.toThrow(/cannot change request forms/);
  });

  it('turns an accepted request into a task, once', async () => {
    const [request] = await listRequests(db, { ...as(ownerId, 'owner'), status: 'new' });
    const accepted = await decideRequest(db, { orgId, actorUserId: ownerId, role: 'owner', requestId: request!.id, decision: 'accept' });
    expect(accepted.status).toBe('accepted');
    const task = await getTaskById(db, { ...as(ownerId, 'owner'), taskId: accepted.taskId! });
    expect([task.title, task.projectId, accepted.taskKey]).toEqual(['New landing page', projectId, task.key]);
    expect(task.description).toBe('By Friday please\n\nRequested by Dana (dana@client.example) through the request form.');
    await expect(
      decideRequest(db, { orgId, actorUserId: developerId, role: 'member', requestId: request!.id, decision: 'decline' })
    ).rejects.toThrow(/already decided/);
  });

  it('stops taking requests when the form is switched off', async () => {
    await send('Spam me');
    const [spam] = await listRequests(db, { ...as(ownerId, 'owner'), status: 'new' });
    expect((await decideRequest(db, { orgId, actorUserId: ownerId, role: 'owner', requestId: spam!.id, decision: 'decline' })).taskId).toBeNull();

    const off = await saveRequestForm(db, { orgId, actorUserId: ownerId, role: 'owner', nodeId: projectId, enabled: false, intro: '' });
    expect(off.token).toBe(token);
    expect(await getPublicRequestForm(sql, token)).toBeNull();
    expect(await send('Anyone there?')).toBeNull();
  });
});
