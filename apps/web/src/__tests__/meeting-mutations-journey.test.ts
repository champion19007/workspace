import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, serializeSession } from '../lib/session';
import { createSessionPayload, generateUuidV7, formatETag, type OrgRole } from '@workspace/core';
import { POST as routeMeetingBFF } from '../app/api/orgs/[orgId]/meetings/[meetingId]/route/route';
import { POST as skipMeetingBFF } from '../app/api/orgs/[orgId]/meetings/[meetingId]/skip/route';
import { POST as resolveGuestConsentBFF } from '../app/api/orgs/[orgId]/meetings/[meetingId]/guest-consent/route';
import { getServerContext } from '../lib/server-context';
import { findOrCreateUserByEmail, createOrganizationWithOwner } from '@workspace/db';

type Handler = typeof routeMeetingBFF;
type MeetingRef = { id: string; version: number };

/**
 * Stage 17b (carried from Stage 17): the BFF meeting MUTATION routes authorize through
 * authorizeMeetingAccess(action: 'mutate') before applying their own host-only rule.
 */
describe('Web BFF Journey: meeting mutations use the centralised meeting authorization', () => {
  const TEST_SECRET = 'a-super-secret-key-that-is-at-least-32-chars-long!';

  let orgSlug: string;
  let hostCookie: string;
  let viewerCookie: string;
  let publicProjectId: string;
  /** Routed to a private project its host is not a member of. */
  let privateMeeting: MeetingRef;
  /** Routed to a public project: readable by the Viewer. */
  let publicMeeting: MeetingRef;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ORIGIN_VERIFY_SECRET = TEST_SECRET;
    const { db, sql } = getServerContext();
    const stamp = Date.now();

    const owner = await findOrCreateUserByEmail(db, { email: `mm-owner-${stamp}@example.com`, name: 'MM Owner' });
    const host = await findOrCreateUserByEmail(db, { email: `mm-host-${stamp}@example.com`, name: 'MM Host' });
    const viewer = await findOrCreateUserByEmail(db, { email: `mm-viewer-${stamp}@example.com`, name: 'MM Viewer' });
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Meeting Mutations Org',
      slug: `mm-org-${stamp}`,
      userId: owner.id,
    });
    orgSlug = org.slug;
    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${org.id}, ${host.id}, 'member'), (${org.id}, ${viewer.id}, 'viewer')
    `;

    const teamId = generateUuidV7();
    const privateProjectId = generateUuidV7();
    publicProjectId = generateUuidV7();
    await sql`
      INSERT INTO nodes (id, org_id, parent_id, kind, name, path, visibility) VALUES
        (${teamId}, ${org.id}, NULL, 'team', 'Team', ${`mm${stamp}`}, 'public'),
        (${publicProjectId}, ${org.id}, ${teamId}, 'project', 'Open Project', ${`mm${stamp}.open`}, 'public'),
        (${privateProjectId}, ${org.id}, ${teamId}, 'project', 'Closed Project', ${`mm${stamp}.closed`}, 'private')
    `;

    const insertMeeting = async (nodeId: string): Promise<MeetingRef> => {
      const id = generateUuidV7();
      const [row] = await sql<MeetingRef[]>`
        INSERT INTO meetings (id, org_id, provider, provider_meeting_uuid, title, status, host_id, node_id, guests_present)
        VALUES (${id}, ${org.id}, 'zoom', ${`mm_${id}`}, 'Mutation Test', 'routed', ${host.id}, ${nodeId}, true)
        RETURNING id, version
      `;
      return row!;
    };
    privateMeeting = await insertMeeting(privateProjectId);
    publicMeeting = await insertMeeting(publicProjectId);

    const cookieFor = (user: { id: string; email: string }, role: OrgRole) =>
      serializeSession(createSessionPayload({ userId: user.id, email: user.email, activeOrgId: org.id, role, sessionEpoch: 1 }));
    hostCookie = cookieFor(host, 'member');
    viewerCookie = cookieFor(viewer, 'viewer');
  });

  const call = (handler: Handler, segment: string, meeting: MeetingRef, cookie: string, body: unknown) =>
    handler(
      new NextRequest(`http://localhost/api/orgs/${orgSlug}/meetings/${meeting.id}/${segment}`, {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
          'Content-Type': 'application/json',
          'If-Match': formatETag(meeting.version),
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ orgId: orgSlug, meetingId: meeting.id }) }
    );

  const routes: Array<{ name: string; handler: Handler; body: () => unknown }> = [
    { name: 'route', handler: routeMeetingBFF, body: () => ({ nodeId: publicProjectId }) },
    { name: 'skip', handler: skipMeetingBFF as Handler, body: () => ({ reason: 'Not needed' }) },
    { name: 'guest-consent', handler: resolveGuestConsentBFF as Handler, body: () => ({ guestConsentStatus: 'consented' }) },
  ];

  for (const route of routes) {
    describe(`POST /meetings/:meetingId/${route.name}`, () => {
      it('returns 404 to the host of a meeting routed to a private project they are not a member of', async () => {
        const res = await call(route.handler, route.name, privateMeeting, hostCookie, route.body());
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe('NOT_FOUND');
      });

      it('returns 403 to a Viewer who can read the meeting', async () => {
        const res = await call(route.handler, route.name, publicMeeting, viewerCookie, route.body());
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe('FORBIDDEN');
      });
    });
  }
});
