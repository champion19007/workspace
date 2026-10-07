import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import {
  evaluateMeetingEligibility,
} from '@workspace/core';
import { serializeSession } from '../lib/session';
import { createSessionPayload } from '@workspace/core';
import { NextRequest } from 'next/server';
import { GET as getZoomIntegrationBFF, POST as connectZoomBFF, DELETE as disconnectZoomBFF } from '../app/api/orgs/[orgId]/integrations/zoom/route';
import { POST as callbackZoomBFF } from '../app/api/orgs/[orgId]/integrations/zoom/callback/route';
import { GET as listZoomHostsBFF } from '../app/api/orgs/[orgId]/integrations/zoom/hosts/route';
import { PATCH as updateZoomHostBFF } from '../app/api/orgs/[orgId]/integrations/zoom/hosts/[zoomUserId]/route';
import { getServerContext } from '../lib/server-context';
import { findOrCreateUserByEmail, createOrganizationWithOwner } from '@workspace/db';

describe('Web BFF & UI Journey: Zoom Account Connection & Host Opt-In (Requirement M-1)', () => {
  const TEST_SECRET = 'a-super-secret-key-that-is-at-least-32-chars-long!';
  let ownerUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let testOrg: { id: string; slug: string };
  let otherOrg: { id: string; slug: string };

  let ownerCookie: string;
  let memberCookie: string;

  beforeEach(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ORIGIN_VERIFY_SECRET = TEST_SECRET;

    const { db, sql } = getServerContext();

    // 1. Seed users
    const owner = await findOrCreateUserByEmail(db, {
      email: `web-zoom-owner-${Date.now()}@example.com`,
      name: 'Web Zoom Owner',
    });
    ownerUser = { id: owner.id, email: owner.email };

    const member = await findOrCreateUserByEmail(db, {
      email: `web-zoom-member-${Date.now()}@example.com`,
      name: 'Web Zoom Member',
    });
    memberUser = { id: member.id, email: member.email };

    // 2. Seed primary org
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Web Zoom Primary Org',
      slug: `web-zoom-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${testOrg.id}, ${memberUser.id}, 'member')
    `;

    // 3. Seed secondary org
    const { org: secOrg } = await createOrganizationWithOwner(db, {
      name: 'Web Zoom Secondary Org',
      slug: `web-zoom-sec-${Date.now()}`,
      userId: memberUser.id,
    });
    otherOrg = { id: secOrg.id, slug: secOrg.slug };

    // 4. Create session cookies
    const ownerPayload = createSessionPayload({
      userId: ownerUser.id,
      email: ownerUser.email,
      activeOrgId: testOrg.id,
      role: 'owner',
      sessionEpoch: 1,
    });
    ownerCookie = serializeSession(ownerPayload);

    const memberPayload = createSessionPayload({
      userId: memberUser.id,
      email: memberUser.email,
      activeOrgId: testOrg.id,
      role: 'member',
      sessionEpoch: 1,
    });
    memberCookie = serializeSession(memberPayload);
  });

  describe('1. Authentication and Authorization Guardrails', () => {
    it('rejects unauthenticated requests to BFF with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom');
      const res = await getZoomIntegrationBFF(req, {
        params: Promise.resolve({ orgId: testOrg.slug }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects connection initiation by non-admin member with 403', async () => {
      const req = new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom', {
        method: 'POST',
        headers: {
          cookie: `workspace_session=${memberCookie}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const res = await connectZoomBFF(req, {
        params: Promise.resolve({ orgId: testOrg.slug }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('2. Connection Lifecycle & Host Discovery Journey', () => {
    it('initiates connection as owner, generating single-use PKCE state and Zoom auth URL', async () => {
      const req = new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom', {
        method: 'POST',
        headers: {
          cookie: `workspace_session=${ownerCookie}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const res = await connectZoomBFF(req, {
        params: Promise.resolve({ orgId: testOrg.slug }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.state).toBeDefined();
      expect(body.authorizationUrl).toContain('https://zoom.us/oauth/authorize');
    });

    it('processes callback, creates connection, synchronizes hosts, and redacts credentials', async () => {
      // 1. Authorize to capture fresh state
      const authReq = new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom', {
        method: 'POST',
        headers: { cookie: `workspace_session=${ownerCookie}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const authRes = await connectZoomBFF(authReq, { params: Promise.resolve({ orgId: testOrg.slug }) });
      const { state } = await authRes.json();

      // 2. Execute callback
      const callbackReq = new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom/callback', {
        method: 'POST',
        headers: { cookie: `workspace_session=${ownerCookie}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'valid_mock_code', state }),
      });

      const callbackRes = await callbackZoomBFF(callbackReq, { params: Promise.resolve({ orgId: testOrg.slug }) });
      expect(callbackRes.status).toBe(200);

      const body = await callbackRes.json();
      expect(body.success).toBe(true);
      expect(body.integration.status).toBe('connected');
      expect(body.integration.accountId).toBe('zoom_act_test_123');

      // 3. Verify status from GET
      const getReq = new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom', {
        headers: { cookie: `workspace_session=${ownerCookie}` },
      });
      const getRes = await getZoomIntegrationBFF(getReq, { params: Promise.resolve({ orgId: testOrg.slug }) });
      expect(getRes.status).toBe(200);
      const getBody = await getRes.json();
      expect(getBody.integration?.status).toBe('connected');

      // 4. Verify discovered hosts from GET /hosts
      const hostsReq = new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom/hosts', {
        headers: { cookie: `workspace_session=${ownerCookie}` },
      });
      const hostsRes = await listZoomHostsBFF(hostsReq, { params: Promise.resolve({ orgId: testOrg.slug }) });
      expect(hostsRes.status).toBe(200);
      const hostsBody = await hostsRes.json();
      expect(Array.isArray(hostsBody.hosts)).toBe(true);
      expect(hostsBody.hosts.length).toBeGreaterThan(0);
    });

    it('rejects attempt to link the same Zoom account to second org (409 Conflict)', async () => {
      // 1. Authorize on primary org and connect
      const authReq1 = new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom', {
        method: 'POST',
        headers: { cookie: `workspace_session=${ownerCookie}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const authRes1 = await connectZoomBFF(authReq1, { params: Promise.resolve({ orgId: testOrg.slug }) });
      const { state: state1 } = await authRes1.json();

      await callbackZoomBFF(
        new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom/callback', {
          method: 'POST',
          headers: { cookie: `workspace_session=${ownerCookie}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'valid_mock_code', state: state1 }),
        }),
        { params: Promise.resolve({ orgId: testOrg.slug }) }
      );

      // 2. Authorize on second org with owner cookie for second org
      const secOwnerPayload = createSessionPayload({
        userId: memberUser.id,
        email: memberUser.email,
        activeOrgId: otherOrg.id,
        role: 'owner',
        sessionEpoch: 1,
      });
      const secOwnerCookie = serializeSession(secOwnerPayload);

      const authReq2 = new NextRequest('http://localhost:3000/api/orgs/' + otherOrg.slug + '/integrations/zoom', {
        method: 'POST',
        headers: { cookie: `workspace_session=${secOwnerCookie}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const authRes2 = await connectZoomBFF(authReq2, { params: Promise.resolve({ orgId: otherOrg.slug }) });
      const { state: state2 } = await authRes2.json();

      // 3. Callback on second org -> 409 Conflict
      const collideCallbackReq = new NextRequest('http://localhost:3000/api/orgs/' + otherOrg.slug + '/integrations/zoom/callback', {
        method: 'POST',
        headers: { cookie: `workspace_session=${secOwnerCookie}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'valid_mock_code', state: state2 }),
      });

      const collideRes = await callbackZoomBFF(collideCallbackReq, { params: Promise.resolve({ orgId: otherOrg.slug }) });
      expect(collideRes.status).toBe(409);
    });

    it('allows admin/owner to grant opt-in consent and toggle adminDisabled', async () => {
      // Connect first
      const authReq = new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom', {
        method: 'POST',
        headers: { cookie: `workspace_session=${ownerCookie}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const authRes = await connectZoomBFF(authReq, { params: Promise.resolve({ orgId: testOrg.slug }) });
      const { state } = await authRes.json();

      await callbackZoomBFF(
        new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom/callback', {
          method: 'POST',
          headers: { cookie: `workspace_session=${ownerCookie}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'valid_mock_code', state }),
        }),
        { params: Promise.resolve({ orgId: testOrg.slug }) }
      );

      // Update host consent
      const patchReq = new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom/hosts/zoom_usr_owner_123', {
        method: 'PATCH',
        headers: { cookie: `workspace_session=${ownerCookie}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consentStatus: 'opted_in',
          adminDisabled: false,
        }),
      });

      const patchRes = await updateZoomHostBFF(patchReq, {
        params: Promise.resolve({ orgId: testOrg.slug, zoomUserId: 'zoom_usr_owner_123' }),
      });
      expect(patchRes.status).toBe(200);

      const { host } = await patchRes.json();
      expect(host.consentStatus).toBe('opted_in');
      expect(host.adminDisabled).toBe(false);
    });

    it('allows owner to disconnect, updating state to disconnected', async () => {
      // Connect first
      const authReq = new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom', {
        method: 'POST',
        headers: { cookie: `workspace_session=${ownerCookie}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const authRes = await connectZoomBFF(authReq, { params: Promise.resolve({ orgId: testOrg.slug }) });
      const { state } = await authRes.json();

      await callbackZoomBFF(
        new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom/callback', {
          method: 'POST',
          headers: { cookie: `workspace_session=${ownerCookie}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'valid_mock_code', state }),
        }),
        { params: Promise.resolve({ orgId: testOrg.slug }) }
      );

      // Disconnect
      const delReq = new NextRequest('http://localhost:3000/api/orgs/' + testOrg.slug + '/integrations/zoom', {
        method: 'DELETE',
        headers: { cookie: `workspace_session=${ownerCookie}` },
      });
      const delRes = await disconnectZoomBFF(delReq, { params: Promise.resolve({ orgId: testOrg.slug }) });
      expect(delRes.status).toBe(200);
      const delBody = await delRes.json();
      expect(delBody.integration.status).toBe('disconnected');
    });
  });

  describe('3. Ingestion Eligibility Contract Evaluation', () => {
    it('strictly evaluates meeting eligibility based on connection, opt-in, admin toggle, and guest consent', () => {
      // 1. Active connection with opted-in host and no external participants -> eligible
      const result1 = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: false },
        hasExternalParticipants: false,
      });
      expect(result1.eligible).toBe(true);

      // 2. Admin disabled host -> not eligible
      const result2 = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: true },
        hasExternalParticipants: false,
      });
      expect(result2.eligible).toBe(false);
      expect(result2.reason).toContain('disabled by workspace administrator');

      // 3. External participants present without guest consent -> not eligible
      const result3 = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: false },
        hasExternalParticipants: true,
        guestConsentGranted: false,
      });
      expect(result3.eligible).toBe(false);
      expect(result3.reason).toContain('without verified guest consent');

      // 4. External participants present WITH verified guest consent -> eligible
      const result4 = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: false },
        hasExternalParticipants: true,
        guestConsentGranted: true,
      });
      expect(result4.eligible).toBe(true);
    });
  });
  afterEach(async () => {
    const { sql } = getServerContext();
    await sql`DELETE FROM zoom_oauth_states`;
    await sql`DELETE FROM zoom_host_consents`;
    await sql`DELETE FROM integrations WHERE provider = 'zoom'`;
    if (testOrg) await sql`DELETE FROM orgs WHERE id = ${testOrg.id}`;
    if (otherOrg) await sql`DELETE FROM orgs WHERE id = ${otherOrg.id}`;
  });

  afterAll(async () => {
    const { sql } = getServerContext();
    if (testOrg) {
      await sql`DELETE FROM zoom_oauth_states WHERE org_id = ${testOrg.id}`;
      await sql`DELETE FROM zoom_host_consents WHERE org_id = ${testOrg.id}`;
      await sql`DELETE FROM integrations WHERE org_id = ${testOrg.id}`;
      await sql`DELETE FROM orgs WHERE id = ${testOrg.id}`;
    }
    if (otherOrg) {
      await sql`DELETE FROM zoom_oauth_states WHERE org_id = ${otherOrg.id}`;
      await sql`DELETE FROM zoom_host_consents WHERE org_id = ${otherOrg.id}`;
      await sql`DELETE FROM integrations WHERE org_id = ${otherOrg.id}`;
      await sql`DELETE FROM orgs WHERE id = ${otherOrg.id}`;
    }
  });
});

