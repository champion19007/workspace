import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { serializeSession } from '../lib/session';
import { createSessionPayload } from '@workspace/core';
import { GET as getTranscriptBFF } from '../app/api/orgs/[orgId]/meetings/[meetingId]/transcript/route';
import { POST as skipMeetingBFF } from '../app/api/orgs/[orgId]/meetings/[meetingId]/skip/route';
import { getServerContext } from '../lib/server-context';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  ingestMeetingTranscript,
} from '@workspace/db';

describe('Web BFF Journey: Meeting Transcripts & Skip Cleanup (Requirement M-2 & M-4)', () => {
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

  let meetingId: string;
  let meetingVersion: number;
  const rawBlobKey = 'raw-transcripts/web-journey-test.vtt';

  beforeEach(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ORIGIN_VERIFY_SECRET = TEST_SECRET;

    const { db, sql, ports } = getServerContext();

    // 1. Seed users
    const owner = await findOrCreateUserByEmail(db, {
      email: `web-tr-owner-${Date.now()}@example.com`,
      name: 'Web Transcript Owner',
    });
    ownerUser = { id: owner.id, email: owner.email };

    const host = await findOrCreateUserByEmail(db, {
      email: `web-tr-host-${Date.now()}@example.com`,
      name: 'Web Transcript Host',
    });
    hostMemberUser = { id: host.id, email: host.email };

    const other = await findOrCreateUserByEmail(db, {
      email: `web-tr-other-${Date.now()}@example.com`,
      name: 'Web Transcript Other Member',
    });
    otherMemberUser = { id: other.id, email: other.email };

    const viewer = await findOrCreateUserByEmail(db, {
      email: `web-tr-viewer-${Date.now()}@example.com`,
      name: 'Web Transcript Viewer',
    });
    viewerUser = { id: viewer.id, email: viewer.email };

    // 2. Organization and memberships
    const { org } = await createOrganizationWithOwner(db, {
      name: 'Web Transcript Primary Org',
      slug: `web-tr-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: org.id, slug: org.slug };

    await sql`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${testOrg.id}, ${hostMemberUser.id}, 'member'),
             (${testOrg.id}, ${otherMemberUser.id}, 'member'),
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

    // 4. Blob Store object
    await ports.blobStore.putObject({
      key: rawBlobKey,
      body: Buffer.from('WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\n<v Host>Discussion of architecture</v>'),
      contentType: 'text/vtt',
    });

    // 5. Create Meeting in DB
    const [meetingRow] = await sql<Array<{ id: string }>>`
      INSERT INTO meetings (
        org_id,
        provider,
        provider_meeting_uuid,
        provider_numeric_id,
        title,
        zoom_host_id,
        zoom_host_email,
        host_id,
        status,
        has_transcript,
        has_recording,
        connection_generation,
        processing_generation,
        guest_consent_status,
        version
      ) VALUES (
        ${testOrg.id},
        'zoom',
        ${`web_mtg_uuid_${Date.now()}`},
        '123456789',
        'Web Journey Sync Meeting',
        'zoom_host_web',
        ${hostMemberUser.email},
        ${hostMemberUser.id},
        'ready_for_transcript_retrieval',
        false,
        true,
        1,
        1,
        'consented',
        1
      )
      RETURNING id
    `;
    meetingId = meetingRow!.id;

    // 6. Ingest transcript segments
    const ingestResult = await ingestMeetingTranscript(sql, {
      orgId: testOrg.id,
      meetingId,
      expectedProcessingGeneration: 1,
      rawTranscriptObjectKey: rawBlobKey,
      rawTranscriptChecksum: 'mockchecksum_web_journey',
      rawTranscriptByteCount: 150,
      sourceManifest: {
        files: [],
        totalCues: 2,
        totalSegments: 2,
        durationMs: 30000,
        rawTranscriptChecksum: 'mockchecksum_web_journey',
        rawTranscriptByteCount: 150,
        processedAt: new Date().toISOString(),
      },
      segments: [
        {
          seq: 1,
          speakerLabel: 'Host Alice',
          startMs: 0,
          endMs: 12000,
          text: 'Starting our architecture review today.',
          checksum: 'hash1',
        },
        {
          seq: 2,
          speakerLabel: 'Host Alice',
          startMs: 13000,
          endMs: 30000,
          text: 'We are discussing the database schema and skip cleanup.',
          checksum: 'hash2',
        },
      ],
    });

    meetingVersion = ingestResult.meeting.version;
  });

  describe('GET /api/orgs/[orgId]/meetings/[meetingId]/transcript', () => {
    it('returns 401 Unauthorized when session cookie is missing', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/transcript`);
      const res = await getTranscriptBFF(req, {
        params: Promise.resolve({ orgId: testOrg.id, meetingId }),
      });

      expect(res.status).toBe(401);
    });

    it('returns 403 Forbidden for Viewer role', async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/transcript`,
        { headers: { cookie: `workspace_session=${viewerCookie}` } }
      );
      const res = await getTranscriptBFF(req, {
        params: Promise.resolve({ orgId: testOrg.id, meetingId }),
      });

      expect(res.status).toBe(403);
    });

    it('returns 403 Forbidden for Member who did not host the meeting', async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/transcript`,
        { headers: { cookie: `workspace_session=${otherMemberCookie}` } }
      );
      const res = await getTranscriptBFF(req, {
        params: Promise.resolve({ orgId: testOrg.id, meetingId }),
      });

      expect(res.status).toBe(403);
    });

    it('returns 200 OK with transcript segments and ETag header for Owner', async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/transcript`,
        { headers: { cookie: `workspace_session=${ownerCookie}` } }
      );
      const res = await getTranscriptBFF(req, {
        params: Promise.resolve({ orgId: testOrg.id, meetingId }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBe(`"v${meetingVersion}"`);

      const data = await res.json();
      expect(data.total).toBe(2);
      expect(data.segments).toHaveLength(2);
      expect(data.segments[0].seq).toBe(1);
      expect(data.segments[0].speakerLabel).toBe('Host Alice');
      expect(data.segments[0].text).toContain('architecture review');
    });

    it('returns 200 OK for the Host Member', async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/transcript`,
        { headers: { cookie: `workspace_session=${hostMemberCookie}` } }
      );
      const res = await getTranscriptBFF(req, {
        params: Promise.resolve({ orgId: testOrg.id, meetingId }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total).toBe(2);
      expect(data.segments).toHaveLength(2);
    });

    it('supports search query filter across cues', async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/transcript?search=cleanup`,
        { headers: { cookie: `workspace_session=${ownerCookie}` } }
      );
      const res = await getTranscriptBFF(req, {
        params: Promise.resolve({ orgId: testOrg.id, meetingId }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total).toBe(1);
      expect(data.segments).toHaveLength(1);
      expect(data.segments[0].seq).toBe(2);
      expect(data.segments[0].text).toContain('database schema and skip cleanup');
    });
  });

  describe('POST /api/orgs/[orgId]/meetings/[meetingId]/skip', () => {
    it('returns 428 Precondition Required when If-Match header is absent', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/skip`, {
        method: 'POST',
        headers: {
          cookie: `workspace_session=${ownerCookie}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Skip test' }),
      });

      const res = await skipMeetingBFF(req, {
        params: Promise.resolve({ orgId: testOrg.id, meetingId }),
      });

      expect(res.status).toBe(428);
    });

    it('returns 412 Precondition Failed when weak ETag is provided', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/skip`, {
        method: 'POST',
        headers: {
          cookie: `workspace_session=${ownerCookie}`,
          'If-Match': `W/"v${meetingVersion}"`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Weak tag' }),
      });

      const res = await skipMeetingBFF(req, {
        params: Promise.resolve({ orgId: testOrg.id, meetingId }),
      });

      expect(res.status).toBe(412);
    });

    it('returns 412 Precondition Failed on version mismatch', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/skip`, {
        method: 'POST',
        headers: {
          cookie: `workspace_session=${ownerCookie}`,
          'If-Match': '"v999"',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Mismatch' }),
      });

      const res = await skipMeetingBFF(req, {
        params: Promise.resolve({ orgId: testOrg.id, meetingId }),
      });

      expect(res.status).toBe(412);
    });

    it('returns 403 Forbidden for Viewer role', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/skip`, {
        method: 'POST',
        headers: {
          cookie: `workspace_session=${viewerCookie}`,
          'If-Match': `"v${meetingVersion}"`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Viewer skip' }),
      });

      const res = await skipMeetingBFF(req, {
        params: Promise.resolve({ orgId: testOrg.id, meetingId }),
      });

      expect(res.status).toBe(403);
    });

    it('returns 403 Forbidden for Member who did not host the meeting', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/skip`, {
        method: 'POST',
        headers: {
          cookie: `workspace_session=${otherMemberCookie}`,
          'If-Match': `"v${meetingVersion}"`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Other member skip' }),
      });

      const res = await skipMeetingBFF(req, {
        params: Promise.resolve({ orgId: testOrg.id, meetingId }),
      });

      expect(res.status).toBe(403);
    });

    it('successfully skips meeting, purges segments, and deletes blob for Owner', async () => {
      const { sql, ports } = getServerContext();

      // Ensure blob exists before skip
      const blobBefore = await ports.blobStore.getObject(rawBlobKey);
      expect(blobBefore).not.toBeNull();

      const req = new NextRequest(`http://localhost:3000/api/orgs/${testOrg.id}/meetings/${meetingId}/skip`, {
        method: 'POST',
        headers: {
          cookie: `workspace_session=${ownerCookie}`,
          'If-Match': `"v${meetingVersion}"`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Owner skipped meeting' }),
      });

      const res = await skipMeetingBFF(req, {
        params: Promise.resolve({ orgId: testOrg.id, meetingId }),
      });

      expect(res.status).toBe(200);
      const expectedNewVersion = meetingVersion + 1;
      expect(res.headers.get('etag')).toBe(`"v${expectedNewVersion}"`);

      const data = await res.json();
      expect(data.meeting.id).toBe(meetingId);
      expect(data.meeting.status).toBe('skipped');
      expect(data.meeting.skipped).toBe(true);
      expect(data.meeting.cleanupStatus).toBe('completed');
      expect(data.meeting.processingGeneration).toBe(2);

      // Verify DB segments deleted
      const segs = await sql`
        SELECT * FROM transcript_segments
        WHERE org_id = ${testOrg.id} AND meeting_id = ${meetingId}
      `;
      expect(segs).toHaveLength(0);

      // Verify blob deleted
      await expect(ports.blobStore.getObject(rawBlobKey)).rejects.toThrow('Blob not found');
    });
  });
});
