import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { serializeSession } from '../lib/session';
import { createSessionPayload, generateUuidV7, formatETag } from '@workspace/core';
import { GET as getNotesBFF } from '../app/api/orgs/[orgId]/meetings/[meetingId]/notes/route';
import { getServerContext } from '../lib/server-context';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
} from '@workspace/db';

describe('Web BFF Journey: Meeting Notes & Action Suggestions (Requirement N-1)', () => {
  const TEST_SECRET = 'a-super-secret-key-that-is-at-least-32-chars-long!';

  let ownerUser: { id: string; email: string };
  let hostMemberUser: { id: string; email: string };
  let viewerUser: { id: string; email: string };

  let testOrg: { id: string; slug: string };

  let ownerCookie: string;
  let hostMemberCookie: string;
  let viewerCookie: string;

  let meetingId: string;
  const meetingVersion = 2;

  beforeEach(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ORIGIN_VERIFY_SECRET = TEST_SECRET;

    const { db, sql } = getServerContext();

    // 1. Seed users
    const owner = await findOrCreateUserByEmail(db, {
      email: `web-notes-owner-${Date.now()}@example.com`,
      name: 'Web Notes Owner',
    });
    ownerUser = { id: owner.id, email: owner.email };

    const host = await findOrCreateUserByEmail(db, {
      email: `web-notes-host-${Date.now()}@example.com`,
      name: 'Web Notes Host',
    });
    hostMemberUser = { id: host.id, email: host.email };

    const viewer = await findOrCreateUserByEmail(db, {
      email: `web-notes-viewer-${Date.now()}@example.com`,
      name: 'Web Notes Viewer',
    });
    viewerUser = { id: viewer.id, email: viewer.email };

    // 2. Organization and memberships
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Web Notes Primary Org',
      slug: `web-notes-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${testOrg.id}, ${hostMemberUser.id}, 'member'),
             (${testOrg.id}, ${viewerUser.id}, 'viewer')
    `;

    // 3. Session cookies
    ownerCookie = serializeSession(
      createSessionPayload({
        userId: ownerUser.id,
        email: ownerUser.email,
        activeOrgId: testOrg.id,
        role: 'owner',
        sessionEpoch: 1,
      })
    );

    hostMemberCookie = serializeSession(
      createSessionPayload({
        userId: hostMemberUser.id,
        email: hostMemberUser.email,
        activeOrgId: testOrg.id,
        role: 'member',
        sessionEpoch: 1,
      })
    );

    viewerCookie = serializeSession(
      createSessionPayload({
        userId: viewerUser.id,
        email: viewerUser.email,
        activeOrgId: testOrg.id,
        role: 'viewer',
        sessionEpoch: 1,
      })
    );

    // 4. Create project node
    const projectNodeId = generateUuidV7();
    await sql`
      INSERT INTO nodes (
        id, org_id, kind, name, path, visibility, rollup
      ) VALUES (
        ${projectNodeId}, ${testOrg.id}, 'project', 'Web Test Project',
        ${`web-project-${Date.now()}`}, 'public', '{}'::jsonb
      )
    `;

    // 5. Create meeting record
    meetingId = generateUuidV7();
    await sql`
      INSERT INTO meetings (
        id, org_id, provider, provider_meeting_uuid, provider_numeric_id,
        title, zoom_host_id, zoom_host_email, host_id, status,
        processing_generation, node_id, version, created_at, updated_at
      ) VALUES (
        ${meetingId}, ${testOrg.id}, 'zoom',
        ${`uuid-web-notes-${Date.now()}`}, ${`num-web-${Date.now()}`},
        'Sprint 15 Web Review', 'zh_web_host', ${hostMemberUser.email}, ${hostMemberUser.id},
        'completed', 1, ${projectNodeId}, ${meetingVersion}, now(), now()
      )
    `;

    // 6. Insert doc
    const docId = generateUuidV7();
    await sql`
      INSERT INTO docs (
        id, org_id, node_id, title, body_md, version, created_by, updated_by, source_meeting_id, created_at, updated_at
      ) VALUES (
        ${docId}, ${testOrg.id}, ${projectNodeId}, 'Notes: Sprint 15 Web Review',
        '## Web Notes Summary', 1, NULL, NULL, ${meetingId}, now(), now()
      )
    `;

    // 7. Insert meeting_notes
    const notesId = generateUuidV7();
    await sql`
      INSERT INTO meeting_notes (
        id, org_id, meeting_id, summary_md, decisions, open_questions,
        evidence, model, prompt_version, cost_inr, doc_id, created_at, updated_at
      ) VALUES (
        ${notesId}, ${testOrg.id}, ${meetingId},
        '## Web Notes Summary\nReviewed Sprint 15 UI and evidence anchors.',
        ${JSON.stringify([{ text: 'Adopt interactive drawer', evidence: [{ seq: 1, quote: 'Interactive drawer' }] }])}::jsonb,
        ${JSON.stringify([])}::jsonb,
        '[]'::jsonb,
        'claude-3-7-sonnet-latest', 'v1.0.0', 0.20, ${docId}, now(), now()
      )
    `;

    // 8. Insert action item
    const actionId = generateUuidV7();
    await sql`
      INSERT INTO action_items (
        id, org_id, meeting_id, text, owner_name, due_phrase,
        evidence, confidence, state, proposal_type, task_id, decided_by,
        created_at, updated_at
      ) VALUES (
        ${actionId}, ${testOrg.id}, ${meetingId},
        'Review evidence chip click handling', 'Web Host', 'by Friday',
        ${JSON.stringify([{ seq: 1, quote: 'Interactive drawer' }])}::jsonb,
        0.98, 'suggested', 'create_task', NULL, NULL, now(), now()
      )
    `;
  });

  it('rejects unauthenticated requests with 401', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/notes`,
      { method: 'GET' }
    );

    const res = await getNotesBFF(req, {
      params: Promise.resolve({ orgId: testOrg.id, meetingId }),
    });

    expect(res.status).toBe(401);
  });

  it('lets a viewer read notes of an accessible project read-only (canDecide=false)', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/notes`,
      {
        method: 'GET',
        headers: { cookie: `workspace_session=${viewerCookie}` },
      }
    );

    const res = await getNotesBFF(req, {
      params: Promise.resolve({ orgId: testOrg.id, meetingId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes.summaryMd).toContain('Web Notes Summary');
    expect(body.actionItems[0]).toMatchObject({ state: 'suggested', canDecide: false });
  });

  it('allows meeting host to fetch notes, decisions, and action suggestions (200 OK + ETag)', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/notes`,
      {
        method: 'GET',
        headers: { cookie: `workspace_session=${hostMemberCookie}` },
      }
    );

    const res = await getNotesBFF(req, {
      params: Promise.resolve({ orgId: testOrg.id, meetingId }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBe(formatETag(meetingVersion));

    const body = await res.json();
    expect(body.notes).toBeDefined();
    expect(body.notes.summaryMd).toContain('Web Notes Summary');
    expect(body.notes.decisions.length).toBe(1);
    expect(body.notes.decisions[0].text).toBe('Adopt interactive drawer');

    expect(body.actionItems.length).toBe(1);
    expect(body.actionItems[0].text).toBe('Review evidence chip click handling');
    expect(body.actionItems[0].ownerName).toBe('Web Host');
    expect(body.actionItems[0].state).toBe('suggested');
    expect(body.actionItems[0].taskId).toBeNull(); // ZERO tasks created
    expect(body.actionItems[0].evidence.length).toBe(1);
    expect(body.actionItems[0].evidence[0].seq).toBe(1);
  });

  it('allows organization owner to fetch notes (200 OK)', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/notes`,
      {
        method: 'GET',
        headers: { cookie: `workspace_session=${ownerCookie}` },
      }
    );

    const res = await getNotesBFF(req, {
      params: Promise.resolve({ orgId: testOrg.id, meetingId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).toBeDefined();
  });
});
