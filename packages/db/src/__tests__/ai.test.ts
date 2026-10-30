import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { transcriptToLines } from '@workspace/core';
import * as schema from '../schema/index.js';
import { findOrCreateUserByEmail, createOrganizationWithOwner } from '../auth-operations.js';
import { createNode, addNodeMember } from '../node-operations.js';
import { createTask } from '../task-operations.js';
import { createDoc } from '../doc-operations.js';
import {
  getProgressSummary,
  progressScopeKey,
  questionToTsQuery,
  saveProgressSummary,
  searchWorkspace,
} from '../ai-operations.js';

describe('AI helpers: transcript lines and question words', () => {
  it('reads "Name: words" lines and WebVTT cues', () => {
    expect(transcriptToLines('Priya: Can we launch Friday?\n\nArjun: I will send the designs by Wednesday.\nnotes without a speaker')).toEqual([
      { seq: 1, speakerLabel: 'Priya', text: 'Can we launch Friday?' },
      { seq: 2, speakerLabel: 'Arjun', text: 'I will send the designs by Wednesday.' },
      { seq: 3, speakerLabel: null, text: 'notes without a speaker' },
    ]);
    const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\n<v Priya>Can we launch Friday?</v>\n';
    expect(transcriptToLines(vtt)).toEqual([{ seq: 1, speakerLabel: 'Priya', text: 'Can we launch Friday?' }]);
  });

  it('turns a question into an any-word search and ignores punctuation', () => {
    expect(questionToTsQuery("What's late on the invoice?!")).toBe('what | late | on | the | invoice');
    expect(questionToTsQuery('?? !')).toBeNull();
  });
});

// Ask AI and the Progress summary only ever see what the asking person can see.
describe('AI data access (Real PostgreSQL)', () => {
  const directUrl =
    process.env.DATABASE_DIRECT_URL ||
    'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev?sslmode=disable';

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let orgId: string;
  let ownerId: string;
  let clientId: string;
  let sharedProjectId: string;

  beforeAll(async () => {
    sql = postgres(directUrl, { max: 5 });
    db = drizzle(sql, { schema });
    const stamp = Date.now();
    const mk = (who: string) => findOrCreateUserByEmail(db, { email: `ai-${who}-${stamp}@workspace.dev`, name: who });
    [ownerId, clientId] = [(await mk('Owner')).id, (await mk('Client')).id];
    const { org } = await createOrganizationWithOwner(db, { name: 'AI Org', slug: `ai-${stamp}`, userId: ownerId });
    orgId = org.id;
    await sql`INSERT INTO memberships (org_id, user_id, role) VALUES (${orgId}, ${clientId}, 'client')`;
    const asOwner = { orgId, userId: ownerId, role: 'owner' };
    const team = await createNode(db, { ...asOwner, name: 'Delivery', kind: 'team' });
    sharedProjectId = (await createNode(db, { ...asOwner, name: 'Acme website', kind: 'project', parentId: team.id })).id;
    const otherProjectId = (await createNode(db, { ...asOwner, name: 'Globex app', kind: 'project', parentId: team.id })).id;
    for (const [projectId, title] of [[sharedProjectId, 'Send the invoice to Acme'], [otherProjectId, 'Send the invoice to Globex']] as const) {
      await createTask(db, { orgId, actorUserId: ownerId, role: 'owner', input: { projectId, title, status: 'todo', priority: 'medium' } });
    }
    await createDoc(db, { orgId, actorUserId: ownerId, role: 'owner', input: { nodeId: otherProjectId, title: 'Globex invoice terms', bodyMd: 'The invoice is due in 30 days.' } });
    await addNodeMember(db, { orgId, nodeId: sharedProjectId, targetUserId: clientId, actorUserId: ownerId, role: 'owner' });
  });

  afterAll(async () => {
    if (orgId) await sql`DELETE FROM orgs WHERE id = ${orgId}`;
    await sql.end({ timeout: 5 });
  });

  it('finds matching tasks and docs only in projects the person can see', async () => {
    const forOwner = await searchWorkspace(db, { orgId, userId: ownerId, role: 'owner', question: 'when is the invoice due?' });
    expect(forOwner.tasks.map((t) => t.title).sort()).toEqual(['Send the invoice to Acme', 'Send the invoice to Globex']);
    expect(forOwner.docs.map((d) => d.title)).toEqual(['Globex invoice terms']);
    expect(forOwner.docs[0]!.excerpt).toContain('invoice');

    const forClient = await searchWorkspace(db, { orgId, userId: clientId, role: 'client', question: 'when is the invoice due?' });
    expect(forClient.tasks.map((t) => t.title)).toEqual(['Send the invoice to Acme']);
    expect(forClient.docs).toEqual([]);
  });

  it("keeps each person's summary to themselves and to the projects it was written from", async () => {
    const scopeKey = progressScopeKey([sharedProjectId]);
    const body = { headline: 'On track', paragraphs: ['Acme website is moving.'], watch: [], demo: false };
    await saveProgressSummary(db, { orgId, userId: clientId, role: 'client', scopeKey, body });

    expect(await getProgressSummary(db, { orgId, userId: clientId, role: 'client', scopeKey, maxAgeMinutes: 60 })).toMatchObject(body);
    expect(await getProgressSummary(db, { orgId, userId: ownerId, role: 'owner', scopeKey, maxAgeMinutes: 60 })).toBeNull();
    const widerScope = progressScopeKey([sharedProjectId, ownerId]);
    expect(await getProgressSummary(db, { orgId, userId: clientId, role: 'client', scopeKey: widerScope, maxAgeMinutes: 60 })).toBeNull();
  });
});
