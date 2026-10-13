import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { serializeSession } from '../lib/session';
import { createSessionPayload } from '@workspace/core';
import { GET as listMeetingsBFF } from '../app/api/orgs/[orgId]/meetings/route';
import { POST as retryMeetingBFF } from '../app/api/orgs/[orgId]/meetings/[meetingId]/retry/route';
import { getServerContext } from '../lib/server-context';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  connectZoomIntegration,
} from '@workspace/db';

describe('Web BFF & UI Journey: Zoom Meetings Intake & Lifecycle (Requirement M-2 & M-4)', () => {
  const TEST_SECRET = 'a-super-secret-key-that-is-at-least-32-chars-long!';
  let ownerUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let testOrg: { id: string; slug: string };
  let otherOrg: { id: string; slug: string };

  let ownerCookie: string;
  let memberCookie: string;

  const ZOOM_ACCOUNT_ID = `zoom_act_web_journey_${Date.now()}`;
  const HOST_ZOOM_ID = 'zoom_usr_web_journey_host';

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ORIGIN_VERIFY_SECRET = TEST_SECRET;

    const { db, sql, ports } = getServerContext();

    // 1. Seed users
    const owner = await findOrCreateUserByEmail(db, {
      email: `web-mtg-owner-${Date.now()}@example.com`,
      name: 'Web Meeting Owner',
    });
    ownerUser = { id: owner.id, email: owner.email };

    const member = await findOrCreateUserByEmail(db, {
      email: `web-mtg-member-${Date.now()}@example.com`,
      name: 'Web Meeting Member',
    });
    memberUser = { id: member.id, email: member.email };

    // 2. Primary org
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Web Meeting Primary Org',
      slug: `web-mtg-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${testOrg.id}, ${memberUser.id}, 'member')
    `;

    // 3. Secondary org
    const { org: secOrg } = await createOrganizationWithOwner(db, {
      name: 'Web Meeting Secondary Org',
      slug: `web-mtg-sec-${Date.now()}`,
      userId: memberUser.id,
    });
    otherOrg = { id: secOrg.id, slug: secOrg.slug };

    // 4. Session cookies
    ownerCookie = serializeSession(
      createSessionPayload({
        userId: ownerUser.id,
        email: ownerUser.email,
        activeOrgId: testOrg.id,
        role: 'owner',
        sessionEpoch: 1,
      })
    );

    memberCookie = serializeSession(
      createSessionPayload({
        userId: memberUser.id,
        email: memberUser.email,
        activeOrgId: testOrg.id,
        role: 'member',
        sessionEpoch: 1,
      })
    );

    // 5. Connect Zoom integration for testOrg
    await connectZoomIntegration(sql, ports.secretStore, ports.zoomClient, {
      orgId: testOrg.id,
      accountId: ZOOM_ACCOUNT_ID,
      userId: ownerUser.id,
      scopes: ['recording:read:admin', 'user:read:admin'],
      tokens: {
        access_token: 'mock_access_token_journey',
        refresh_token: 'mock_refresh_token_journey',
        expires_in: 3600,
        scope: 'recording:read:admin user:read:admin',
        token_type: 'bearer',
      },
    });

    // 6. Set host consent: opted-in
    const [integrationRow] = await sql<{ id: string }[]>`
      SELECT id FROM integrations WHERE org_id = ${testOrg.id}
    `;

    await sql`
      INSERT INTO zoom_host_consents (
        org_id, integration_id, zoom_user_id, zoom_email, user_id, consent_status, admin_disabled
      ) VALUES (
        ${testOrg.id}, ${integrationRow.id}, ${HOST_ZOOM_ID}, ${memberUser.email}, ${memberUser.id}, 'opted_in', false
      )
    `;
  });

  beforeEach(async () => {
    const { sql } = getServerContext();
    if (testOrg) {
      await sql`DELETE FROM meetings WHERE org_id = ${testOrg.id}`;
    }
  });

  afterAll(async () => {
    const { sql } = getServerContext();
    if (testOrg) {
      await sql`DELETE FROM meetings WHERE org_id = ${testOrg.id}`;
      await sql`DELETE FROM zoom_host_consents WHERE org_id = ${testOrg.id}`;
      await sql`DELETE FROM integrations WHERE org_id = ${testOrg.id}`;
      await sql`DELETE FROM orgs WHERE id = ${testOrg.id}`;
    }
    if (otherOrg) await sql`DELETE FROM orgs WHERE id = ${otherOrg.id}`;
  });

  it('rejects unauthenticated requests to meetings BFF with 401', async () => {
    const req = new NextRequest(`http://localhost/api/orgs/${testOrg.id}/meetings`);
    const res = await listMeetingsBFF(req, { params: Promise.resolve({ orgId: testOrg.id }) });
    expect(res.status).toBe(401);
  });

  it('allows Owner to list meetings with filtering and search', async () => {
    const { sql } = getServerContext();

    // Seed 2 meetings: 1 ready, 1 pending consent
    await sql`
      INSERT INTO meetings (
        org_id, provider, provider_meeting_uuid, provider_numeric_id, title,
        zoom_host_id, zoom_host_email, status, has_transcript, has_recording
      ) VALUES
      (
        ${testOrg.id}, 'zoom', 'uuid_bff_test_1==', '111222333', 'Product Strategy Roadmap',
        ${HOST_ZOOM_ID}, ${memberUser.email}, 'ready_for_transcript_retrieval', true, true
      ),
      (
        ${testOrg.id}, 'zoom', 'uuid_bff_test_2==', '444555666', 'Engineering All Hands',
        'zoom_unknown_host', 'unknown@example.com', 'pending_consent', false, true
      )
    `;

    // 1. Fetch all
    const reqAll = new NextRequest(`http://localhost/api/orgs/${testOrg.id}/meetings`, {
      headers: { cookie: `workspace_session=${ownerCookie}` },
    });
    const resAll = await listMeetingsBFF(reqAll, { params: Promise.resolve({ orgId: testOrg.id }) });
    expect(resAll.status).toBe(200);
    const jsonAll = await resAll.json();
    expect(jsonAll.meetings.length).toBe(2);

    // 2. Filter by status = ready_for_transcript_retrieval
    const reqFiltered = new NextRequest(
      `http://localhost/api/orgs/${testOrg.id}/meetings?status=ready_for_transcript_retrieval`,
      {
        headers: { cookie: `workspace_session=${ownerCookie}` },
      }
    );
    const resFiltered = await listMeetingsBFF(reqFiltered, { params: Promise.resolve({ orgId: testOrg.id }) });
    expect(resFiltered.status).toBe(200);
    const jsonFiltered = await resFiltered.json();
    expect(jsonFiltered.meetings.length).toBe(1);
    expect(jsonFiltered.meetings[0].title).toBe('Product Strategy Roadmap');

    // 3. Search by query = All Hands
    const reqSearch = new NextRequest(
      `http://localhost/api/orgs/${testOrg.id}/meetings?query=All%20Hands`,
      {
        headers: { cookie: `workspace_session=${ownerCookie}` },
      }
    );
    const resSearch = await listMeetingsBFF(reqSearch, { params: Promise.resolve({ orgId: testOrg.id }) });
    expect(resSearch.status).toBe(200);
    const jsonSearch = await resSearch.json();
    expect(jsonSearch.meetings.length).toBe(1);
    expect(jsonSearch.meetings[0].title).toBe('Engineering All Hands');
  });

  it('restricts regular Members to view only meetings they hosted', async () => {
    const { sql } = getServerContext();

    // host_id is bound through the verified consent mapping (zoom_host_consents.user_id), never by email.
    await sql`
      INSERT INTO meetings (
        org_id, provider, provider_meeting_uuid, provider_numeric_id, title,
        zoom_host_id, zoom_host_email, host_id, status, has_transcript, has_recording
      ) VALUES
      (
        ${testOrg.id}, 'zoom', 'uuid_member_host==', '888888888', 'Member 1on1 Sync',
        ${HOST_ZOOM_ID}, ${memberUser.email},
        (SELECT user_id FROM zoom_host_consents WHERE org_id = ${testOrg.id} AND zoom_user_id = ${HOST_ZOOM_ID}),
        'ready_for_transcript_retrieval', true, true
      ),
      (
        ${testOrg.id}, 'zoom', 'uuid_other_host==', '999999999', 'Other Host Private Sync',
        'zoom_other_person', 'other@example.com', NULL, 'ready_for_transcript_retrieval', true, true
      ),
      (
        ${testOrg.id}, 'zoom', 'uuid_unbound_email_match==', '999999998', 'Unbound Email-Only Match',
        'zoom_unbound_host', ${memberUser.email}, NULL, 'ready_for_transcript_retrieval', true, true
      )
    `;

    const req = new NextRequest(`http://localhost/api/orgs/${testOrg.id}/meetings`, {
      headers: { cookie: `workspace_session=${memberCookie}` },
    });
    const res = await listMeetingsBFF(req, { params: Promise.resolve({ orgId: testOrg.id }) });
    expect(res.status).toBe(200);
    const json = await res.json();

    // Member should only see the meeting they hosted through a verified binding; an email-only
    // match without host_id stays visible to Owners/Admins only.
    expect(json.meetings.length).toBe(1);
    expect(json.meetings[0].title).toBe('Member 1on1 Sync');
  });

  it('allows retrying intake evaluation on eligible meetings', async () => {
    const { sql } = getServerContext();

    // Insert meeting in pending_consent state for HOST_ZOOM_ID (who is now opted in)
    const [inserted] = await sql<{ id: string }[]>`
      INSERT INTO meetings (
        org_id, provider, provider_meeting_uuid, provider_numeric_id, title,
        zoom_host_id, zoom_host_email, status, has_transcript, has_recording
      ) VALUES (
        ${testOrg.id}, 'zoom', 'uuid_retry_test==', '777888999', 'Sprint Planning Kickoff',
        ${HOST_ZOOM_ID}, ${memberUser.email}, 'pending_consent', true, true
      )
      RETURNING id
    `;

    const req = new NextRequest(
      `http://localhost/api/orgs/${testOrg.id}/meetings/${inserted.id}/retry`,
      {
        method: 'POST',
        headers: { cookie: `workspace_session=${ownerCookie}` },
      }
    );
    const res = await retryMeetingBFF(req, {
      params: Promise.resolve({ orgId: testOrg.id, meetingId: inserted.id }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meeting).toBeDefined();
    // Since host is opted in and has transcript, should transition to ready_for_transcript_retrieval
    expect(json.meeting.status).toBe('ready_for_transcript_retrieval');
  });
});
