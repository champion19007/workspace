import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, serializeSession } from '../lib/session';
import { createSessionPayload, generateUuidV7, formatETag } from '@workspace/core';
import { GET as getRoutingCandidatesBFF } from '../app/api/orgs/[orgId]/meetings/[meetingId]/routing-candidates/route';
import { GET as getSpeakersBFF, POST as updateSpeakerBFF } from '../app/api/orgs/[orgId]/meetings/[meetingId]/speakers/route';
import { POST as routeMeetingBFF } from '../app/api/orgs/[orgId]/meetings/[meetingId]/route/route';
import { POST as resolveGuestConsentBFF } from '../app/api/orgs/[orgId]/meetings/[meetingId]/guest-consent/route';
import { GET as getMyConsentBFF, PATCH as patchMyConsentBFF } from '../app/api/orgs/[orgId]/zoom/my-consent/route';
import { getServerContext } from '../lib/server-context';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
} from '@workspace/db';

describe('Web BFF Journey: Stage 14 Routing, Speaker Resolution & Host Consent (Requirements M-3 & M-4)', () => {
  const TEST_SECRET = 'a-super-secret-key-that-is-at-least-32-chars-long!';

  let ownerUser: { id: string; email: string };
  let hostMemberUser: { id: string; email: string };
  let otherMemberUser: { id: string; email: string };
  let viewerUser: { id: string; email: string };

  let testOrg: { id: string; slug: string };

  let ownerCookie: string;
  let hostMemberCookie: string;
  let otherMemberCookie: string;
  let viewerCookie: string;

  let teamNodeId: string;
  let candidateProject1Id: string;
  let candidateProject2Id: string;
  let archivedProjectId: string;

  let meetingId: string;
  let meetingVersion: number;

  beforeEach(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ORIGIN_VERIFY_SECRET = TEST_SECRET;

    const { db, sql } = getServerContext();

    // 1. Seed users
    const owner = await findOrCreateUserByEmail(db, {
      email: `web-route-owner-${Date.now()}@example.com`,
      name: 'Web Route Owner',
    });
    ownerUser = { id: owner.id, email: owner.email };

    const host = await findOrCreateUserByEmail(db, {
      email: `web-route-host-${Date.now()}@example.com`,
      name: 'Web Route Host',
    });
    hostMemberUser = { id: host.id, email: host.email };

    const other = await findOrCreateUserByEmail(db, {
      email: `web-route-other-${Date.now()}@example.com`,
      name: 'Web Route Other Member',
    });
    otherMemberUser = { id: other.id, email: other.email };

    const viewer = await findOrCreateUserByEmail(db, {
      email: `web-route-viewer-${Date.now()}@example.com`,
      name: 'Web Route Viewer',
    });
    viewerUser = { id: viewer.id, email: viewer.email };

    // 2. Organization and memberships
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Web Routing Primary Org',
      slug: `web-route-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${testOrg.id}, ${hostMemberUser.id}, 'member'),
             (${testOrg.id}, ${otherMemberUser.id}, 'member'),
             (${testOrg.id}, ${viewerUser.id}, 'viewer')
    `;

    // 3. Setup nodes hierarchy
    teamNodeId = generateUuidV7();
    await sql`
      INSERT INTO nodes (id, org_id, parent_id, kind, name, path, visibility)
      VALUES (${teamNodeId}, ${testOrg.id}, NULL, 'team', 'Engineering Team', 'engineering', 'public')
    `;

    candidateProject1Id = generateUuidV7();
    await sql`
      INSERT INTO nodes (id, org_id, parent_id, kind, name, path, visibility)
      VALUES (${candidateProject1Id}, ${testOrg.id}, ${teamNodeId}, 'project', 'Alpha Pipeline', 'engineering.alpha', 'public')
    `;

    candidateProject2Id = generateUuidV7();
    await sql`
      INSERT INTO nodes (id, org_id, parent_id, kind, name, path, visibility)
      VALUES (${candidateProject2Id}, ${testOrg.id}, ${teamNodeId}, 'project', 'Beta Migration', 'engineering.beta', 'public')
    `;

    archivedProjectId = generateUuidV7();
    await sql`
      INSERT INTO nodes (id, org_id, parent_id, kind, name, path, visibility, archived_at)
      VALUES (${archivedProjectId}, ${testOrg.id}, ${teamNodeId}, 'project', 'Archived Project', 'engineering.archived', 'public', NOW())
    `;

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

    hostMemberCookie = serializeSession(
      createSessionPayload({
        userId: hostMemberUser.id,
        email: hostMemberUser.email,
        activeOrgId: testOrg.id,
        role: 'member',
        sessionEpoch: 1,
      })
    );

    otherMemberCookie = serializeSession(
      createSessionPayload({
        userId: otherMemberUser.id,
        email: otherMemberUser.email,
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

    // 5. Connect mock Zoom integration
    await sql`
      INSERT INTO integrations (id, org_id, provider, account_id, secret_arn, status)
      VALUES (${generateUuidV7()}, ${testOrg.id}, 'zoom', ${`acct_${generateUuidV7().replace(/-/g, '')}`}, 'arn:secret', 'connected')
    `;

    // 6. Create meeting in awaiting_project_choice
    meetingId = generateUuidV7();
    const [insertedMeeting] = await sql<Array<{ id: string; version: number }>>`
      INSERT INTO meetings (
        id, org_id, provider, provider_meeting_uuid, title, duration_seconds, status,
        processing_generation, host_id, zoom_host_email, suggested_node_id, routing_confidence, routing_reason, guests_present
      )
      VALUES (
        ${meetingId}, ${testOrg.id}, 'zoom', ${`uuid_${meetingId.slice(0, 8)}`},
        'BFF Routing Test Meeting', 1800, 'awaiting_project_choice',
        1, ${hostMemberUser.id}, ${hostMemberUser.email}, ${candidateProject1Id}, 0.60, 'Low confidence routing', true
      )
      RETURNING id, version
    `;
    meetingVersion = insertedMeeting!.version;

    // Insert transcript segments
    await sql`
      INSERT INTO transcript_segments (id, org_id, meeting_id, seq, speaker_label, start_ms, end_ms, text)
      VALUES
        (${generateUuidV7()}, ${testOrg.id}, ${meetingId}, 1, 'Web Route Host', 0, 5000, 'Starting the sprint planning'),
        (${generateUuidV7()}, ${testOrg.id}, ${meetingId}, 2, 'Unmapped Speaker', 6000, 15000, 'I need tickets in Beta migration')
    `;
  });

  describe('Routing Candidates BFF Endpoint', () => {
    it('returns active project leaves for meeting host', async () => {
      const req = new NextRequest(`http://localhost/api/orgs/${testOrg.slug}/meetings/${meetingId}/routing-candidates`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${hostMemberCookie}` },
      });

      const res = await getRoutingCandidatesBFF(req, {
        params: Promise.resolve({ orgId: testOrg.slug, meetingId }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.candidates).toBeDefined();
      const ids = (data.candidates as Array<{ id: string }>).map((c) => c.id);
      expect(ids).toContain(candidateProject1Id);
      expect(ids).toContain(candidateProject2Id);
      expect(ids).not.toContain(teamNodeId);
      expect(ids).not.toContain(archivedProjectId);
    });

    it('returns candidate project leaves for organization owner', async () => {
      const req = new NextRequest(`http://localhost/api/orgs/${testOrg.slug}/meetings/${meetingId}/routing-candidates`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${ownerCookie}` },
      });

      const res = await getRoutingCandidatesBFF(req, {
        params: Promise.resolve({ orgId: testOrg.slug, meetingId }),
      });

      expect(res.status).toBe(200);
    });

    it('returns 403 for viewer', async () => {
      const req = new NextRequest(`http://localhost/api/orgs/${testOrg.slug}/meetings/${meetingId}/routing-candidates`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${viewerCookie}` },
      });

      const res = await getRoutingCandidatesBFF(req, {
        params: Promise.resolve({ orgId: testOrg.slug, meetingId }),
      });

      expect(res.status).toBe(403);
    });

    it('returns 403 for non-host member', async () => {
      const req = new NextRequest(`http://localhost/api/orgs/${testOrg.slug}/meetings/${meetingId}/routing-candidates`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${otherMemberCookie}` },
      });

      const res = await getRoutingCandidatesBFF(req, {
        params: Promise.resolve({ orgId: testOrg.slug, meetingId }),
      });

      expect(res.status).toBe(403);
    });
  });

  describe('Speaker Resolution BFF Endpoints', () => {
    it('retrieves speaker list and resolution metadata', async () => {
      const req = new NextRequest(`http://localhost/api/orgs/${testOrg.slug}/meetings/${meetingId}/speakers`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${hostMemberCookie}` },
      });

      const res = await getSpeakersBFF(req, {
        params: Promise.resolve({ orgId: testOrg.slug, meetingId }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.speakers).toHaveLength(2);
      expect((data.speakers as Array<{ speakerLabel: string }>).map((s) => s.speakerLabel)).toContain('Unmapped Speaker');
    });

    it('allows host to manually update speaker mapping', async () => {
      const req = new NextRequest(`http://localhost/api/orgs/${testOrg.slug}/meetings/${meetingId}/speakers`, {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${hostMemberCookie}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          speakerLabel: 'Unmapped Speaker',
          userId: otherMemberUser.id,
        }),
      });

      const res = await updateSpeakerBFF(req, {
        params: Promise.resolve({ orgId: testOrg.slug, meetingId }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.meeting).toBeDefined();

      const { sql } = getServerContext();
      const [seg] = await sql<Array<{ user_id: string; resolution_method: string }>>`
        SELECT user_id, resolution_method FROM transcript_segments
        WHERE meeting_id = ${meetingId} AND speaker_label = 'Unmapped Speaker'
      `;
      expect(seg?.user_id).toBe(otherMemberUser.id);
      expect(seg?.resolution_method).toBe('manual');
    });
  });

  describe('Project Routing BFF Endpoint', () => {
    it('enforces strong If-Match OCC and routes meeting to target project', async () => {
      // 1. Missing If-Match -> 428
      const reqNoETag = new NextRequest(`http://localhost/api/orgs/${testOrg.slug}/meetings/${meetingId}/route`, {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${hostMemberCookie}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nodeId: candidateProject2Id }),
      });
      const resNoETag = await routeMeetingBFF(reqNoETag, {
        params: Promise.resolve({ orgId: testOrg.slug, meetingId }),
      });
      expect(resNoETag.status).toBe(428);

      // 2. Mismatched If-Match -> 412
      const reqMismatch = new NextRequest(`http://localhost/api/orgs/${testOrg.slug}/meetings/${meetingId}/route`, {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${hostMemberCookie}`,
          'Content-Type': 'application/json',
          'If-Match': formatETag(meetingVersion + 99),
        },
        body: JSON.stringify({ nodeId: candidateProject2Id }),
      });
      const resMismatch = await routeMeetingBFF(reqMismatch, {
        params: Promise.resolve({ orgId: testOrg.slug, meetingId }),
      });
      expect(resMismatch.status).toBe(412);

      // 3. Valid If-Match -> 200, status='routed', node_id set, outbox emitted
      const reqValid = new NextRequest(`http://localhost/api/orgs/${testOrg.slug}/meetings/${meetingId}/route`, {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${hostMemberCookie}`,
          'Content-Type': 'application/json',
          'If-Match': formatETag(meetingVersion),
        },
        body: JSON.stringify({
          nodeId: candidateProject2Id,
          reason: 'Host confirmed project affiliation to Beta Migration',
        }),
      });
      const resValid = await routeMeetingBFF(reqValid, {
        params: Promise.resolve({ orgId: testOrg.slug, meetingId }),
      });
      expect(resValid.status).toBe(200);
      const data = await resValid.json();
      expect(data.meeting.status).toBe('routed');
      expect(data.meeting.nodeId).toBe(candidateProject2Id);
      expect(data.meeting.version).toBe(meetingVersion + 1);

      // Verify outbox event emitted
      const { sql } = getServerContext();
      const [outbox] = await sql<Array<{ topic: string; payload: { nodeId?: string; meetingId?: string } }>>`
        SELECT topic, payload FROM outbox
        WHERE org_id = ${testOrg.id} AND topic = 'meeting.routed'
        ORDER BY created_at DESC LIMIT 1
      `;
      expect(outbox).toBeDefined();
      expect(outbox?.payload.nodeId).toBe(candidateProject2Id);
    });
  });

  describe('Guest Consent Resolution BFF Endpoint', () => {
    it('allows host to confirm guest consent', async () => {
      const req = new NextRequest(`http://localhost/api/orgs/${testOrg.slug}/meetings/${meetingId}/guest-consent`, {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${hostMemberCookie}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          guestConsentStatus: 'consented',
          attestationNotes: 'Confirmed external guest agreed to recording',
        }),
      });

      const res = await resolveGuestConsentBFF(req, {
        params: Promise.resolve({ orgId: testOrg.slug, meetingId }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.meeting.guestConsentStatus).toBe('consented');
    });
  });

  describe('Self-Service Host Consent BFF Endpoints', () => {
    it('allows host to view and update own consent preferences', async () => {
      // 1. Get initial consent
      const getReq = new NextRequest(`http://localhost/api/orgs/${testOrg.slug}/zoom/my-consent`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${hostMemberCookie}` },
      });
      const getRes = await getMyConsentBFF(getReq, {
        params: Promise.resolve({ orgId: testOrg.slug }),
      });
      expect(getRes.status).toBe(200);

      // 2. Opt-in
      const patchInReq = new NextRequest(`http://localhost/api/orgs/${testOrg.slug}/zoom/my-consent`, {
        method: 'PATCH',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${hostMemberCookie}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ consentStatus: 'opted_in' }),
      });
      const patchInRes = await patchMyConsentBFF(patchInReq, {
        params: Promise.resolve({ orgId: testOrg.slug }),
      });
      expect(patchInRes.status).toBe(200);
      const dataIn = await patchInRes.json();
      expect(dataIn.consent.consentStatus).toBe('opted_in');

      // 3. Opt-out
      const patchOutReq = new NextRequest(`http://localhost/api/orgs/${testOrg.slug}/zoom/my-consent`, {
        method: 'PATCH',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${hostMemberCookie}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ consentStatus: 'opted_out' }),
      });
      const patchOutRes = await patchMyConsentBFF(patchOutReq, {
        params: Promise.resolve({ orgId: testOrg.slug }),
      });
      expect(patchOutRes.status).toBe(200);
      const dataOut = await patchOutRes.json();
      expect(dataOut.consent.consentStatus).toBe('opted_out');
    });
  });

  afterEach(async () => {
    const { sql } = getServerContext();
    if (testOrg) {
      await sql`DELETE FROM transcript_segments WHERE org_id = ${testOrg.id}`;
      await sql`DELETE FROM meetings WHERE org_id = ${testOrg.id}`;
      await sql`DELETE FROM zoom_host_consents WHERE org_id = ${testOrg.id}`;
      await sql`DELETE FROM integrations WHERE org_id = ${testOrg.id}`;
      await sql`DELETE FROM orgs WHERE id = ${testOrg.id}`;
    }
  });
});
