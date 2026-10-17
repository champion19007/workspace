import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import postgres from 'postgres';
import { NotFoundError, parseConfig, signInternalApiRequest } from '@workspace/core';
import { seedTestFixtures, cleanTestFixtures, FIXTURE_IDS } from '@workspace/db';
import { buildServer, type ServerInstance } from '../server.js';

// Deliberately broken data access: these stand-ins for real operations omit the org filter, the
// application-level check that normally keeps one organization's ids out of another's requests. The tests
// below prove that row-level security alone still confines them to the requesting organization.
vi.mock('@workspace/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workspace/db')>();
  return {
    ...actual,
    getTaskById: async (db: postgres.Sql, p: { orgId: string; taskId: string; userId: string; role: string }) => {
      const [task] = await actual.tenantSql(db, { orgId: p.orgId, userId: p.userId, role: p.role })<
        Array<{ id: string; orgId: string; title: string; version: number }>
      >`SELECT id, org_id AS "orgId", title, version FROM tasks WHERE id = ${p.taskId}`;
      if (!task) throw new NotFoundError(`Task "${p.taskId}" not found`);
      return task;
    },
    deleteLabel: async (db: postgres.Sql, p: { orgId: string; role: string; labelId: string }) => {
      await actual.tenantSql(db, { orgId: p.orgId, role: p.role })`DELETE FROM labels WHERE id = ${p.labelId}`;
    },
  };
});

/**
 * Stage 17b: the real API, connected as the restricted login role `workspace_api` (not superuser, no
 * BYPASSRLS, no table privileges of its own), serves tenant requests under RLS.
 */
const ADMIN_DB_URL =
  process.env['DATABASE_MIGRATION_URL'] ??
  'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev';
const API_DB_URL =
  process.env['DATABASE_API_URL'] ??
  'postgresql://workspace_api:workspace_api_dev_password@localhost:5432/workspace_dev';

const { orgs, users, tasks } = FIXTURE_IDS;
const EMAILS: Record<string, string> = {
  [users.userAOwner]: 'owner@acme.corp',
  [users.userAMember]: 'member@acme.corp',
  [users.userBOwner]: 'owner@stark.corp',
  [users.userCross]: 'cross@consultant.corp',
};

describe('Stage 17b: the API under the restricted login role', () => {
  const secret = 'test-origin-verify-secret-token-16-chars';
  let server: ServerInstance;
  let admin: postgres.Sql;

  beforeAll(async () => {
    admin = postgres(ADMIN_DB_URL, { max: 1 });
    await seedTestFixtures(admin);
    server = buildServer(
      parseConfig({
        DATABASE_URL: API_DB_URL,
        DATABASE_DIRECT_URL: API_DB_URL,
        ORIGIN_VERIFY_SECRET: secret,
        PORT: 8117,
        QUEUE_PROVIDER: 'in_memory',
        REALTIME_PROVIDER: 'in_memory',
        LLM_PROVIDER: 'mock',
        STORAGE_PROVIDER: 'in_memory',
        AUTH_PROVIDER: 'mock',
      })
    );
    await server.app.ready();
  });

  afterAll(async () => {
    await server?.close();
    if (admin) {
      await cleanTestFixtures(admin);
      await admin.end({ timeout: 5 });
    }
  });

  const as = (userId: string) => {
    const timestamp = Date.now();
    return {
      'x-workspace-user-id': userId,
      'x-workspace-user-email': EMAILS[userId]!,
      'x-workspace-timestamp': timestamp.toString(),
      'x-workspace-signature': signInternalApiRequest({ userId, email: EMAILS[userId]!, timestamp }, secret),
    };
  };

  it('connects as workspace_api, which is neither superuser nor BYPASSRLS', async () => {
    const [role] = await server.sql<Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    expect(role).toEqual({ current_user: 'workspace_api', rolsuper: false, rolbypassrls: false });
  });

  it('serves org bootstrap and tenant reads on the restricted login', async () => {
    const mine = await server.app.inject({ method: 'GET', url: '/api/v1/user/orgs', headers: as(users.userCross) });
    expect(mine.statusCode).toBe(200);
    expect(JSON.stringify(mine.json())).toContain(orgs.orgA);
    expect(JSON.stringify(mine.json())).toContain(orgs.orgB);

    const members = await server.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/acme-corp/members`,
      headers: as(users.userAOwner),
    });
    expect(members.statusCode).toBe(200);
    expect(JSON.stringify(members.json())).toContain('member@acme.corp');

    const outsider = await server.app.inject({ method: 'GET', url: `/api/v1/orgs/acme-corp/members`, headers: as(users.userBOwner) });
    expect(outsider.statusCode).toBe(403);
    const unknown = await server.app.inject({ method: 'GET', url: `/api/v1/orgs/no-such-org/members`, headers: as(users.userBOwner) });
    expect(unknown.statusCode).toBe(404);

    const own = await server.app.inject({ method: 'GET', url: `/api/v1/orgs/acme-corp/tasks/${tasks.taskAPublic}`, headers: as(users.userAOwner) });
    expect(own.statusCode).toBe(200);
    expect(own.json().id).toBe(tasks.taskAPublic);
  });

  it('keeps another organization\'s row out of a request whose data access lost its org filter', async () => {
    // Without RLS the broken lookup would find it: the row exists and the query does not filter by org.
    expect(await admin`SELECT id FROM tasks WHERE id = ${tasks.taskBPublic}`).toHaveLength(1);

    const res = await server.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/acme-corp/tasks/${tasks.taskBPublic}`,
      headers: as(users.userAOwner),
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('Nanotech Fusion Core');
  });

  it('keeps a write from reaching another organization when the org filter is missing', async () => {
    const [label] = await admin<Array<{ id: string }>>`
      INSERT INTO labels (org_id, name) VALUES (${orgs.orgB}, 'stark-only') RETURNING id
    `;
    const res = await server.app.inject({
      method: 'DELETE',
      url: `/api/v1/orgs/acme-corp/labels/${label!.id}`,
      headers: as(users.userAOwner),
    });
    expect(res.statusCode).toBe(200);
    expect(await admin`SELECT id FROM labels WHERE id = ${label!.id}`).toHaveLength(1);
  });

  it('applies private-project visibility per user, even through the broken lookup', async () => {
    const hidden = await server.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/acme-corp/tasks/${tasks.taskAPrivate}`,
      headers: as(users.userAMember),
    });
    expect(hidden.statusCode).toBe(404);

    const visible = await server.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/acme-corp/tasks/${tasks.taskAPrivate}`,
      headers: as(users.userCross),
    });
    expect(visible.statusCode).toBe(200);
  });
});
