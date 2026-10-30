import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../schema/index.js';
import { findOrCreateUserByEmail, createOrganizationWithOwner } from '../auth-operations.js';
import { createNode, addNodeMember } from '../node-operations.js';
import { createTask } from '../task-operations.js';
import { createDoc } from '../doc-operations.js';
import {
  createComment,
  deleteComment,
  insertNotifications,
  listComments,
  listMentionableUsers,
  listNotifications,
  markNotificationsRead,
} from '../comment-operations.js';
import { tenantSql } from '../client.js';

// Comments follow what they are about (0017): task comments are the team's, project discussions and doc
// comments include the clients a project is shared with, and notifications are private to their recipient.
describe('comments and notifications (Real PostgreSQL)', () => {
  const directUrl =
    process.env.DATABASE_DIRECT_URL ||
    'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev?sslmode=disable';

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let orgId: string;
  let ownerId: string;
  let developerId: string;
  let clientId: string;
  let otherClientId: string;
  let sharedProjectId: string;
  let otherProjectId: string;
  let taskId: string;
  let docId: string;
  const as = (userId: string, role: string) => ({ orgId, userId, role });

  beforeAll(async () => {
    sql = postgres(directUrl, { max: 5 });
    db = drizzle(sql, { schema });
    const stamp = Date.now();
    const mk = (who: string) => findOrCreateUserByEmail(db, { email: `comments-${who}-${stamp}@workspace.dev`, name: who });
    [ownerId, developerId, clientId, otherClientId] = [
      (await mk('Owner')).id,
      (await mk('Dev')).id,
      (await mk('Client')).id,
      (await mk('Other client')).id,
    ];
    const { org } = await createOrganizationWithOwner(db, { name: 'Comments Org', slug: `comments-${stamp}`, userId: ownerId });
    orgId = org.id;
    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${orgId}, ${developerId}, 'member'), (${orgId}, ${clientId}, 'client'), (${orgId}, ${otherClientId}, 'client')
    `;

    const asOwner = { orgId, userId: ownerId, role: 'owner' };
    const team = await createNode(db, { ...asOwner, name: 'Delivery', kind: 'team' });
    sharedProjectId = (await createNode(db, { ...asOwner, name: 'Acme website', kind: 'project', parentId: team.id })).id;
    otherProjectId = (await createNode(db, { ...asOwner, name: 'Globex app', kind: 'project', parentId: team.id })).id;
    taskId = (
      await createTask(db, { orgId, actorUserId: ownerId, role: 'owner', input: { projectId: sharedProjectId, title: 'Hero image', status: 'todo', priority: 'medium' } })
    ).id;
    docId = (await createDoc(db, { orgId, actorUserId: ownerId, role: 'owner', input: { nodeId: sharedProjectId, title: 'Brief', bodyMd: '' } })).id;
    await addNodeMember(db, { orgId, nodeId: sharedProjectId, targetUserId: clientId, actorUserId: ownerId, role: 'owner' });
    await addNodeMember(db, { orgId, nodeId: otherProjectId, targetUserId: otherClientId, actorUserId: ownerId, role: 'owner' });
  });

  afterAll(async () => {
    if (orgId) await sql`DELETE FROM orgs WHERE id = ${orgId}`;
    await sql.end({ timeout: 5 });
  });

  const comment = (userId: string, role: string, targetType: 'task' | 'node' | 'doc', targetId: string, bodyMd: string, mentions: string[] = []) =>
    createComment(db, { orgId, actorUserId: userId, role, input: { targetType, targetId, bodyMd, mentions } });

  it('keeps task comments inside the team', async () => {
    const posted = await comment(developerId, 'member', 'task', taskId, 'Draft is ready @Client', [clientId]);
    // A client can't be mentioned on a task: they would never be able to read it.
    expect(posted.mentions).toEqual([]);
    expect((await listComments(db, { ...as(ownerId, 'owner'), targetType: 'task', targetId: taskId })).map((c) => c.bodyMd)).toEqual([
      'Draft is ready @Client',
    ]);

    await expect(listComments(db, { ...as(clientId, 'client'), targetType: 'task', targetId: taskId })).rejects.toThrow(/does not exist/);
    await expect(comment(clientId, 'client', 'task', taskId, 'Can I see this?')).rejects.toThrow(/does not exist/);
    const [seen] = await tenantSql(sql, as(clientId, 'client'))<{ n: number }[]>`SELECT count(*)::int AS n FROM comments`;
    expect(seen!.n).toBe(0);
  });

  it('lets clients join the discussion on projects shared with them, and nowhere else', async () => {
    await comment(clientId, 'client', 'node', sharedProjectId, 'Can we launch on Friday?');
    await comment(clientId, 'client', 'doc', docId, 'Looks good');
    await comment(ownerId, 'owner', 'node', sharedProjectId, 'Yes, Friday works @Client', [clientId]);

    const thread = await listComments(db, { ...as(clientId, 'client'), targetType: 'node', targetId: sharedProjectId });
    expect(thread.map((c) => [c.author.name, c.bodyMd])).toEqual([
      ['Client', 'Can we launch on Friday?'],
      ['Owner', 'Yes, Friday works @Client'],
    ]);
    expect(thread[1]!.mentions).toEqual([{ id: clientId, name: 'Client' }]);
    expect(thread.map((c) => c.canDelete)).toEqual([true, false]);

    await expect(comment(clientId, 'client', 'node', otherProjectId, 'Hello?')).rejects.toThrow(/does not exist/);
    // The other project's client can't read this project's discussion.
    await expect(listComments(db, { ...as(otherClientId, 'client'), targetType: 'node', targetId: sharedProjectId })).rejects.toThrow();
  });

  it('only offers to @mention people who can read the comment', async () => {
    const names = async (userId: string, role: string, targetType: 'task' | 'node', targetId: string) =>
      (await listMentionableUsers(db, { ...as(userId, role), targetType, targetId })).map((p) => p.name);

    expect(await names(developerId, 'member', 'node', sharedProjectId)).toEqual(['Client', 'Owner']);
    expect(await names(developerId, 'member', 'task', taskId)).toEqual(['Owner']);
    // Clients can mention the team, never another client.
    expect(await names(clientId, 'client', 'node', sharedProjectId)).toEqual(['Dev', 'Owner']);
  });

  it('lets authors delete their own comments, and Owners and Managers delete any', async () => {
    const mine = await comment(developerId, 'member', 'doc', docId, 'Typo in line 2');
    const theirs = await comment(ownerId, 'owner', 'doc', docId, 'Fixed');
    await expect(deleteComment(db, { orgId, actorUserId: developerId, role: 'member', commentId: theirs.id })).rejects.toThrow(/own comments/);
    await deleteComment(db, { orgId, actorUserId: developerId, role: 'member', commentId: mine.id });
    await deleteComment(db, { orgId, actorUserId: ownerId, role: 'owner', commentId: theirs.id });
    const left = await listComments(db, { ...as(ownerId, 'owner'), targetType: 'doc', targetId: docId });
    expect(left.map((c) => c.bodyMd)).toEqual(['Looks good']);
  });

  it('tells the right people about comments, and shows each notification only to its recipient', async () => {
    const titles = async (userId: string, role: string) =>
      (await listNotifications(db, as(userId, role))).notifications.map((n) => n.title);
    // From the comments above: the client asked on the project, the owner answered and mentioned them.
    expect(await titles(ownerId, 'owner')).toContain('Client commented on Acme website');
    expect(await titles(clientId, 'client')).toContain('Owner mentioned you on Acme website');
    // Task comments never reach clients, even when they were @mentioned.
    expect((await titles(clientId, 'client')).some((t) => t.includes('Hero image'))).toBe(false);
    expect((await titles(ownerId, 'owner')).some((t) => t.startsWith('Dev commented on') && t.endsWith('Hero image'))).toBe(true);

    const note = { kind: 'mention' as const, title: 'Owner pinged you', body: 'Hi', href: `/orgs/${orgId}` };
    await tenantSql(sql, as(ownerId, 'owner')).begin(async (tx) => {
      await insertNotifications(tx, orgId, [{ ...note, userId: clientId, dedupeKey: 'test:1' }]);
      // A repeat with the same key is ignored, even though the sender can't see the first one.
      await insertNotifications(tx, orgId, [{ ...note, userId: clientId, dedupeKey: 'test:1' }]);
    });
    expect((await titles(clientId, 'client')).filter((t) => t === 'Owner pinged you')).toHaveLength(1);
    expect(await titles(ownerId, 'owner')).not.toContain('Owner pinged you');
    const [peek] = await tenantSql(sql, as(ownerId, 'owner'))<{ n: number }[]>`SELECT count(*)::int AS n FROM notifications`;
    expect(peek!.n).toBe((await titles(ownerId, 'owner')).length);

    await markNotificationsRead(db, as(clientId, 'client'));
    expect((await listNotifications(db, as(clientId, 'client'))).unreadCount).toBe(0);
  });
});
