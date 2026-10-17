import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import {
  createApiClient,
  createWorkerClient,
  tenantSql,
  withTenantContext,
  seedTestFixtures,
  cleanTestFixtures,
  FIXTURE_IDS,
  type TenantContext,
} from '../index.js';

/**
 * Stage 17b: the application runs under the restricted login roles of migration 0015 and every tenant
 * statement is executed under an RLS-enforced role (ADR "17b — Runtime RLS enforcement").
 */
const ADMIN_DB_URL =
  process.env['DATABASE_MIGRATION_URL'] ??
  'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev?sslmode=disable';
const API_DB_URL =
  process.env['DATABASE_API_URL'] ??
  'postgresql://workspace_api:workspace_api_dev_password@localhost:5432/workspace_dev?sslmode=disable';
const WORKER_DB_URL =
  process.env['DATABASE_WORKER_URL'] ??
  'postgresql://workspace_worker:workspace_worker_dev_password@localhost:5432/workspace_dev?sslmode=disable';

const { orgs, users, tasks } = FIXTURE_IDS;
const memberA: TenantContext = { orgId: orgs.orgA, userId: users.userAMember, role: 'member' };

describe('Stage 17b runtime RLS enforcement', () => {
  let admin: postgres.Sql;
  let api: ReturnType<typeof createApiClient>;
  let worker: ReturnType<typeof createWorkerClient>;

  beforeAll(async () => {
    admin = postgres(ADMIN_DB_URL, { max: 1 });
    await seedTestFixtures(admin);
    api = createApiClient({ connectionString: API_DB_URL, maxConnections: 1 });
    worker = createWorkerClient({ connectionString: WORKER_DB_URL, maxConnections: 1 });
  });

  afterAll(async () => {
    await api?.sql.end({ timeout: 5 });
    await worker?.sql.end({ timeout: 5 });
    if (admin) {
      await cleanTestFixtures(admin);
      await admin.end({ timeout: 5 });
    }
  });

  describe('role model', () => {
    it('runs on login roles that are neither superuser nor BYPASSRLS and hold no table privileges', async () => {
      const roles = await admin<Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolinherit: boolean; rolcanlogin: boolean }>>`
        SELECT rolname, rolsuper, rolbypassrls, rolinherit, rolcanlogin FROM pg_roles
        WHERE rolname IN ('workspace_api', 'workspace_worker', 'workspace_app', 'workspace_system', 'workspace_definer')
        ORDER BY rolname
      `;
      expect(roles.map((r) => r.rolname)).toEqual([
        'workspace_api', 'workspace_app', 'workspace_definer', 'workspace_system', 'workspace_worker',
      ]);
      for (const r of roles) {
        expect(r.rolsuper, r.rolname).toBe(false);
        expect(r.rolbypassrls, r.rolname).toBe(false);
      }
      const loginRoles = roles.filter((r) => r.rolcanlogin).map((r) => r.rolname);
      expect(loginRoles).toEqual(['workspace_api', 'workspace_worker']);
      expect(roles.filter((r) => r.rolcanlogin).every((r) => !r.rolinherit)).toBe(true);

      const [login] = await api.sql<Array<{ current_user: string }>>`SELECT current_user`;
      expect(login!.current_user).toBe('workspace_api');
      await expect(api.sql`SELECT count(*) FROM tasks`).rejects.toThrow(/permission denied for table tasks/);
      await expect(worker.sql`SELECT count(*) FROM meetings`).rejects.toThrow(/permission denied for table meetings/);
    });

    it('runs tenant statements as workspace_app with the org/user context set', async () => {
      const [row] = await tenantSql(api.sql, memberA)<Array<{ role: string; org: string; usr: string }>>`
        SELECT current_user AS role, current_setting('app.org_id') AS org, current_setting('app.user_id') AS usr
      `;
      expect(row).toEqual({ role: 'workspace_app', org: orgs.orgA, usr: users.userAMember });
    });

    it('only the worker login can assume workspace_system', async () => {
      const system: TenantContext = { orgId: orgs.orgA, system: true };
      await expect(tenantSql(api.sql, system)`SELECT 1`).rejects.toThrow(/permission denied to set role "workspace_system"/);
      const [row] = await tenantSql(worker.sql, system)<Array<{ role: string }>>`SELECT current_user AS role`;
      expect(row!.role).toBe('workspace_system');
    });

    it('leaves the pooled connection on the login role with no tenant settings, after success and after errors', async () => {
      const hygiene = () => api.sql<Array<{ role: string; org: string | null; usr: string | null }>>`
        SELECT current_user AS role, current_setting('app.org_id', true) AS org, current_setting('app.user_id', true) AS usr
      `;
      await tenantSql(api.sql, memberA)`SELECT 1`;
      expect((await hygiene())[0]).toMatchObject({ role: 'workspace_api' });
      expect((await hygiene())[0]!.org || null).toBeNull();
      expect((await hygiene())[0]!.usr || null).toBeNull();

      await expect(tenantSql(api.sql, memberA)`SELECT 1 / 0`).rejects.toThrow(/division by zero/);
      await expect(withTenantContext(api.sql, memberA, async (txn) => txn`SELECT 1 / 0`)).rejects.toThrow(/division by zero/);
      const [after] = await hygiene();
      expect(after!.role).toBe('workspace_api');
      expect(after!.org || null).toBeNull();
    });
  });

  describe('row-level security without application filters', () => {
    it('confines a statement that omits the org filter to the context organization', async () => {
      const scoped = tenantSql(api.sql, { orgId: orgs.orgA, userId: users.userAOwner, role: 'owner' });
      const rows = await scoped<Array<{ org_id: string; id: string }>>`SELECT org_id, id FROM tasks`;
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.org_id))).toEqual(new Set([orgs.orgA]));

      const updated = await scoped`UPDATE tasks SET title = title WHERE id = ${tasks.taskBPublic}`;
      expect(updated.count).toBe(0);
      const deleted = await scoped`DELETE FROM tasks WHERE id = ${tasks.taskBPublic}`;
      expect(deleted.count).toBe(0);
      await expect(
        scoped`INSERT INTO labels (org_id, name, color) VALUES (${orgs.orgB}, 'smuggled', '#000000')`
      ).rejects.toThrow(/row-level security/);
    });

    it('hides private-project rows from users outside the project, but not from the worker of that org', async () => {
      const member = await tenantSql(api.sql, memberA)<Array<{ id: string }>>`SELECT id FROM tasks`;
      expect(member.map((r) => r.id)).toContain(tasks.taskAPublic);
      expect(member.map((r) => r.id)).not.toContain(tasks.taskAPrivate);

      const system = await tenantSql(worker.sql, { orgId: orgs.orgA, system: true })<Array<{ id: string }>>`SELECT id FROM tasks`;
      expect(system.map((r) => r.id)).toEqual(expect.arrayContaining([tasks.taskAPublic, tasks.taskAPrivate]));
      expect(system.map((r) => r.id)).not.toContain(tasks.taskBPublic);
    });

    it('fails closed when no organization context is set', async () => {
      const rows = await api.sql.begin(async (txn) => {
        await txn`SELECT set_config('role', 'workspace_app', true)`;
        return txn<Array<{ n: number }>>`SELECT count(*)::int AS n FROM tasks`;
      });
      expect(rows[0]!.n).toBe(0);
    });
  });

  describe('narrowly privileged entry points (migration 0015)', () => {
    const EXPECTED_GRANTEES: Record<string, string[]> = {
      sys_auth_invitation_org: ['workspace_api'],
      sys_auth_org_membership: ['workspace_api'],
      sys_auth_upsert_user: ['workspace_api'],
      sys_auth_user_orgs: ['workspace_api'],
      sys_idempotency_purge: ['workspace_worker'],
      sys_meetings_pending_ready: ['workspace_worker'],
      sys_outbox_claim: ['workspace_worker'],
      sys_outbox_mark_delivered: ['workspace_worker'],
      sys_outbox_purge: ['workspace_worker'],
      sys_outbox_record_failure: ['workspace_worker'],
      sys_rollup_claim: ['workspace_worker'],
      sys_zoom_account_integration: ['workspace_api', 'workspace_worker'],
      sys_zoom_deauthorize: ['workspace_api', 'workspace_worker'],
      sys_zoom_integration_id_for_tenant: ['workspace_app'],
      sys_zoom_poll_orgs: ['workspace_worker'],
      sys_zoom_record_unmapped_event: ['workspace_api', 'workspace_worker'],
    };

    it('are exactly the documented SECURITY DEFINER functions, owned by workspace_definer, not executable by PUBLIC', async () => {
      const fns = await admin<
        Array<{ name: string; owner: string; config: string[] | null; grantees: string[] | null; is_public: boolean }>
      >`
        SELECT p.proname AS name, pg_get_userbyid(p.proowner) AS owner, p.proconfig AS config,
               (SELECT array_agg(r.rolname ORDER BY r.rolname) FROM aclexplode(p.proacl) a
                  JOIN pg_roles r ON r.oid = a.grantee
                 WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) AS grantees,
               COALESCE((SELECT bool_or(a.grantee = 0) FROM aclexplode(p.proacl) a), true) AS is_public
        FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
        ORDER BY p.proname
      `;
      expect(fns.map((f) => f.name)).toEqual(Object.keys(EXPECTED_GRANTEES));
      for (const fn of fns) {
        expect(fn.owner, fn.name).toBe('workspace_definer');
        expect(fn.is_public, fn.name).toBe(false);
        expect(fn.grantees, fn.name).toEqual(EXPECTED_GRANTEES[fn.name]);
        expect(fn.config, fn.name).toContain('search_path=public, pg_temp');
      }
      const [definer] = await admin<Array<{ members: number }>>`
        SELECT count(*)::int AS members FROM pg_auth_members WHERE roleid = 'workspace_definer'::regrole
      `;
      expect(definer!.members).toBe(0);
    });

    it('cannot be called from inside tenant transactions, nor by the other login role', async () => {
      await expect(tenantSql(api.sql, memberA)`SELECT * FROM sys_auth_user_orgs(${users.userAMember})`).rejects.toThrow(
        /permission denied for function sys_auth_user_orgs/
      );
      await expect(tenantSql(worker.sql, { orgId: orgs.orgA, system: true })`SELECT sys_outbox_purge(7)`).rejects.toThrow(
        /permission denied for function sys_outbox_purge/
      );
      await expect(api.sql`SELECT sys_outbox_purge(7)`).rejects.toThrow(/permission denied for function sys_outbox_purge/);
      await expect(worker.sql`SELECT * FROM sys_auth_user_orgs(${users.userAMember})`).rejects.toThrow(
        /permission denied for function sys_auth_user_orgs/
      );
    });

    it('sys_auth_org_membership: membership details only for members; outsiders learn only that the org exists', async () => {
      const [member] = await api.sql`SELECT * FROM sys_auth_org_membership('acme-corp', ${users.userAMember})`;
      expect(member).toMatchObject({ org_id: orgs.orgA, org_name: 'Acme Corporation', role: 'member' });
      const [outsider] = await api.sql`SELECT * FROM sys_auth_org_membership(${orgs.orgA}, ${users.userBOwner})`;
      expect(outsider).toMatchObject({ org_id: orgs.orgA, org_name: null, role: null, session_epoch: null });
      expect(await api.sql`SELECT * FROM sys_auth_org_membership('no-such-org', ${users.userAMember})`).toHaveLength(0);
    });

    it('sys_auth_user_orgs and sys_auth_invitation_org return only what was asked for', async () => {
      const cross = await api.sql<Array<{ org_id: string }>>`SELECT org_id FROM sys_auth_user_orgs(${users.userCross})`;
      expect(cross.map((r) => r.org_id).sort()).toEqual([orgs.orgA, orgs.orgB].sort());
      const [invite] = await api.sql<Array<{ org_id: string | null }>>`
        SELECT sys_auth_invitation_org('no-such-token-hash') AS org_id
      `;
      expect(invite!.org_id).toBeNull();
    });

    it('sys_auth_upsert_user links missing provider ids but never overwrites existing ones', async () => {
      const email = `rls-upsert-${Date.now()}@example.com`;
      const [created] = await api.sql`SELECT * FROM sys_auth_upsert_user(${'  ' + email.toUpperCase()}, 'First', 'sb-1', NULL)`;
      expect(created).toMatchObject({ email, name: 'First', supabase_uid: 'sb-1', cognito_sub: null });
      const [again] = await api.sql`SELECT * FROM sys_auth_upsert_user(${email}, 'Second', 'sb-2', 'cg-1')`;
      expect(again).toMatchObject({ id: created!.id, name: 'First', supabase_uid: 'sb-1', cognito_sub: 'cg-1' });
      await admin`DELETE FROM users WHERE id = ${created!.id}`;
    });

    it('worker maintenance entry points only touch rows they own or that are due', async () => {
      const [mine] = await admin<Array<{ id: string }>>`
        INSERT INTO outbox (org_id, topic, payload, locked_at, locked_by)
        VALUES (${orgs.orgA}, 'rls.probe', '{}'::jsonb, now(), 'worker-a') RETURNING id
      `;
      const [stale] = await admin<Array<{ id: string }>>`
        INSERT INTO outbox (org_id, topic, payload, sent_at)
        VALUES (${orgs.orgB}, 'rls.probe', '{}'::jsonb, now() - interval '30 days') RETURNING id
      `;
      const [pending] = await admin<Array<{ id: string }>>`
        INSERT INTO outbox (org_id, topic, payload, created_at)
        VALUES (${orgs.orgB}, 'rls.probe', '{}'::jsonb, now() - interval '30 days') RETURNING id
      `;
      const [wrongWorker] = await worker.sql`SELECT sys_outbox_mark_delivered(${mine!.id}, 'worker-b') AS ok`;
      expect(wrongWorker!.ok).toBe(false);
      const [rightWorker] = await worker.sql`SELECT sys_outbox_mark_delivered(${mine!.id}, 'worker-a') AS ok`;
      expect(rightWorker!.ok).toBe(true);

      await worker.sql`SELECT sys_outbox_purge(7)`;
      const left = await admin<Array<{ id: string }>>`
        SELECT id FROM outbox WHERE id IN ${admin([mine!.id, stale!.id, pending!.id])}
      `;
      expect(left.map((r) => r.id).sort()).toEqual([mine!.id, pending!.id].sort());

      const [expired] = await admin<Array<{ id: string }>>`
        INSERT INTO idempotency_keys (org_id, actor_id, key, operation, fingerprint, expires_at)
        VALUES (${orgs.orgA}, ${users.userAOwner}, ${'rls-expired-' + Date.now()}, 'probe', 'f', now() - interval '1 minute')
        RETURNING id
      `;
      const [live] = await admin<Array<{ id: string }>>`
        INSERT INTO idempotency_keys (org_id, actor_id, key, operation, fingerprint)
        VALUES (${orgs.orgA}, ${users.userAOwner}, ${'rls-live-' + Date.now()}, 'probe', 'f') RETURNING id
      `;
      await worker.sql`SELECT sys_idempotency_purge()`;
      const keys = await admin<Array<{ id: string }>>`
        SELECT id FROM idempotency_keys WHERE id IN ${admin([expired!.id, live!.id])}
      `;
      expect(keys.map((r) => r.id)).toEqual([live!.id]);
    });

    it('Zoom intake entry points expose only the account-to-organization mapping and identifiers', async () => {
      const account = `rls-acct-${Date.now()}`;
      await admin`
        INSERT INTO integrations (org_id, provider, account_id, secret_arn, status, installed_at)
        VALUES (${orgs.orgA}, 'zoom', ${account}, 'arn:rls', 'connected', now())
      `;
      const mapped = await api.sql<Array<Record<string, unknown>>>`SELECT * FROM sys_zoom_account_integration(${account})`;
      expect(mapped).toHaveLength(1);
      expect(Object.keys(mapped[0]!).sort()).toEqual(['connection_generation', 'id', 'org_id', 'status']);
      expect(mapped[0]!['org_id']).toBe(orgs.orgA);

      const pollOrgs = await worker.sql<Array<{ org_id: string }>>`SELECT sys_zoom_poll_orgs() AS org_id`;
      expect(pollOrgs.map((r) => r.org_id)).toContain(orgs.orgA);

      const ready = await worker.sql`SELECT * FROM sys_meetings_pending_ready(1)`;
      expect(ready.columns.map((c) => c.name)).toEqual([
        'id', 'org_id', 'provider_meeting_uuid', 'connection_generation', 'processing_generation',
      ]);

      // A receipt for a mapped account is never recorded as "unmapped" (it would mask a real delivery).
      await api.sql`SELECT sys_zoom_record_unmapped_event(${account}, 'recording.completed', 'evt-1', 'mtg-1')`;
      expect(await admin`SELECT 1 FROM zoom_webhook_events WHERE account_id = ${account}`).toHaveLength(0);

      // A deauthorization older than the current grant is ignored.
      const [stale] = await api.sql`
        SELECT * FROM sys_zoom_deauthorize(${account}, 'deauth-1', ${new Date(Date.now() - 3_600_000).toISOString()}, 'x')
      `;
      expect(stale!.outcome).toBe('ignored_stale_deauthorization');
      const [still] = await admin`SELECT status FROM integrations WHERE account_id = ${account}`;
      expect(still!.status).toBe('connected');

      // The tenant helper returns the caller's own integration id, and nothing for another organization.
      const [own] = await tenantSql(api.sql, memberA)`SELECT sys_zoom_integration_id_for_tenant() AS id`;
      expect(own!.id).toBe(mapped[0]!['id']);
      const [other] = await tenantSql(api.sql, { orgId: orgs.orgB, userId: users.userBOwner })`
        SELECT sys_zoom_integration_id_for_tenant() AS id
      `;
      expect(other!.id).toBeNull();
    });
  });

  describe('tenant-scoped client', () => {
    it('resolves a statement only after its transaction committed (read-your-writes across connections)', async () => {
      const scoped = tenantSql(api.sql, { orgId: orgs.orgA, userId: users.userAOwner, role: 'owner' });
      for (let i = 0; i < 20; i++) {
        const name = `rls-commit-${Date.now()}-${i}`;
        await scoped`INSERT INTO labels (org_id, name) VALUES (${orgs.orgA}, ${name})`;
        expect(await admin`SELECT 1 FROM labels WHERE org_id = ${orgs.orgA} AND name = ${name}`).toHaveLength(1);
      }
      await admin`DELETE FROM labels WHERE org_id = ${orgs.orgA} AND name LIKE 'rls-commit-%'`;
    });

    it('keeps statements usable as fragments, in scoped statements and inside its transactions', async () => {
      const scoped = tenantSql(api.sql, memberA);
      const filter = scoped`id = ${tasks.taskAPublic}`;
      const empty = scoped``;
      const direct = await scoped<Array<{ id: string }>>`SELECT id FROM tasks WHERE ${filter} ${empty}`;
      expect(direct.map((r) => r.id)).toEqual([tasks.taskAPublic]);

      const listed = await scoped<Array<{ id: string }>>`
        SELECT id FROM tasks WHERE id IN ${scoped([tasks.taskAPublic, tasks.taskBPublic])}
      `;
      expect(listed.map((r) => r.id)).toEqual([tasks.taskAPublic]);

      const inTxn = await scoped.begin(async (txn) => {
        const [ids] = await txn<Array<{ a: string; b: string }>>`SELECT txid_current()::text AS a, current_user AS b`;
        const [again] = await txn<Array<{ a: string }>>`SELECT txid_current()::text AS a`;
        const rows = await txn<Array<{ id: string }>>`SELECT id FROM tasks WHERE ${filter}`;
        return { same: ids!.a === again!.a, role: ids!.b, rows: rows.map((r) => r.id) };
      });
      expect(inTxn).toEqual({ same: true, role: 'workspace_app', rows: [tasks.taskAPublic] });
    });

    it('lets nested operations inherit their caller binding and refuses another org or user', async () => {
      const scoped = tenantSql(api.sql, memberA);
      expect(tenantSql(scoped, memberA)).toBe(scoped);
      expect(tenantSql(scoped, { orgId: orgs.orgA })).toBe(scoped);
      expect(() => tenantSql(scoped, { orgId: orgs.orgB })).toThrow(/Tenant scope mismatch/);
      expect(() => tenantSql(scoped, { orgId: orgs.orgA, userId: users.userAOwner })).toThrow(/Tenant scope mismatch/);

      const system = tenantSql(worker.sql, { orgId: orgs.orgA, system: true });
      expect(tenantSql(system, memberA)).toBe(system);

      const nested = await withTenantContext(api.sql, memberA, async (txn) => {
        expect(tenantSql(txn, memberA)).toBe(txn);
        return withTenantContext(txn, { orgId: orgs.orgA }, async (inner) => inner === txn);
      });
      expect(nested).toBe(true);
    });

    it('relies on postgres.js Query internals that still exist', () => {
      // Statements are native promises (awaited through Promise.prototype.then) executed via their `handler`.
      const query = api.sql`SELECT 1`;
      expect(query).toBeInstanceOf(Promise);
      expect(typeof (query as unknown as Record<string, unknown>)['handler']).toBe('function');
    });
  });
});
