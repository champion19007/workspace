import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { generateUuidV7 } from '@workspace/core';
import { withTenantContext, type TenantContext } from '../client.js';
import { decideActionItem } from '../approval-operations.js';

/**
 * Stage 17: action_items / action_item_decisions under the restricted runtime role `workspace_app`
 * (RLS enabled + forced). Proves the RESTRICTIVE private-project policies, the append-only grants,
 * and that the full decision path runs with the runtime role's privileges.
 */
const ADMIN_DB_URL =
  process.env['DATABASE_DIRECT_URL'] ??
  'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev?sslmode=disable';
const APP_DB_URL =
  process.env['DATABASE_APP_URL'] ??
  'postgresql://workspace_app:workspace_app_password@localhost:5432/workspace_dev?sslmode=disable';

describe('Stage 17: approval tables under the restricted runtime role', () => {
  let admin: postgres.Sql;
  let app: postgres.Sql;
  const ts = Date.now();
  const orgId = generateUuidV7();
  const otherOrgId = generateUuidV7();
  const projectId = generateUuidV7();
  const meetingId = generateUuidV7();
  const runId = generateUuidV7();
  const decidedItemId = generateUuidV7();
  const openItemId = generateUuidV7();
  const owner = generateUuidV7();
  const member = generateUuidV7();
  const outsider = generateUuidV7();

  beforeAll(async () => {
    admin = postgres(ADMIN_DB_URL, { max: 2 });
    app = postgres(APP_DB_URL, { max: 2 });

    await admin`INSERT INTO orgs (id, name, slug) VALUES (${orgId}, 'S17 RLS', ${`s17-rls-${ts}`}),
      (${otherOrgId}, 'S17 RLS other', ${`s17-rls-other-${ts}`})`;
    await admin`INSERT INTO users (id, email, name) VALUES
      (${owner}, ${`s17-rls-owner-${ts}@example.com`}, 'Owner'),
      (${member}, ${`s17-rls-member-${ts}@example.com`}, 'Member'),
      (${outsider}, ${`s17-rls-outsider-${ts}@example.com`}, 'Outsider')`;
    await admin`INSERT INTO memberships (org_id, user_id, role) VALUES
      (${orgId}, ${owner}, 'owner'), (${orgId}, ${member}, 'member'), (${orgId}, ${outsider}, 'member')`;
    await admin`INSERT INTO nodes (id, org_id, kind, name, path, visibility, rollup)
      VALUES (${projectId}, ${orgId}, 'project', 'RLS Private', ${`s17_rls_${ts}`}, 'private', '{}'::jsonb)`;
    await admin`INSERT INTO node_members (org_id, node_id, user_id) VALUES (${orgId}, ${projectId}, ${member})`;
    const [integration] = await admin<{ id: string }[]>`
      INSERT INTO integrations (org_id, provider, account_id, secret_arn, status)
      VALUES (${orgId}, 'zoom', ${`acct-s17-rls-${ts}`}, 'test-secret-ref', 'connected') RETURNING id`;
    await admin`INSERT INTO zoom_host_consents (org_id, integration_id, zoom_user_id, zoom_email, user_id, consent_status)
      VALUES (${orgId}, ${integration!.id}, ${`zh-rls-${ts}`}, ${`s17-rls-member-${ts}@example.com`}, ${member}, 'opted_in')`;
    await admin`INSERT INTO meetings (id, org_id, provider, provider_meeting_uuid, title, zoom_host_id, host_id,
        status, processing_generation, node_id, actual_start_at, version)
      VALUES (${meetingId}, ${orgId}, 'zoom', ${`s17-rls-${meetingId}`}, 'RLS Sync', ${`zh-rls-${ts}`}, ${member},
        'routed', 1, ${projectId}, '2026-10-05T04:30:00Z', 1)`;
    await admin`INSERT INTO extraction_runs (id, org_id, meeting_id, node_id, run_key, processing_generation,
        transcript_checksum, prompt_version, model, status)
      VALUES (${runId}, ${orgId}, ${meetingId}, ${projectId}, ${`run-${runId}`}, 1, 'chk', 'v1.0.0', 'test-model', 'completed')`;
    await admin`INSERT INTO action_items (id, org_id, meeting_id, text, evidence, confidence, extraction_run_id, dedup_status)
      VALUES
        (${decidedItemId}, ${orgId}, ${meetingId}, 'Ship the RLS audit', ${JSON.stringify([{ seq: 1, quote: 'Ship the RLS audit' }])}::jsonb, 0.9, ${runId}, 'no_match'),
        (${openItemId}, ${orgId}, ${meetingId}, 'Review the RLS audit', ${JSON.stringify([{ seq: 2, quote: 'Review the RLS audit' }])}::jsonb, 0.9, ${runId}, 'no_match')`;
  });

  afterAll(async () => {
    await admin`DELETE FROM orgs WHERE id IN (${orgId}, ${otherOrgId})`;
    await admin`DELETE FROM users WHERE id IN (${owner}, ${member}, ${outsider})`;
    await admin.end({ timeout: 5 });
    await app.end({ timeout: 5 });
  });

  type Ctx = TenantContext;
  // postgres.js TransactionSql lacks the template call signature in its typings (same cast as approval-operations).
  const asApp = <T>(ctx: Ctx, fn: (tx: postgres.Sql) => Promise<T>) =>
    withTenantContext(app, ctx, (txn) => fn(txn as unknown as postgres.Sql));

  const counts = (ctx: Ctx) =>
    asApp(ctx, async (tx) => {
      const [items] = await tx<{ c: number }[]>`SELECT count(*)::int AS c FROM action_items WHERE meeting_id = ${meetingId}`;
      const [decisions] = await tx<{ c: number }[]>`SELECT count(*)::int AS c FROM action_item_decisions WHERE meeting_id = ${meetingId}`;
      return { items: items!.c, decisions: decisions!.c };
    });

  it('runs a full approve decision as workspace_app and appends exactly one decision row', async () => {
    const result = await decideActionItem(app, {
      orgId,
      actionItemId: decidedItemId,
      userId: member,
      role: 'member',
      expectedVersion: 1,
      input: { decision: 'approve' },
    });
    expect(result.taskOperation).toBe('created');
    expect(result.task).toMatchObject({ projectId, source: 'zoom_meeting', title: 'Ship the RLS audit' });
    expect(result.actionItem).toMatchObject({ state: 'approved', version: 2, taskId: result.task!.id });
  });

  it('hides private-project suggestions and decisions from org members without project access', async () => {
    expect(await counts({ orgId, userId: member, role: 'member' })).toEqual({ items: 2, decisions: 1 });
    expect(await counts({ orgId, userId: owner, role: 'owner' })).toEqual({ items: 2, decisions: 1 });
    expect(await counts({ orgId, userId: outsider, role: 'member' })).toEqual({ items: 0, decisions: 0 });
    expect(await counts({ orgId: otherOrgId, userId: owner, role: 'owner' })).toEqual({ items: 0, decisions: 0 });
  });

  it('blocks writes to a private-project suggestion by a member without project access', async () => {
    const updated = await asApp({ orgId, userId: outsider, role: 'member' }, (tx) => tx`
      UPDATE action_items SET state = 'rejected' WHERE id = ${openItemId} RETURNING id`);
    expect(updated).toHaveLength(0);
    const [row] = await admin<{ state: string }[]>`SELECT state FROM action_items WHERE id = ${openItemId}`;
    expect(row!.state).toBe('suggested');
  });

  it('keeps the decision log append-only for the runtime role', async () => {
    const ctx: Ctx = { orgId, userId: owner, role: 'owner' };
    await expect(
      asApp(ctx, (tx) => tx`UPDATE action_item_decisions SET reason = 'other' WHERE meeting_id = ${meetingId}`)
    ).rejects.toThrow(/permission denied/);
    await expect(
      asApp(ctx, (tx) => tx`DELETE FROM action_item_decisions WHERE meeting_id = ${meetingId}`)
    ).rejects.toThrow(/permission denied/);
  });
});
