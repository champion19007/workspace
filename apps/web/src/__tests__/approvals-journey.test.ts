import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { createSessionPayload, generateUuidV7, type ActionItemDTO } from '@workspace/core';
import {
  createOrganizationWithOwner,
  createTask,
  findOrCreateUserByEmail,
  persistMeetingNotesAndSuggestions,
} from '@workspace/db';
import { SESSION_COOKIE_NAME, serializeSession } from '../lib/session';
import { getServerContext } from '../lib/server-context';
import { buildEditDecision, editNeedsDedupAck, initialEditForm } from '../lib/action-item-decision';
import { GET as listBFF } from '../app/api/orgs/[orgId]/action-items/route';
import { GET as getBFF } from '../app/api/orgs/[orgId]/action-items/[actionItemId]/route';
import { POST as decideBFF } from '../app/api/orgs/[orgId]/action-items/[actionItemId]/decision/route';
import { GET as notesBFF } from '../app/api/orgs/[orgId]/meetings/[meetingId]/notes/route';
import { GET as meetingBFF } from '../app/api/orgs/[orgId]/meetings/[meetingId]/route';
import { GET as transcriptBFF } from '../app/api/orgs/[orgId]/meetings/[meetingId]/transcript/route';

/**
 * Stage 17 web journey (Requirement N-2): the BFF routes the approvals inbox and meeting drawer use,
 * against real PostgreSQL. Suggestions come from the real persist pipeline; tasks appear only after a decision.
 */
describe('Web BFF Journey: Approvals inbox and meeting drawer decisions (Requirement N-2)', () => {
  const SECRET = 'a-super-secret-key-that-is-at-least-32-chars-long!';
  const ts = Date.now();
  const HOST_ZOOM_ID = `zh_web_appr_${ts}`;
  const QUOTE = 'I will publish the approvals runbook';

  type U = { id: string; email: string; cookie: string };
  let owner: U, member: U, member2: U, outsider: U, viewer: U, foreign: U;
  let org: { id: string; slug: string };
  let foreignOrg: { id: string; slug: string };
  let projectId: string;
  let publicProjectId: string;

  const headers = (u: U | null, extra: Record<string, string> = {}) => ({
    ...(u ? { cookie: `${SESSION_COOKIE_NAME}=${u.cookie}` } : {}),
    ...extra,
  });
  const list = (u: U | null, qs = '', orgId = org.id) =>
    listBFF(new NextRequest(`http://localhost/api/orgs/${orgId}/action-items${qs}`, { headers: headers(u) }), {
      params: Promise.resolve({ orgId }),
    });
  const getOne = (u: U, id: string, orgId = org.id) =>
    getBFF(new NextRequest(`http://localhost/api/orgs/${orgId}/action-items/${id}`, { headers: headers(u) }), {
      params: Promise.resolve({ orgId, actionItemId: id }),
    });
  const decide = (u: U | null, id: string, body: unknown, ifMatch: string | null = '"v1"', extra: Record<string, string> = {}) =>
    decideBFF(
      new NextRequest(`http://localhost/api/orgs/${org.id}/action-items/${id}/decision`, {
        method: 'POST',
        headers: headers(u, { 'content-type': 'application/json', ...(ifMatch ? { 'if-match': ifMatch } : {}), ...extra }),
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ orgId: org.id, actionItemId: id }) }
    );
  const notes = (u: U, meetingId: string) =>
    notesBFF(new NextRequest(`http://localhost/api/orgs/${org.id}/meetings/${meetingId}/notes`, { headers: headers(u) }), {
      params: Promise.resolve({ orgId: org.id, meetingId }),
    });
  const meeting = (u: U, meetingId: string) =>
    meetingBFF(new NextRequest(`http://localhost/api/orgs/${org.id}/meetings/${meetingId}`, { headers: headers(u) }), {
      params: Promise.resolve({ orgId: org.id, meetingId }),
    });
  const transcript = (u: U, meetingId: string) =>
    transcriptBFF(new NextRequest(`http://localhost/api/orgs/${org.id}/meetings/${meetingId}/transcript`, { headers: headers(u) }), {
      params: Promise.resolve({ orgId: org.id, meetingId }),
    });

  const taskCount = async () => {
    const { sql } = getServerContext();
    return (await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM tasks WHERE org_id = ${org.id}`)[0]!.c;
  };

  async function seedMeeting(texts: string[], enrich: Record<string, unknown> = { dedup_status: 'no_match' }) {
    const { sql } = getServerContext();
    const meetingId = generateUuidV7();
    const runId = generateUuidV7();
    await sql`
      INSERT INTO meetings (id, org_id, provider, provider_meeting_uuid, title, zoom_host_id, zoom_host_email,
        host_id, status, processing_generation, node_id, actual_start_at, version)
      VALUES (${meetingId}, ${org.id}, 'zoom', ${`web-appr-${meetingId}`}, 'Web Approvals Sync', ${HOST_ZOOM_ID},
        ${member.email}, ${member.id}, 'routed', 1, ${projectId}, '2026-10-05T04:30:00Z', 1)
    `;
    for (const [i, text] of texts.entries()) {
      await sql`
        INSERT INTO transcript_segments (org_id, meeting_id, seq, speaker_label, user_id, start_ms, end_ms, text)
        VALUES (${org.id}, ${meetingId}, ${i + 1}, 'Speaker', ${member.id}, ${i * 1000}, ${i * 1000 + 900}, ${text + ' this week.'})
      `;
    }
    await sql`
      INSERT INTO extraction_runs (id, org_id, meeting_id, node_id, run_key, processing_generation,
        transcript_checksum, prompt_version, model, status)
      VALUES (${runId}, ${org.id}, ${meetingId}, ${projectId}, ${`run-${runId}`}, 1, 'chk', 'v1.0.0', 'test-model', 'completed')
    `;
    const persisted = await persistMeetingNotesAndSuggestions(sql, {
      orgId: org.id,
      meetingId,
      nodeId: projectId,
      processingGeneration: 1,
      extractionRunId: runId,
      summaryMd: 'Approvals web journey',
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
    for (const [col, val] of Object.entries(enrich)) {
      await sql`UPDATE action_items SET ${sql(col)} = ${val as string} WHERE id IN ${sql(itemIds)}`;
    }
    await sql`UPDATE action_items SET deduped_at = now() WHERE id IN ${sql(itemIds)}`;
    return { meetingId, itemIds };
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET = SECRET;
    process.env.ORIGIN_VERIFY_SECRET = SECRET;
    const { db, sql } = getServerContext();

    const mk = async (tag: string): Promise<U> => {
      const u = await findOrCreateUserByEmail(db, { email: `web-s17-${tag}-${ts}@example.com`, name: `Web S17 ${tag}` });
      return { id: u.id, email: u.email, cookie: '' };
    };
    owner = await mk('owner');
    member = await mk('member');
    member2 = await mk('member2');
    outsider = await mk('outsider');
    viewer = await mk('viewer');
    foreign = await mk('foreign');

    ({ org } = await createOrganizationWithOwner(db, { name: 'Web S17 Org', slug: `web-s17-${ts}`, userId: owner.id }));
    ({ org: foreignOrg } = await createOrganizationWithOwner(db, {
      name: 'Web S17 Foreign',
      slug: `web-s17-foreign-${ts}`,
      userId: foreign.id,
    }));
    await sql`
      INSERT INTO memberships (org_id, user_id, role) VALUES
        (${org.id}, ${member.id}, 'member'), (${org.id}, ${member2.id}, 'member'),
        (${org.id}, ${outsider.id}, 'member'), (${org.id}, ${viewer.id}, 'viewer')
    `;
    for (const u of [owner, member, member2, outsider, viewer, foreign]) {
      u.cookie = serializeSession(
        createSessionPayload({ userId: u.id, email: u.email, activeOrgId: u === foreign ? foreignOrg.id : org.id, role: 'member', sessionEpoch: 1 })
      );
    }

    projectId = generateUuidV7();
    publicProjectId = generateUuidV7();
    await sql`
      INSERT INTO nodes (id, org_id, kind, name, path, visibility, rollup) VALUES
        (${projectId}, ${org.id}, 'project', 'Web Approvals Private', ${`web_s17_${ts}`}, 'private', '{}'::jsonb),
        (${publicProjectId}, ${org.id}, 'project', 'Web Approvals Public', ${`web_s17_pub_${ts}`}, 'public', '{}'::jsonb)
    `;
    await sql`
      INSERT INTO node_members (org_id, node_id, user_id) VALUES
        (${org.id}, ${projectId}, ${member.id}), (${org.id}, ${projectId}, ${member2.id}), (${org.id}, ${projectId}, ${viewer.id})
    `;
    const [integration] = await sql<{ id: string }[]>`
      INSERT INTO integrations (org_id, provider, account_id, secret_arn, status)
      VALUES (${org.id}, 'zoom', ${`acct-web-s17-${ts}`}, 'test-secret-ref', 'connected')
      RETURNING id
    `;
    await sql`
      INSERT INTO zoom_host_consents (org_id, integration_id, zoom_user_id, zoom_email, user_id, consent_status, consent_timestamp)
      VALUES (${org.id}, ${integration!.id}, ${HOST_ZOOM_ID}, ${member.email}, ${member.id}, 'opted_in', '2026-01-01T00:00:00Z')
    `;
  });

  afterAll(async () => {
    const { sql } = getServerContext();
    if (org) await sql`DELETE FROM orgs WHERE id = ${org.id}`;
    if (foreignOrg) await sql`DELETE FROM orgs WHERE id = ${foreignOrg.id}`;
  });

  it('rejects unauthenticated list and decision requests with 401 problem+json', async () => {
    const res = await list(null);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect((await decide(null, generateUuidV7(), { decision: 'approve' })).status).toBe(401);
  });

  it('lists the permission-filtered inbox ("Suggested for me" vs "All I can review") without creating tasks', async () => {
    const { meetingId, itemIds } = await seedMeeting([QUOTE, 'Review the approvals dashboard copy']);
    const { sql } = getServerContext();
    await sql`UPDATE action_items SET suggested_owner_id = ${member2.id} WHERE id = ${itemIds[1]!}`;
    const before = await taskCount();

    const mine = await (await list(member2, `?assignee=me&meetingId=${meetingId}`)).json();
    expect(mine.items.map((i: ActionItemDTO) => i.id)).toEqual([itemIds[1]]);
    expect(mine.items[0]).toMatchObject({
      canDecide: true,
      meeting: { id: meetingId, title: 'Web Approvals Sync' },
      project: { id: projectId, name: 'Web Approvals Private' },
      suggestedOwner: { id: member2.id },
    });

    const all = await (await list(member2, `?meetingId=${meetingId}`)).json();
    expect(all.items.map((i: ActionItemDTO) => i.id)).toEqual(itemIds);
    expect((await (await list(outsider, `?meetingId=${meetingId}`)).json()).items).toHaveLength(0);
    expect(await taskCount()).toBe(before);

    const bad = await list(member, '?limit=500');
    expect(bad.status).toBe(422);
    expect((await bad.json()).code).toBe('VALIDATION_ERROR');
  });

  it('GET single item returns the ETag; private and cross-org items are 404', async () => {
    const { itemIds } = await seedMeeting([QUOTE]);
    const res = await getOne(member, itemIds[0]!);
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe('"v1"');
    expect((await getOne(outsider, itemIds[0]!)).status).toBe(404);
    expect((await getOne(foreign, itemIds[0]!, foreignOrg.id)).status).toBe(404);
  });

  it('approve: If-Match is enforced, Idempotency-Key replays the same task, and a second decision is 409', async () => {
    const { meetingId, itemIds } = await seedMeeting([QUOTE], { dedup_status: 'no_match', suggested_owner_id: member2.id });
    const id = itemIds[0]!;
    const before = await taskCount();

    const missing = await decide(member, id, { decision: 'approve' }, null);
    expect(missing.status).toBe(428);
    expect((await missing.json()).code).toBe('PRECONDITION_REQUIRED');
    const stale = await decide(member, id, { decision: 'approve' }, '"v5"');
    expect(stale.status).toBe(412);
    expect((await stale.json()).currentEntity).toMatchObject({ id, version: 1, state: 'suggested' });
    expect((await decide(viewer, id, { decision: 'approve' })).status).toBe(403);
    expect((await decide(outsider, id, { decision: 'approve' })).status).toBe(404);
    expect(await taskCount()).toBe(before);

    const key = `web-s17-${id}`;
    const ok = await decide(member, id, { decision: 'approve' }, '"v1"', { 'idempotency-key': key });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('etag')).toBe('"v2"');
    const result = await ok.json();
    expect(result).toMatchObject({
      taskOperation: 'created',
      task: { projectId, assigneeId: member2.id, source: 'zoom_meeting' },
      actionItem: { id, state: 'approved', version: 2, canDecide: false },
    });
    expect(await taskCount()).toBe(before + 1);

    const replay = await decide(member, id, { decision: 'approve' }, '"v1"', { 'idempotency-key': key });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('x-idempotent-replayed')).toBe('true');
    expect(replay.headers.get('etag')).toBe('"v2"');
    expect((await replay.json()).task.id).toBe(result.task.id);
    expect(await taskCount()).toBe(before + 1);

    const again = await decide(member2, id, { decision: 'approve' }, '"v2"');
    expect(again.status).toBe(409);
    const problem = await again.json();
    expect(problem.code).toBe('ALREADY_DECIDED');
    expect(problem.details.actionItem).toMatchObject({ id, state: 'approved' });

    // The meeting drawer reads decision state and the task link from the notes endpoint.
    const drawer = await (await notes(member, meetingId)).json();
    expect(drawer.actionItems[0]).toMatchObject({
      id,
      state: 'approved',
      canDecide: false,
      task: { id: result.task.id, key: result.task.key, projectId },
    });
  });

  it('concurrent double-approve through the BFF creates exactly one task', async () => {
    const { itemIds } = await seedMeeting([QUOTE]);
    const before = await taskCount();
    const codes = (
      await Promise.all([decide(member, itemIds[0]!, { decision: 'approve' }), decide(member2, itemIds[0]!, { decision: 'approve' })])
    )
      .map((r) => r.status)
      .sort();
    expect(codes[0]).toBe(200);
    expect([409, 412]).toContain(codes[1]);
    expect(await taskCount()).toBe(before + 1);
  });

  it('edit dialog body sends the shown assignee/due plus changed fields, so the decision log stays accurate', async () => {
    const { itemIds } = await seedMeeting([QUOTE], { dedup_status: 'no_match', suggested_owner_id: member.id, suggested_due: '2026-10-20' });
    const item: ActionItemDTO = await (await getOne(member, itemIds[0]!)).json();
    const eligible = (userId: string) => [member.id, member2.id].includes(userId);

    const initial = initialEditForm(item, 'create', null, eligible);
    expect(initial).toMatchObject({ assigneeId: member.id, dueDate: '2026-10-20', projectId, title: QUOTE });
    const body = buildEditDecision(item, { ...initial, title: 'Publish the approvals runbook v2', dueDate: '2026-10-27' }, initial);
    expect(body).toEqual({
      decision: 'edit',
      mode: 'create',
      assigneeId: member.id,
      dueDate: '2026-10-27',
      title: 'Publish the approvals runbook v2',
    });

    const res = await decide(member, item.id, body, `"v${item.version}"`);
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.task).toMatchObject({ title: 'Publish the approvals runbook v2', dueDate: '2026-10-27', assigneeId: member.id });
    expect(result.actionItem.state).toBe('edited');

    const { sql } = getServerContext();
    const [log] = await sql<{ edit_summary: { changedFields: string[] } }[]>`
      SELECT edit_summary FROM action_item_decisions WHERE action_item_id = ${item.id}
    `;
    expect([...log!.edit_summary.changedFields].sort()).toEqual(['dueDate', 'title']);
  });

  it('edit into another project applies the assignee the dialog showed (never a hidden AI default) and needs a dedup acknowledgement', async () => {
    // Suggested owner is an org member outside the meeting's private project: the dialog prefills "Unassigned".
    const { itemIds } = await seedMeeting([QUOTE], { dedup_status: 'no_match', suggested_owner_id: outsider.id });
    const item: ActionItemDTO = await (await getOne(member, itemIds[0]!)).json();
    const initial = initialEditForm(item, 'create', null, (userId) => [member.id, member2.id].includes(userId));
    expect(initial.assigneeId).toBe('');

    // The human moves the task to a public project (where the suggested owner WOULD be eligible) and keeps "Unassigned".
    const form = { ...initial, projectId: publicProjectId };
    expect(editNeedsDedupAck(item, form)).toBe(true); // dedup only ran against the meeting's project
    const unacknowledged = await decide(member, item.id, buildEditDecision(item, form, initial), `"v${item.version}"`);
    expect(unacknowledged.status).toBe(409);
    expect((await unacknowledged.json()).code).toBe('DEDUP_INCOMPLETE');

    const body = buildEditDecision(item, { ...form, acknowledgeIncompleteDedup: true }, initial);
    expect(body).toMatchObject({ assigneeId: null, projectId: publicProjectId, acknowledgeIncompleteDedup: true });
    const res = await decide(member, item.id, body, `"v${item.version}"`);
    expect(res.status).toBe(200);
    expect((await res.json()).task).toMatchObject({ projectId: publicProjectId, assigneeId: null });
  });

  it('meeting drawer reads: viewers may read; a host outside the private project gets 404 (no task data)', async () => {
    const { db } = getServerContext();
    const target = await createTask(db, {
      orgId: org.id,
      actorUserId: owner.id,
      role: 'owner',
      input: { projectId, title: 'Private approvals target', description: 'Private details', status: 'todo', priority: 'medium' },
    });
    const { meetingId } = await seedMeeting([QUOTE], {
      proposal_type: 'update_task',
      target_task_id: target.id,
      target_task_version: target.version,
      dedup_status: 'matched',
    });

    const asViewer = await notes(viewer, meetingId);
    expect(asViewer.status).toBe(200);
    expect((await asViewer.json()).actionItems[0]).toMatchObject({ canDecide: false, targetTask: { id: target.id } });

    // The verified host is not a member of the private project the meeting was routed to.
    const { sql } = getServerContext();
    await sql`UPDATE meetings SET host_id = ${outsider.id} WHERE id = ${meetingId}`;
    for (const res of [await notes(outsider, meetingId), await transcript(outsider, meetingId), await meeting(outsider, meetingId)]) {
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain('Private details');
    }

    // Deep links resolve a single meeting even when it is not in the loaded list page.
    const single = await meeting(member, meetingId);
    expect(single.status).toBe(200);
    expect((await single.json()).meeting).toMatchObject({ id: meetingId, nodeId: projectId });
    expect((await meeting(member, 'not-a-uuid')).status).toBe(404);
  });

  it('update proposal whose target changed: 409 TARGET_CHANGED, re-presented, then applied to the fresh version', async () => {
    const { db, sql } = getServerContext();
    const target = await createTask(db, {
      orgId: org.id,
      actorUserId: owner.id,
      role: 'owner',
      input: { projectId, title: 'Approvals runbook', description: 'Existing notes', status: 'todo', priority: 'medium' },
    });
    const { itemIds } = await seedMeeting([QUOTE], {
      proposal_type: 'update_task',
      target_task_id: target.id,
      target_task_version: target.version,
      dedup_status: 'matched',
      suggested_due: '2026-10-30',
    });
    const id = itemIds[0]!;
    await sql`UPDATE tasks SET title = 'Approvals runbook (renamed)', version = version + 1 WHERE id = ${target.id}`;

    const refused = await decide(member, id, { decision: 'approve' });
    expect(refused.status).toBe(409);
    const problem = await refused.json();
    expect(problem.code).toBe('TARGET_CHANGED');
    expect(problem.details.currentTask).toMatchObject({ id: target.id, version: 2 });

    // The card re-fetches the item: the preview now shows the current target task.
    const fresh: ActionItemDTO = await (await getOne(member, id)).json();
    expect(fresh).toMatchObject({ state: 'suggested', targetTaskVersion: 1, targetTask: { id: target.id, version: 2 } });

    const initial = initialEditForm(fresh, 'update', { ...fresh.targetTask!, assigneeName: null }, () => true);
    const body = buildEditDecision(fresh, initial, initial);
    expect(body).toEqual({
      decision: 'edit',
      mode: 'update',
      assigneeId: null,
      dueDate: '2026-10-30',
      targetTaskId: target.id,
      targetTaskVersion: 2,
    });
    const applied = await decide(member, id, body, `"v${fresh.version}"`);
    expect(applied.status).toBe(200);
    expect((await applied.json()).task).toMatchObject({ id: target.id, version: 3, dueDate: '2026-10-30' });
  });

  it('reject records the reason and note, changes no task, and shows the outcome in the drawer', async () => {
    const { meetingId, itemIds } = await seedMeeting([QUOTE]);
    const before = await taskCount();
    expect((await decide(member, itemIds[0]!, { decision: 'reject' })).status).toBe(422);
    const res = await decide(member, itemIds[0]!, { decision: 'reject', reason: 'not_a_task', note: 'Just a status update' });
    expect(res.status).toBe(200);
    expect((await res.json()).task).toBeNull();
    expect(await taskCount()).toBe(before);
    const drawer = await (await notes(member, meetingId)).json();
    expect(drawer.actionItems[0]).toMatchObject({
      state: 'rejected',
      decisionReason: 'not_a_task',
      decisionNote: 'Just a status update',
      task: null,
    });
  });
});
