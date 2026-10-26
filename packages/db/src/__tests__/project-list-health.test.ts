import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../schema/index.js';
import { findOrCreateUserByEmail, createOrganizationWithOwner } from '../auth-operations.js';
import { createNode, listProjects } from '../node-operations.js';
import { createTask, updateTask } from '../task-operations.js';

// Task changes only mark a project dirty; the worker recomputes health later. Lists (sidebar, Home, project
// header) must still show current health when no worker runs, as on a web-only Vercel deployment.
describe('listProjects health without a worker (Real PostgreSQL)', () => {
  const directUrl =
    process.env.DATABASE_DIRECT_URL ||
    'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev?sslmode=disable';

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let orgId: string;
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    sql = postgres(directUrl, { max: 5 });
    db = drizzle(sql, { schema });
    const stamp = Date.now();
    const user = await findOrCreateUserByEmail(db, { email: `list-health-${stamp}@workspace.dev`, name: 'List Health' });
    userId = user.id;
    const { org } = await createOrganizationWithOwner(db, { name: 'List Health Org', slug: `list-health-${stamp}`, userId });
    orgId = org.id;
    const owner = { orgId, userId, role: 'owner' };
    const team = await createNode(db, { ...owner, name: 'General', kind: 'team' });
    const project = await createNode(db, { ...owner, name: 'Website', kind: 'project', parentId: team.id });
    projectId = project.id;
  });

  afterAll(async () => {
    if (orgId) await sql`DELETE FROM orgs WHERE id = ${orgId}`;
    await sql.end({ timeout: 5 });
  });

  const health = async () => {
    const { projects } = await listProjects(db, { orgId, userId, role: 'owner' });
    const rollup = projects.find((p) => p.id === projectId)?.rollup as { health: string; tasks: { total: number; inProgress: number } };
    return { health: rollup.health, total: rollup.tasks.total, inProgress: rollup.tasks.inProgress };
  };

  it('reflects a new task straight away', async () => {
    expect((await health()).health).toBe('no_tasks');

    const task = await createTask(db, { orgId, actorUserId: userId, role: 'owner', input: { projectId, title: 'Draft sitemap', status: 'todo', priority: 'medium' } });
    expect(await health()).toMatchObject({ total: 1, inProgress: 0 });
    expect((await health()).health).not.toBe('no_tasks');

    await updateTask(db, { orgId, actorUserId: userId, role: 'owner', taskId: task.id, ifMatchVersion: task.version, input: { status: 'in_progress' } });
    expect(await health()).toMatchObject({ total: 1, inProgress: 1 });
  });
});
