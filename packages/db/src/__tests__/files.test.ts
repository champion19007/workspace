import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../schema/index.js';
import { findOrCreateUserByEmail, createOrganizationWithOwner } from '../auth-operations.js';
import { createNode, addNodeMember } from '../node-operations.js';
import { createTask, updateTask } from '../task-operations.js';
import { createFile, deleteFile, getFileForDownload, listFiles } from '../file-operations.js';

// Files follow their project (0018): clients see a shared project's files but never task attachments.
describe('files and start dates (Real PostgreSQL)', () => {
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
  let taskId: string;
  const stored: string[] = [];
  const store = async (key: string) => {
    stored.push(key);
  };
  const as = (userId: string, role: string) => ({ orgId, userId, role });
  const upload = (userId: string, role: string, name: string, onTask = false) =>
    createFile(
      db,
      { orgId, actorUserId: userId, role, nodeId: projectId, taskId: onTask ? taskId : null, name, contentType: 'application/pdf', sizeBytes: 10 },
      store
    );

  beforeAll(async () => {
    sql = postgres(directUrl, { max: 5 });
    db = drizzle(sql, { schema });
    const stamp = Date.now();
    const mk = (who: string) => findOrCreateUserByEmail(db, { email: `files-${who}-${stamp}@workspace.dev`, name: who });
    [ownerId, developerId, clientId] = [(await mk('Owner')).id, (await mk('Dev')).id, (await mk('Client')).id];
    const { org } = await createOrganizationWithOwner(db, { name: 'Files Org', slug: `files-${stamp}`, userId: ownerId });
    orgId = org.id;
    await sql`INSERT INTO memberships (org_id, user_id, role) VALUES (${orgId}, ${developerId}, 'member'), (${orgId}, ${clientId}, 'client')`;
    const asOwner = { orgId, userId: ownerId, role: 'owner' };
    const team = await createNode(db, { ...asOwner, name: 'Delivery', kind: 'team' });
    projectId = (await createNode(db, { ...asOwner, name: 'Acme website', kind: 'project', parentId: team.id })).id;
    taskId = (await createTask(db, { orgId, actorUserId: ownerId, role: 'owner', input: { projectId, title: 'Logo', status: 'todo', priority: 'medium' } })).id;
    await addNodeMember(db, { orgId, nodeId: projectId, targetUserId: clientId, actorUserId: ownerId, role: 'owner' });
  });

  afterAll(async () => {
    if (orgId) await sql`DELETE FROM orgs WHERE id = ${orgId}`;
    await sql.end({ timeout: 5 });
  });

  it('stores project files and task attachments under keys the app chooses', async () => {
    const brief = await upload(ownerId, 'owner', 'Brief.pdf');
    const logo = await upload(developerId, 'member', 'Logo draft.pdf', true);
    expect(stored).toEqual([`orgs/${orgId}/files/${brief.id}`, `orgs/${orgId}/files/${logo.id}`]);
    expect(logo.taskLabel).toMatch(/ Logo$/);

    const names = async (userId: string, role: string, q: { nodeId?: string; taskId?: string }) =>
      (await listFiles(db, { ...as(userId, role), ...q })).map((f) => f.name).sort();
    expect(await names(developerId, 'member', { nodeId: projectId })).toEqual(['Brief.pdf', 'Logo draft.pdf']);
    expect(await names(developerId, 'member', { taskId })).toEqual(['Logo draft.pdf']);
    // Clients see what the team shared on the project, not the attachments on its tasks.
    expect(await names(clientId, 'client', { nodeId: projectId })).toEqual(['Brief.pdf']);
    await expect(getFileForDownload(db, { ...as(clientId, 'client'), fileId: logo.id })).rejects.toThrow(/not found/);
    expect((await getFileForDownload(db, { ...as(clientId, 'client'), fileId: brief.id })).storageKey).toBe(stored[0]);
  });

  it("doesn't let clients upload, and leaves no row behind when storing fails", async () => {
    await expect(upload(clientId, 'client', 'Sneaky.pdf')).rejects.toThrow(/cannot upload/);
    await expect(
      createFile(db, { orgId, actorUserId: ownerId, role: 'owner', nodeId: projectId, name: 'Broken.pdf', contentType: 'application/pdf', sizeBytes: 1 }, async () => {
        throw new Error('storage is down');
      })
    ).rejects.toThrow(/storage is down/);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM files WHERE org_id = ${orgId} AND name = 'Broken.pdf'`;
    expect(n).toBe(0);
  });

  it('lets the uploader, an Owner or a Manager delete a file', async () => {
    const mine = await upload(ownerId, 'owner', 'Contract.pdf');
    await expect(deleteFile(db, { orgId, actorUserId: developerId, role: 'member', fileId: mine.id })).rejects.toThrow(/Only the person/);
    expect((await deleteFile(db, { orgId, actorUserId: ownerId, role: 'owner', fileId: mine.id })).storageKey).toContain(mine.id);
    expect((await listFiles(db, { ...as(ownerId, 'owner'), nodeId: projectId })).map((f) => f.name)).not.toContain('Contract.pdf');
  });

  it('keeps a start date on or before the due date', async () => {
    const task = await createTask(db, {
      orgId,
      actorUserId: ownerId,
      role: 'owner',
      input: { projectId, title: 'Launch', status: 'todo', priority: 'high', startDate: '2026-11-02', dueDate: '2026-11-06' },
    });
    expect([task.startDate, task.dueDate]).toEqual(['2026-11-02', '2026-11-06']);
    await expect(
      updateTask(db, { orgId, taskId: task.id, actorUserId: ownerId, role: 'owner', ifMatchVersion: task.version, input: { startDate: '2026-11-09' } })
    ).rejects.toThrow(/start date must be on or before/);
    const moved = await updateTask(db, {
      orgId,
      taskId: task.id,
      actorUserId: ownerId,
      role: 'owner',
      ifMatchVersion: task.version,
      input: { startDate: '2026-11-09', dueDate: '2026-11-13' },
    });
    expect([moved.startDate, moved.dueDate]).toEqual(['2026-11-09', '2026-11-13']);
  });
});
