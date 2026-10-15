import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parseConfig,
  signInternalApiRequest,
  generateUuidV7,
  normalizedEditDistance,
  type LLMPort,
} from '@workspace/core';
import { buildServer, type ServerInstance } from '../server.js';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  createTask,
  persistMeetingNotesAndSuggestions,
  enrichMeetingSuggestions,
  type Sql,
} from '@workspace/db';

/**
 * Stage 17: Human approval of AI suggestions (Requirement N-2) against real PostgreSQL.
 * Suggestions are produced by the real persist/enrich pipeline; tasks appear only after a decision.
 */
describe('Stage 17: Approval API (approve / edit / reject)', () => {
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
    SECRET_STORE_PROVIDER: 'in_memory',
    ZOOM_CLIENT_PROVIDER: 'mock',
  });

  const ts = Date.now();
  const HOST_ZOOM_ID = `zh_appr_${ts}`;
  const QUOTE = 'I will update the ADR documentation for approvals';

  let server: ServerInstance;
  let sql: Sql;
  type U = { id: string; email: string };
  let owner: U, member: U, member2: U, outsider: U, viewer: U, foreign: U;
  let org: { id: string; slug: string };
  let foreignOrg: { id: string; slug: string };
  let privateProjectId: string;
  let publicProjectId: string;
  const logLines: string[] = [];

  const auth = (u: U) => {
    const timestamp = Date.now();
    return {
      'x-workspace-user-id': u.id,
      'x-workspace-user-email': u.email,
      'x-workspace-timestamp': String(timestamp),
      'x-workspace-signature': signInternalApiRequest({ userId: u.id, email: u.email, timestamp }, secret),
    };
  };

  const decide = (u: U, id: string, body: unknown, ifMatch: string | null = '"v1"', extra: Record<string, string> = {}) =>
    server.app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${org.slug}/action-items/${id}/decision`,
      headers: { ...auth(u), 'content-type': 'application/json', ...(ifMatch ? { 'if-match': ifMatch } : {}), ...extra },
      payload: JSON.stringify(body),
    });

  const get = (u: U, url: string, slug = org.slug) =>
    server.app.inject({ method: 'GET', url: `/api/v1/orgs/${slug}${url}`, headers: auth(u) });

  const taskCount = async () => (await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM tasks WHERE org_id = ${org.id}`)[0]!.c;

  /** Seeds a routed meeting with transcript, completed extraction run and persisted suggestions. */
  async function seedMeeting(
    texts: string[],
    enrich: Record<string, unknown> | null = { dedup_status: 'no_match' }
  ): Promise<{ meetingId: string; itemIds: string[] }> {
    const meetingId = generateUuidV7();
    const runId = generateUuidV7();
    await sql`
      INSERT INTO meetings (id, org_id, provider, provider_meeting_uuid, title, zoom_host_id, zoom_host_email,
        host_id, status, processing_generation, node_id, actual_start_at, version)
      VALUES (${meetingId}, ${org.id}, 'zoom', ${`appr-${meetingId}`}, 'Approvals Sync', ${HOST_ZOOM_ID},
        ${member.email}, ${member.id}, 'routed', 1, ${privateProjectId}, '2026-10-05T04:30:00Z', 1)
    `;
    for (const [i, text] of texts.entries()) {
      await sql`
        INSERT INTO transcript_segments (org_id, meeting_id, seq, speaker_label, user_id, start_ms, end_ms, text)
        VALUES (${org.id}, ${meetingId}, ${i + 1}, 'Speaker', ${member.id}, ${i * 1000}, ${i * 1000 + 900}, ${text + ' by next week.'})
      `;
    }
    await sql`
      INSERT INTO extraction_runs (id, org_id, meeting_id, node_id, run_key, processing_generation,
        transcript_checksum, prompt_version, model, status)
      VALUES (${runId}, ${org.id}, ${meetingId}, ${privateProjectId}, ${`run-${runId}`}, 1, 'chk', 'v1.0.0', 'test-model', 'completed')
    `;
    const persisted = await persistMeetingNotesAndSuggestions(sql, {
      orgId: org.id,
      meetingId,
      nodeId: privateProjectId,
      processingGeneration: 1,
      extractionRunId: runId,
      summaryMd: 'Approvals discussion',
      decisions: [],
      openQuestions: [],
      actionItems: texts.map((text, i) => ({ text, evidence: [{ seq: i + 1, quote: text }], confidence: 0.9 })),
      model: 'test-model',
      promptVersion: 'v1.0.0',
      inputTokens: 0,
      outputTokens: 0,
      costInr: 0,
    });
    const itemIds = persisted.actionItems.map((a) => a.id);
    if (enrich) {
      for (const [col, val] of Object.entries(enrich)) {
        await sql`UPDATE action_items SET ${sql(col)} = ${val as string} WHERE id IN ${sql(itemIds)}`;
      }
      await sql`UPDATE action_items SET deduped_at = now() WHERE id IN ${sql(itemIds)}`;
    }
    return { meetingId, itemIds };
  }

  beforeAll(async () => {
    server = buildServer(testConfig);
    sql = server.sql;
    const db = server.db;
    // Capture request-scoped log calls to prove no transcript text is logged.
    server.app.addHook('onRequest', async (req: any) => {
      for (const level of ['info', 'warn', 'error'] as const) {
        const orig = req.log[level].bind(req.log);
        req.log[level] = (...args: unknown[]) => {
          logLines.push(JSON.stringify(args));
          return orig(...args);
        };
      }
    });

    const mk = async (tag: string) => {
      const u = await findOrCreateUserByEmail(db, { email: `s17-${tag}-${ts}@example.com`, name: `S17 ${tag}` });
      return { id: u.id, email: u.email };
    };
    owner = await mk('owner');
    member = await mk('member');
    member2 = await mk('member2');
    outsider = await mk('outsider');
    viewer = await mk('viewer');
    foreign = await mk('foreign');

    ({ org } = await createOrganizationWithOwner(db, { name: 'S17 Org', slug: `s17-org-${ts}`, userId: owner.id }));
    ({ org: foreignOrg } = await createOrganizationWithOwner(db, {
      name: 'S17 Foreign',
      slug: `s17-foreign-${ts}`,
      userId: foreign.id,
    }));
    await sql`
      INSERT INTO memberships (org_id, user_id, role) VALUES
        (${org.id}, ${member.id}, 'member'), (${org.id}, ${member2.id}, 'member'),
        (${org.id}, ${outsider.id}, 'member'), (${org.id}, ${viewer.id}, 'viewer')
    `;
    privateProjectId = generateUuidV7();
    publicProjectId = generateUuidV7();
    await sql`
      INSERT INTO nodes (id, org_id, kind, name, path, visibility, rollup) VALUES
        (${privateProjectId}, ${org.id}, 'project', 'Approvals Private', ${`s17_priv_${ts}`}, 'private', '{}'::jsonb),
        (${publicProjectId}, ${org.id}, 'project', 'Approvals Public', ${`s17_pub_${ts}`}, 'public', '{}'::jsonb)
    `;
    await sql`
      INSERT INTO node_members (org_id, node_id, user_id) VALUES
        (${org.id}, ${privateProjectId}, ${member.id}), (${org.id}, ${privateProjectId}, ${member2.id}),
        (${org.id}, ${privateProjectId}, ${viewer.id})
    `;
    const [integration] = await sql<{ id: string }[]>`
      INSERT INTO integrations (org_id, provider, account_id, secret_arn, status)
      VALUES (${org.id}, 'zoom', ${`acct-s17-${ts}`}, 'test-secret-ref', 'connected')
      RETURNING id
    `;
    await sql`
      INSERT INTO zoom_host_consents (org_id, integration_id, zoom_user_id, zoom_email, user_id, consent_status, consent_timestamp)
      VALUES (${org.id}, ${integration!.id}, ${HOST_ZOOM_ID}, ${member.email}, ${member.id}, 'opted_in', '2026-01-01T00:00:00Z')
    `;
  });

  afterAll(async () => {
    if (org) await sql`DELETE FROM orgs WHERE id = ${org.id}`;
    if (foreignOrg) await sql`DELETE FROM orgs WHERE id = ${foreignOrg.id}`;
    await server?.close();
  });

  describe('Listing and enrichment never create tasks', () => {
    it('enriches with incomplete dedup, lists the item, creates zero tasks, and requires acknowledgement to create', async () => {
      const { meetingId, itemIds } = await seedMeeting([QUOTE], null);
      const failingEmbed: LLMPort = {
        ...server.ports.llm,
        embed: async () => {
          throw new Error('embedding provider unavailable');
        },
      };
      await enrichMeetingSuggestions(sql, { orgId: org.id, meetingId, llmPort: failingEmbed });
      expect(await taskCount()).toBe(0);

      const res = await get(member, `/action-items?meetingId=${meetingId}`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      const item = body.items[0];
      expect(item).toMatchObject({
        id: itemIds[0],
        state: 'suggested',
        dedupStatus: 'incomplete',
        validationStatus: 'valid',
        suggestedOwnerId: member.id, // speaker commitment in a private project the owner belongs to
        canDecide: true,
        project: { id: privateProjectId, name: 'Approvals Private' },
        meeting: { title: 'Approvals Sync' },
      });
      expect(item.evidence[0].quote).toBe(QUOTE);
      expect(item.version).toBeGreaterThan(1); // enrichment changed the proposal after persistence
      const current = `"v${item.version}"`;
      expect(await taskCount()).toBe(0);

      // A decision made against the pre-enrichment proposal is stale
      const stale = await decide(member, itemIds[0]!, { decision: 'approve', acknowledgeIncompleteDedup: true }, '"v1"');
      expect(stale.statusCode).toBe(412);
      expect(stale.json().currentEntity).toMatchObject({ version: item.version, dedupStatus: 'incomplete' });

      const blocked = await decide(member, itemIds[0]!, { decision: 'approve' }, current);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().code).toBe('DEDUP_INCOMPLETE');
      expect(await taskCount()).toBe(0);

      const ok = await decide(member, itemIds[0]!, { decision: 'approve', acknowledgeIncompleteDedup: true }, current);
      expect(ok.statusCode).toBe(200);
      expect(await taskCount()).toBe(1);
    });

    it('treats a failed task-embedding backfill as incomplete dedup even when the item embed succeeds', async () => {
      const unindexed = await createTask(server.db, {
        orgId: org.id,
        actorUserId: owner.id,
        role: 'owner',
        input: { projectId: privateProjectId, title: 'Unindexed backfill task', status: 'todo', priority: 'medium' },
      });
      const { meetingId, itemIds } = await seedMeeting([QUOTE], null);
      // Provider fails (e.g. 429 after retries) for the task backfill only; the suggestion's own embed succeeds.
      const partialEmbed: LLMPort = {
        ...server.ports.llm,
        embed: async (input) => {
          if (input.texts.some((t) => t.includes('Unindexed backfill task'))) throw new Error('rate limited');
          return server.ports.llm.embed(input);
        },
      };
      await enrichMeetingSuggestions(sql, { orgId: org.id, meetingId, llmPort: partialEmbed });
      try {
        const item = (await get(member, `/action-items/${itemIds[0]}`)).json();
        expect(item).toMatchObject({ dedupStatus: 'incomplete', proposalType: 'create_task' });
        const before = await taskCount();
        const blocked = await decide(member, itemIds[0]!, { decision: 'approve' }, `"v${item.version}"`);
        expect(blocked.statusCode).toBe(409);
        expect(blocked.json().code).toBe('DEDUP_INCOMPLETE');
        expect(await taskCount()).toBe(before);
      } finally {
        await sql`UPDATE tasks SET archived_at = now() WHERE id = ${unindexed.id}`;
      }
    });
  });

  describe('Approve create_task proposal', () => {
    it('creates exactly one task with provenance, outbox events, rollup invalidation and decision log', async () => {
      const { meetingId, itemIds } = await seedMeeting([QUOTE], {
        dedup_status: 'no_match',
        suggested_owner_id: member.id,
        suggested_due: '2026-10-20',
      });
      const id = itemIds[0]!;
      const before = await taskCount();
      // Earlier tests already dirtied this project: clear it so the assertion below proves this decision did it.
      await sql`DELETE FROM node_rollup_dirty WHERE node_id = ${privateProjectId}`;

      const res = await decide(member2, id, { decision: 'approve' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['etag']).toBe('"v2"');
      const body = res.json();
      expect(body.taskOperation).toBe('created');
      expect(body.assignment).toEqual({ suggestedOwnerId: member.id, appliedAssigneeId: member.id, suggestedOwnerDropped: false });
      expect(body.task).toMatchObject({
        projectId: privateProjectId,
        title: QUOTE,
        assigneeId: member.id,
        dueDate: '2026-10-20',
        source: 'zoom_meeting',
        createdBy: member2.id,
        version: 1,
      });
      expect(body.task.key).toMatch(/^[A-Z0-9]+-\d+$/);
      expect(JSON.parse(body.task.sourceRef)).toEqual({ meetingId, actionItemId: id, evidenceSeqs: [1] });
      expect(body.task.description).toContain(`/orgs/${org.id}/meetings?meeting=${meetingId}`);
      expect(body.task.description).toContain('meeting "Approvals Sync" (2026-10-05)'); // same project: named
      expect(body.task.description).not.toContain('by next week'); // no transcript dump
      expect(body.actionItem).toMatchObject({ state: 'approved', version: 2, taskId: body.task.id, decidedBy: member2.id, canDecide: false });
      expect(body.actionItem.task).toMatchObject({ id: body.task.id, key: body.task.key });
      expect(await taskCount()).toBe(before + 1);

      const outbox = await sql<{ topic: string; payload: any }[]>`
        SELECT topic, payload FROM outbox WHERE org_id = ${org.id}
          AND (payload->>'taskId' = ${body.task.id} OR payload->>'actionItemId' = ${id})
      `;
      const topics = outbox.map((o) => o.topic).sort();
      expect(topics).toEqual(['action_item.decided', 'task.assigned', 'task.created']);
      expect(outbox.find((o) => o.topic === 'action_item.decided')!.payload).toEqual({
        orgId: org.id,
        meetingId,
        actionItemId: id,
        decision: 'approve',
        taskId: body.task.id,
      });

      const [dirty] = await sql`SELECT 1 FROM node_rollup_dirty WHERE node_id = ${privateProjectId}`;
      expect(dirty).toBeDefined();

      const [log] = await sql<any[]>`SELECT * FROM action_item_decisions WHERE action_item_id = ${id}`;
      expect(log).toMatchObject({ decision: 'approve', task_id: body.task.id, task_operation: 'created', decided_by: member2.id });
      expect(Number(log.title_edit_distance)).toBe(0);
      expect(Number(log.time_to_decision_ms)).toBeGreaterThanOrEqual(0);
      expect(log.proposal_snapshot).toMatchObject({ text: QUOTE, model: 'test-model', promptVersion: 'v1.0.0', proposalType: 'create_task' });
      expect(log.edit_summary).toEqual({ changedFields: [], suggestedOwnerDropped: false });

      // The meeting notes endpoint exposes decision state, version and the task link for the drawer
      const notes = await get(member, `/meetings/${meetingId}/notes`);
      expect(notes.statusCode).toBe(200);
      expect(notes.json().actionItems[0]).toMatchObject({ state: 'approved', version: 2, task: { id: body.task.id } });

      // Decided items leave the default review queue
      const queue = await get(member, `/action-items?meetingId=${meetingId}`);
      expect(queue.json().items).toHaveLength(0);
      const decided = await get(member, `/action-items?meetingId=${meetingId}&state=approved`);
      expect(decided.json().items.map((i: any) => i.id)).toEqual([id]);
    });

    it('concurrent double-approve yields exactly one task; the loser gets 412/409', async () => {
      const { itemIds } = await seedMeeting([QUOTE]);
      const id = itemIds[0]!;
      const before = await taskCount();
      const results = await Promise.all([
        decide(member, id, { decision: 'approve' }),
        decide(member2, id, { decision: 'approve' }),
      ]);
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes[0]).toBe(200);
      expect([409, 412]).toContain(codes[1]);
      expect(await taskCount()).toBe(before + 1);
      const [row] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM action_item_decisions WHERE action_item_id = ${id}`;
      expect(row!.c).toBe(1);
    });

    it('replays an Idempotency-Key with the same result and no second task', async () => {
      const { itemIds } = await seedMeeting([QUOTE]);
      const id = itemIds[0]!;
      const key = `s17-idem-${id}`;
      const first = await decide(member, id, { decision: 'approve' }, '"v1"', { 'idempotency-key': key });
      expect(first.statusCode).toBe(200);
      const count = await taskCount();
      const replay = await decide(member, id, { decision: 'approve' }, '"v1"', { 'idempotency-key': key });
      expect(replay.statusCode).toBe(200);
      expect(replay.headers['x-idempotent-replayed']).toBe('true');
      expect(replay.json().task.id).toBe(first.json().task.id);
      expect(await taskCount()).toBe(count);
    });

    it('enforces If-Match: 428 when missing, 412 with fresh entity when stale', async () => {
      const { itemIds } = await seedMeeting([QUOTE]);
      const missing = await decide(member, itemIds[0]!, { decision: 'approve' }, null);
      expect(missing.statusCode).toBe(428);
      const stale = await decide(member, itemIds[0]!, { decision: 'approve' }, '"v7"');
      expect(stale.statusCode).toBe(412);
      expect(stale.json().currentEntity).toMatchObject({ id: itemIds[0], version: 1, state: 'suggested' });

      const single = await get(member, `/action-items/${itemIds[0]}`);
      expect(single.statusCode).toBe(200);
      expect(single.headers['etag']).toBe('"v1"');
    });
  });

  describe('Edit and reject', () => {
    it('applies human edits (incl. another accessible project) and records edit summary + edit distance', async () => {
      const { itemIds } = await seedMeeting([QUOTE], { dedup_status: 'no_match', suggested_owner_id: member.id, suggested_due: '2026-10-20' });
      const id = itemIds[0]!;
      const newTitle = 'Update ADR 17 documentation for approvals';
      const edit = {
        decision: 'edit',
        title: newTitle,
        description: 'Cover decision rights',
        assigneeId: member2.id,
        dueDate: '2026-11-02',
        priority: 'high',
        projectId: publicProjectId,
      };
      // Dedup ran only against the meeting's project: a different project is an unchecked duplicate.
      const unchecked = await decide(member, id, edit);
      expect(unchecked.statusCode).toBe(409);
      expect(unchecked.json().code).toBe('DEDUP_INCOMPLETE');
      const res = await decide(member, id, { ...edit, acknowledgeIncompleteDedup: true });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.task).toMatchObject({
        projectId: publicProjectId,
        title: newTitle,
        assigneeId: member2.id,
        dueDate: '2026-11-02',
        priority: 'high',
        source: 'zoom_meeting',
      });
      expect(body.task.description).toContain('Cover decision rights');
      // Private meeting's title/date never copied into a project with wider visibility; only the opaque link.
      expect(body.task.description).not.toContain('Approvals Sync');
      expect(body.task.description).not.toContain('2026-10-05');
      expect(body.task.description).toContain('Source: approved AI suggestion from a meeting — /orgs/');
      expect(body.actionItem.state).toBe('edited');

      const [log] = await sql<any[]>`SELECT * FROM action_item_decisions WHERE action_item_id = ${id}`;
      expect(log.decision).toBe('edit');
      expect([...log.edit_summary.changedFields].sort()).toEqual(
        ['assigneeId', 'description', 'dueDate', 'priority', 'projectId', 'title'].sort()
      );
      expect(Number(log.title_edit_distance)).toBeCloseTo(normalizedEditDistance(QUOTE, newTitle), 4);
      expect(log.applied_values).toMatchObject({ mode: 'create', title: newTitle, projectId: publicProjectId, dueDate: '2026-11-02' });
    });

    it('rejects with a reason and changes no task', async () => {
      const { itemIds } = await seedMeeting([QUOTE]);
      const id = itemIds[0]!;
      const before = await taskCount();
      const bad = await decide(member, id, { decision: 'reject', reason: 'irrelevant' });
      expect(bad.statusCode).toBe(422);
      const res = await decide(member, id, { decision: 'reject', reason: 'duplicate', note: 'Already tracked' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ task: null, taskOperation: null });
      expect(res.json().actionItem).toMatchObject({ state: 'rejected', decisionReason: 'duplicate', decisionNote: 'Already tracked', taskId: null });
      expect(await taskCount()).toBe(before);
      const [log] = await sql<any[]>`SELECT decision, reason, note, task_id FROM action_item_decisions WHERE action_item_id = ${id}`;
      expect(log).toEqual({ decision: 'reject', reason: 'duplicate', note: 'Already tracked', task_id: null });

      const again = await decide(member, id, { decision: 'approve' }, '"v2"');
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe('ALREADY_DECIDED');
    });
  });

  describe('update_task proposals', () => {
    async function seedUpdateProposal() {
      const target = await createTask(server.db, {
        orgId: org.id,
        actorUserId: owner.id,
        role: 'owner',
        input: { projectId: privateProjectId, title: 'Approvals ADR', description: 'Existing notes', status: 'todo', priority: 'medium' },
      });
      const { itemIds } = await seedMeeting([QUOTE], {
        proposal_type: 'update_task',
        target_task_id: target.id,
        target_task_version: target.version,
        dedup_status: 'matched',
        suggested_owner_id: member2.id,
        suggested_due: '2026-10-30',
      });
      return { target, id: itemIds[0]! };
    }

    it('applies the update to the target with a version check and links the item', async () => {
      const { target, id } = await seedUpdateProposal();
      const before = await taskCount();
      const res = await decide(member, id, { decision: 'approve' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.taskOperation).toBe('updated');
      expect(body.task).toMatchObject({ id: target.id, version: 2, assigneeId: member2.id, dueDate: '2026-10-30', source: 'manual' });
      expect(body.task.description).toContain('Existing notes');
      expect(body.task.description).toContain(`Update from meeting "Approvals Sync" (2026-10-05): ${QUOTE}`);
      expect(body.actionItem).toMatchObject({ state: 'approved', taskId: target.id });
      expect(await taskCount()).toBe(before);
      const [updated] = await sql`SELECT 1 FROM outbox WHERE topic = 'task.updated' AND payload->>'taskId' = ${target.id}`;
      expect(updated).toBeDefined();
    });

    it('returns 409 TARGET_CHANGED with the fresh task when the target moved on, and writes nothing', async () => {
      const { target, id } = await seedUpdateProposal();
      await sql`UPDATE tasks SET title = 'Approvals ADR (renamed)', version = version + 1 WHERE id = ${target.id}`;

      const res = await decide(member, id, { decision: 'approve' });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('TARGET_CHANGED');
      expect(res.json().details.currentTask).toMatchObject({ id: target.id, version: 2, title: 'Approvals ADR (renamed)' });
      const [t] = await sql<any[]>`SELECT version, assignee_id FROM tasks WHERE id = ${target.id}`;
      expect(t).toEqual({ version: 2, assignee_id: null });
      const [ai] = await sql<any[]>`SELECT state, version FROM action_items WHERE id = ${id}`;
      expect(ai).toEqual({ state: 'suggested', version: 1 });

      // Re-presented to the human: an edit acknowledging the fresh target version applies
      const retry = await decide(member, id, { decision: 'edit', targetTaskVersion: 2 });
      expect(retry.statusCode).toBe(200);
      expect(retry.json().task).toMatchObject({ id: target.id, version: 3 });
    });

    it('refuses completed or archived targets with TARGET_CHANGED', async () => {
      const done = await seedUpdateProposal();
      await sql`UPDATE tasks SET status = 'done' WHERE id = ${done.target.id}`;
      const r1 = await decide(member, done.id, { decision: 'approve' });
      expect(r1.statusCode).toBe(409);
      expect(r1.json().code).toBe('TARGET_CHANGED');

      const archived = await seedUpdateProposal();
      await sql`UPDATE tasks SET archived_at = now() WHERE id = ${archived.target.id}`;
      const r2 = await decide(member, archived.id, { decision: 'approve' });
      expect(r2.statusCode).toBe(409);
      expect(r2.json().code).toBe('TARGET_CHANGED');
    });

    it('refuses an update whose appended note would push the description past 50,000 characters', async () => {
      const { target, id } = await seedUpdateProposal();
      await sql`UPDATE tasks SET description = ${'x'.repeat(49_990)} WHERE id = ${target.id}`;
      const res = await decide(member, id, { decision: 'edit', description: 'A note that no longer fits' });
      expect(res.statusCode).toBe(422);
      const [t] = await sql<any[]>`SELECT version, length(description)::int AS len FROM tasks WHERE id = ${target.id}`;
      expect(t).toEqual({ version: 1, len: 49_990 });
      const [ai] = await sql<any[]>`SELECT state FROM action_items WHERE id = ${id}`;
      expect(ai.state).toBe('suggested');
    });

    it('lets the human turn an update proposal into a new task (mode=create)', async () => {
      const { target, id } = await seedUpdateProposal();
      const res = await decide(member, id, { decision: 'edit', mode: 'create' });
      expect(res.statusCode).toBe(200);
      expect(res.json().taskOperation).toBe('created');
      expect(res.json().task.id).not.toBe(target.id);
      const [log] = await sql<any[]>`SELECT edit_summary FROM action_item_decisions WHERE action_item_id = ${id}`;
      expect(log.edit_summary.changedFields).toContain('mode');
    });
  });

  describe('Re-extraction in the same generation', () => {
    it('does not re-stage suggestions a human already decided', async () => {
      const { meetingId, itemIds } = await seedMeeting([QUOTE, 'Draft the approvals runbook']);
      expect((await decide(member, itemIds[0]!, { decision: 'approve' })).statusCode).toBe(200);
      expect((await decide(member, itemIds[1]!, { decision: 'reject', reason: 'wrong' })).statusCode).toBe(200);

      // e.g. an Owner retries intake after a prompt change: new run key, same processing generation.
      const runId = generateUuidV7();
      await sql`
        INSERT INTO extraction_runs (id, org_id, meeting_id, node_id, run_key, processing_generation,
          transcript_checksum, prompt_version, model, status)
        VALUES (${runId}, ${org.id}, ${meetingId}, ${privateProjectId}, ${`run-${runId}`}, 1, 'chk', 'v1.1.0', 'test-model', 'completed')
      `;
      await persistMeetingNotesAndSuggestions(sql, {
        orgId: org.id,
        meetingId,
        nodeId: privateProjectId,
        processingGeneration: 1,
        extractionRunId: runId,
        summaryMd: 'Approvals discussion (re-extracted)',
        decisions: [],
        openQuestions: [],
        actionItems: [
          { text: `${QUOTE}.`, evidence: [{ seq: 1, quote: QUOTE }], confidence: 0.9 }, // same commitment, reworded
          { text: 'Draft the runbook for approvals', evidence: [{ seq: 2, quote: 'Draft the approvals runbook' }], confidence: 0.9 },
          { text: 'Book the approvals retro', evidence: [{ seq: 3, quote: 'Book the approvals retro' }], confidence: 0.9 },
        ],
        model: 'test-model',
        promptVersion: 'v1.1.0',
        inputTokens: 0,
        outputTokens: 0,
        costInr: 0,
      });
      const rows = await sql<{ text: string; state: string }[]>`
        SELECT text, state FROM action_items WHERE meeting_id = ${meetingId} ORDER BY created_at, id
      `;
      expect(rows).toEqual([
        { text: QUOTE, state: 'approved' },
        { text: 'Draft the approvals runbook', state: 'rejected' },
        { text: 'Book the approvals retro', state: 'suggested' },
      ]);
    });
  });

  describe('Decision eligibility guards', () => {
    it('refuses invalid-evidence items (excluded from the default queue, visible with validation=invalid)', async () => {
      const { meetingId, itemIds } = await seedMeeting([QUOTE], { validation_status: 'invalid_evidence', dedup_status: 'no_match' });
      const defaultQueue = await get(member, `/action-items?meetingId=${meetingId}`);
      expect(defaultQueue.json().items).toHaveLength(0);
      const invalid = await get(member, `/action-items?meetingId=${meetingId}&validation=invalid`);
      expect(invalid.json().items.map((i: any) => i.id)).toEqual(itemIds);
      expect(invalid.json().items[0].canDecide).toBe(false);
      const res = await decide(member, itemIds[0]!, { decision: 'approve' });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INVALID_EVIDENCE');
    });

    it('refuses skipped meetings, withdrawn consent and stale generations', async () => {
      const skipped = await seedMeeting([QUOTE]);
      await sql`UPDATE meetings SET skipped = true, status = 'skipped' WHERE id = ${skipped.meetingId}`;
      const r1 = await decide(member, skipped.itemIds[0]!, { decision: 'approve' });
      expect(r1.json().code).toBe('MEETING_SKIPPED');

      const stale = await seedMeeting([QUOTE]);
      await sql`UPDATE meetings SET processing_generation = 2 WHERE id = ${stale.meetingId}`;
      const r2 = await decide(member, stale.itemIds[0]!, { decision: 'approve' });
      expect(r2.json().code).toBe('STALE_GENERATION');
      // Undecidable forever (e.g. after a host opt-out fenced the meeting): out of the queue, shown as superseded.
      expect((await get(member, `/action-items?meetingId=${stale.meetingId}`)).json().items).toHaveLength(0);
      const staleItem = (await get(member, `/action-items/${stale.itemIds[0]}`)).json();
      expect(staleItem).toMatchObject({ state: 'suggested', superseded: true, canDecide: false });

      const consent = await seedMeeting([QUOTE]);
      await sql`UPDATE zoom_host_consents SET consent_status = 'opted_out' WHERE org_id = ${org.id}`;
      try {
        const r3 = await decide(member, consent.itemIds[0]!, { decision: 'reject', reason: 'wrong' });
        expect(r3.statusCode).toBe(409);
        expect(r3.json().code).toBe('CONSENT_WITHDRAWN');
      } finally {
        await sql`UPDATE zoom_host_consents SET consent_status = 'opted_in' WHERE org_id = ${org.id}`;
      }

      // Admin override through the real endpoint does not bump the generation: the read model must still
      // drop the item from the queue and report it undecidable, and re-enabling restores it.
      const adminToggle = (adminDisabled: boolean) =>
        server.app.inject({
          method: 'PATCH',
          url: `/api/v1/orgs/${org.slug}/integrations/zoom/hosts/${HOST_ZOOM_ID}`,
          headers: { ...auth(owner), 'content-type': 'application/json' },
          payload: JSON.stringify({ adminDisabled }),
        });
      expect((await adminToggle(true)).statusCode).toBe(200);
      try {
        expect((await get(member, `/action-items?meetingId=${consent.meetingId}`)).json().items).toHaveLength(0);
        const held = (await get(member, `/action-items/${consent.itemIds[0]}`)).json();
        expect(held).toMatchObject({ state: 'suggested', superseded: false, consentWithdrawn: true, canDecide: false });
      } finally {
        expect((await adminToggle(false)).statusCode).toBe(200);
      }
      const restored = (await get(member, `/action-items?meetingId=${consent.meetingId}`)).json().items;
      expect(restored).toMatchObject([{ id: consent.itemIds[0], consentWithdrawn: false, canDecide: true }]);
      for (const r of [r1, r2]) expect(r.statusCode).toBe(409);
      const decided = await sql`
        SELECT 1 FROM action_item_decisions
        WHERE action_item_id IN ${sql([skipped.itemIds[0]!, stale.itemIds[0]!, consent.itemIds[0]!])}
      `;
      expect(decided).toHaveLength(0);
    });

    it('drops an ineligible suggested owner (task created unassigned) and rejects an ineligible explicit assignee', async () => {
      const { itemIds } = await seedMeeting([QUOTE, 'Draft the approvals runbook'], {
        dedup_status: 'no_match',
        suggested_owner_id: outsider.id, // org member without access to the private project
      });
      const res = await decide(member, itemIds[0]!, { decision: 'approve' });
      expect(res.statusCode).toBe(200);
      expect(res.json().task.assigneeId).toBeNull();
      expect(res.json().assignment).toEqual({ suggestedOwnerId: outsider.id, appliedAssigneeId: null, suggestedOwnerDropped: true });
      const [log] = await sql<any[]>`SELECT edit_summary FROM action_item_decisions WHERE action_item_id = ${itemIds[0]!}`;
      expect(log.edit_summary.suggestedOwnerDropped).toBe(true);

      const explicit = await decide(member, itemIds[1]!, { decision: 'edit', assigneeId: outsider.id });
      expect(explicit.statusCode).toBe(422);
    });
  });

  describe('Authorisation', () => {
    it('viewer may read but gets 403 on decision; non-member of the private project gets 404; foreign org gets 404', async () => {
      const { meetingId, itemIds } = await seedMeeting([QUOTE]);
      const id = itemIds[0]!;

      const viewerRead = await get(viewer, `/action-items/${id}`);
      expect(viewerRead.statusCode).toBe(200);
      expect(viewerRead.json().canDecide).toBe(false);
      const viewerDecide = await decide(viewer, id, { decision: 'approve' });
      expect(viewerDecide.statusCode).toBe(403);

      expect((await get(outsider, `/action-items/${id}`)).statusCode).toBe(404);
      expect((await decide(outsider, id, { decision: 'approve' })).statusCode).toBe(404);
      const outsiderList = await get(outsider, `/action-items?meetingId=${meetingId}`);
      expect(outsiderList.json().items).toHaveLength(0);

      expect((await get(foreign, `/action-items/${id}`, foreignOrg.slug)).statusCode).toBe(404);
      const foreignDecide = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${foreignOrg.slug}/action-items/${id}/decision`,
        headers: { ...auth(foreign), 'content-type': 'application/json', 'if-match': '"v1"' },
        payload: JSON.stringify({ decision: 'approve' }),
      });
      expect(foreignDecide.statusCode).toBe(404);

      const [ai] = await sql<any[]>`SELECT state FROM action_items WHERE id = ${id}`;
      expect(ai.state).toBe('suggested');
    });

    it('unrouted meetings: only the verified host can see suggestions, and they cannot be decided until routed', async () => {
      const { meetingId, itemIds } = await seedMeeting([QUOTE]);
      await sql`UPDATE meetings SET node_id = NULL, status = 'awaiting_project_choice' WHERE id = ${meetingId}`;
      const id = itemIds[0]!;

      expect((await get(member, `/action-items/${id}`)).statusCode).toBe(200); // meetings.host_id binding
      expect((await get(member2, `/action-items/${id}`)).statusCode).toBe(404); // not the host: no existence leak
      expect((await decide(member2, id, { decision: 'approve' })).statusCode).toBe(404);
      expect((await get(member2, `/action-items?meetingId=${meetingId}`)).json().items).toHaveLength(0);
      expect((await get(owner, `/action-items?meetingId=${meetingId}`)).json().items.map((i: any) => i.id)).toEqual([id]);

      const res = await decide(member, id, { decision: 'approve' });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('MEETING_NOT_ROUTED');
    });

    it('filters by assignee=me and paginates with a stable opaque cursor', async () => {
      const { meetingId, itemIds } = await seedMeeting(['First approvals item', 'Second approvals item', 'Third approvals item'], {
        dedup_status: 'no_match',
      });
      await sql`UPDATE action_items SET suggested_owner_id = ${member2.id} WHERE id = ${itemIds[1]!}`;
      const mine = await get(member2, `/action-items?meetingId=${meetingId}&assignee=me`);
      expect(mine.json().items.map((i: any) => i.id)).toEqual([itemIds[1]]);

      const p1 = await get(member, `/action-items?meetingId=${meetingId}&limit=2`);
      expect(p1.json().pageInfo.hasNextPage).toBe(true);
      const p2 = await get(member, `/action-items?meetingId=${meetingId}&limit=2&cursor=${p1.json().pageInfo.endCursor}`);
      expect(p2.json().pageInfo.hasNextPage).toBe(false);
      expect([...p1.json().items, ...p2.json().items].map((i: any) => i.id)).toEqual(itemIds);
      expect((await get(member, `/action-items?limit=101`)).statusCode).toBe(422);
      expect((await get(member, `/action-items?cursor=garbage`)).statusCode).toBe(422);
    });
  });

  it('keeps transcript text out of activity_log metadata and request logs', async () => {
    const secretQuote = 'I will rotate the confidential vendor contract keys';
    const { itemIds } = await seedMeeting([secretQuote]);
    await decide(member, itemIds[0]!, { decision: 'approve' }, '"v9"'); // 412 path logs
    const res = await decide(member, itemIds[0]!, { decision: 'approve' });
    expect(res.statusCode).toBe(200);
    const activity = await sql<any[]>`
      SELECT payload FROM activity_log WHERE org_id = ${org.id} AND verb = 'action_item.decided'
    `;
    expect(activity.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(activity) + logLines.join('\n');
    expect(serialized).not.toContain('confidential vendor contract');
    expect(serialized).not.toContain(QUOTE);
    expect(activity.find((a) => a.payload.taskId === res.json().task.id)!.payload).toMatchObject({
      decision: 'approve',
      taskOperation: 'created',
    });
  });
});
