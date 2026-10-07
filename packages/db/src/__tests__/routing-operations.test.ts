import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { generateUuidV7, type LLMPort, type LLMCompletionRequest, type LLMCompletionResult } from '@workspace/core';
import {
  checkRoutingCostGates,
  getRoutingCandidatesForUser,
  evaluateAndRouteMeeting,
  manuallyRouteMeeting,
  resolveGuestConsent,
} from '../routing-operations.js';
import {
  resolveMeetingSpeakers,
  updateSpeakerMapping,
  getMeetingSpeakers,
} from '../speaker-operations.js';
import {
  getMyHostConsent,
  updateMyHostConsent,
} from '../zoom-operations.js';

describe('Stage 14 Database Operations: Speaker Resolution & Project Routing', () => {
  const directUrl =
    process.env.DATABASE_DIRECT_URL ||
    'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev?sslmode=disable';

  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = postgres(directUrl, { max: 5 });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  describe('Cost & Processing Gates (checkRoutingCostGates)', () => {
    it('rejects meetings shorter than 3 minutes (180s)', () => {
      const res = checkRoutingCostGates({ durationSeconds: 120, speakerCount: 3 });
      expect(res.passed).toBe(false);
      expect(res.reason).toContain('under the 3-minute minimum threshold');
    });

    it('rejects meetings with fewer than 2 distinct speakers', () => {
      const res = checkRoutingCostGates({ durationSeconds: 300, speakerCount: 1 });
      expect(res.passed).toBe(false);
      expect(res.reason).toContain('at least 2 distinct speakers are required');
    });

    it('passes meetings with duration >= 180s and >= 2 speakers', () => {
      const res = checkRoutingCostGates({ durationSeconds: 180, speakerCount: 2 });
      expect(res.passed).toBe(true);
      expect(res.reason).toBeUndefined();
    });
  });

  describe('Database Integration: Speaker Resolution & Routing Flow', () => {
    let orgId: string;
    let ownerId: string;
    let memberId: string;
    let guestId: string;
    let hostEmail: string;
    let memberEmail: string;
    let guestEmail: string;
    let teamNodeId: string;
    let publicProjectId: string;
    let privateProjectId: string;
    let meetingId: string;

    beforeAll(async () => {
      orgId = generateUuidV7();
      ownerId = generateUuidV7();
      memberId = generateUuidV7();
      guestId = generateUuidV7();
      hostEmail = `host.owner.${orgId.replace(/-/g, '')}@test.com`;
      memberEmail = `colleague.dev.${orgId.replace(/-/g, '')}@test.com`;
      guestEmail = `guest.viewer.${orgId.replace(/-/g, '')}@test.com`;
      const orgSlug = `org-${orgId.replace(/-/g, '').slice(0, 24)}`;

      // 1. Create Organization
      await sql`
        INSERT INTO orgs (id, name, slug)
        VALUES (${orgId}, 'Test Stage 14 Org', ${orgSlug})
      `;

      // 2. Create Users
      await sql`
        INSERT INTO users (id, email, name)
        VALUES 
          (${ownerId}, ${hostEmail}, 'Host Owner'),
          (${memberId}, ${memberEmail}, 'Colleague Dev'),
          (${guestId}, ${guestEmail}, 'Guest Viewer')
      `;

      // 3. Create Memberships
      await sql`
        INSERT INTO memberships (org_id, user_id, role)
        VALUES 
          (${orgId}, ${ownerId}, 'owner'),
          (${orgId}, ${memberId}, 'member')
      `;

      // 4. Create Node Tree: Team -> Public Project, Private Project
      teamNodeId = generateUuidV7();
      publicProjectId = generateUuidV7();
      privateProjectId = generateUuidV7();

      await sql`
        INSERT INTO nodes (id, org_id, kind, name, path, visibility, rollup)
        VALUES (${teamNodeId}, ${orgId}, 'team', 'Engineering Team', 'team_1', 'public', '{}')
      `;

      await sql`
        INSERT INTO nodes (id, org_id, parent_id, kind, name, path, visibility, rollup)
        VALUES 
          (${publicProjectId}, ${orgId}, ${teamNodeId}, 'project', 'Workspace v1 Platform', 'team_1.proj_pub', 'public', '{}'),
          (${privateProjectId}, ${orgId}, ${teamNodeId}, 'project', 'Confidential Project', 'team_1.proj_priv', 'private', '{}')
      `;

      // Member gets membership on private project, but not owner (for testing candidate filtering)
      await sql`
        INSERT INTO node_members (org_id, node_id, user_id)
        VALUES (${orgId}, ${privateProjectId}, ${memberId})
      `;

      // 5. Create Integration
      const integrationId = generateUuidV7();
      await sql`
        INSERT INTO integrations (id, org_id, provider, account_id, secret_arn, status)
        VALUES (${integrationId}, ${orgId}, 'zoom', ${'act_' + orgId.slice(0, 8)}, 'secret:test', 'connected')
      `;

      // 6. Create Meeting
      meetingId = generateUuidV7();
      await sql`
        INSERT INTO meetings (
          id, org_id, provider, provider_meeting_uuid, title, host_id, zoom_host_email, 
          duration_seconds, status, version, processing_generation
        )
        VALUES (
          ${meetingId}, ${orgId}, 'zoom', ${'zm_uuid_' + meetingId.slice(0, 8)}, 
          'Platform Architecture Review', ${ownerId}, ${hostEmail}, 
          600, 'transcript_ready', 1, 1
        )
      `;

      // 7. Insert Transcript Segments
      await sql`
        INSERT INTO transcript_segments (
          id, org_id, meeting_id, seq, speaker_label, start_ms, end_ms, text
        )
        VALUES 
          (${generateUuidV7()}, ${orgId}, ${meetingId}, 1, 'Host Owner', 0, 5000, 'Welcome everyone, let us review our Workspace v1 architecture.'),
          (${generateUuidV7()}, ${orgId}, ${meetingId}, 2, 'Colleague Dev', 5500, 12000, 'I have implemented the database migration and the tests are running cleanly.'),
          (${generateUuidV7()}, ${orgId}, ${meetingId}, 3, 'External Contractor', 13000, 20000, 'From our end the integration tests look good.')
      `;
    });

    it('filters routing candidates based on principal permissions', async () => {
      // For member (who is in private project node_members)
      const memberCandidates = await getRoutingCandidatesForUser(sql, {
        orgId,
        userId: memberId,
      });
      expect(memberCandidates.map((c) => c.id)).toContain(publicProjectId);
      expect(memberCandidates.map((c) => c.id)).toContain(privateProjectId);

      // For owner (isPrivileged = true, sees all projects in org)
      const ownerCandidates = await getRoutingCandidatesForUser(sql, {
        orgId,
        userId: ownerId,
      });
      expect(ownerCandidates.map((c) => c.id)).toContain(publicProjectId);
      expect(ownerCandidates.map((c) => c.id)).toContain(privateProjectId);

      // For non-member guest (sees only public projects)
      const guestCandidates = await getRoutingCandidatesForUser(sql, {
        orgId,
        userId: guestId,
      });
      expect(guestCandidates.map((c) => c.id)).toContain(publicProjectId);
      expect(guestCandidates.map((c) => c.id)).not.toContain(privateProjectId);
    });

    it('resolves speakers with verified email matching, fuzzy LLM fallback, and unverified fallback', async () => {
      const mockLlm: LLMPort = {
        provider: 'mock',
        async complete<T>(req: LLMCompletionRequest<T>): Promise<LLMCompletionResult<T>> {
          const validated = req.schema.parse({
            resolutions: [
              {
                speakerLabel: 'External Contractor',
                matchedUserId: null,
                confidence: 0.1,
                reason: 'External contractor not found in active org members',
              },
            ],
          });
          return {
            data: validated,
            model: 'mock-model',
            promptVersion: req.promptVersion,
            inputTokens: 50,
            outputTokens: 25,
            costInr: 0.01,
            durationMs: 10,
          };
        },
        async embed() {
          return { embeddings: [], model: 'mock', inputTokens: 0, costInr: 0 };
        },
        async checkHealth() {
          return { healthy: true };
        },
      };

      const participants = [
        {
          id: 'p1',
          name: 'Host Owner',
          user_email: hostEmail,
        },
        {
          id: 'p2',
          name: 'Colleague Dev',
          user_email: memberEmail,
        },
      ];

      const res = await resolveMeetingSpeakers(sql, {
        orgId,
        meetingId,
        participants,
        llmAdapter: mockLlm,
      });

      expect(res.resolvedCount).toBe(2);
      expect(res.unresolvedCount).toBe(1);

      expect(res.mapping['Host Owner']?.method).toBe('email_verified');
      expect(res.mapping['Host Owner']?.userId).toBe(ownerId);
      expect(res.mapping['Host Owner']?.confidence).toBe(1.0);

      expect(res.mapping['Colleague Dev']?.method).toBe('email_verified');
      expect(res.mapping['Colleague Dev']?.userId).toBe(memberId);

      expect(res.mapping['External Contractor']?.method).toBe('unresolved');
      expect(res.mapping['External Contractor']?.userId).toBeNull();

      // Verify transcript segments were updated without altering text, seq, or speaker_label
      const speakers = await getMeetingSpeakers(sql, { orgId, meetingId });
      expect(speakers).toHaveLength(3);
      const hostSpeaker = speakers.find((s) => s.speakerLabel === 'Host Owner');
      expect(hostSpeaker?.userId).toBe(ownerId);
      expect(hostSpeaker?.userName).toBe('Host Owner');
      expect(hostSpeaker?.resolutionMethod).toBe('email_verified');
    });

    it('allows manual speaker mapping correction', async () => {
      // Manually assign External Contractor to memberId
      await updateSpeakerMapping(sql, {
        orgId,
        meetingId,
        speakerLabel: 'External Contractor',
        userId: memberId,
        actorId: ownerId,
      });

      const speakers = await getMeetingSpeakers(sql, { orgId, meetingId });
      const contractor = speakers.find((s) => s.speakerLabel === 'External Contractor');
      expect(contractor?.userId).toBe(memberId);
      expect(contractor?.resolutionMethod).toBe('manual');
      expect(contractor?.resolutionConfidence).toBe(1.0);
    });

    it('enters AskHost branch if routing confidence is under 0.70', async () => {
      const lowConfidenceLlm: LLMPort = {
        provider: 'mock',
        async complete<T>(req: LLMCompletionRequest<T>): Promise<LLMCompletionResult<T>> {
          const validated = req.schema.parse({
            selectedProjectId: publicProjectId,
            confidence: 0.65, // Under 0.70 threshold!
            explanation: 'Unclear match between platform and confidential project',
            alternatives: [privateProjectId],
          });
          return {
            data: validated,
            model: 'mock-model',
            promptVersion: req.promptVersion,
            inputTokens: 50,
            outputTokens: 25,
            costInr: 0.01,
            durationMs: 10,
          };
        },
        async embed() {
          return { embeddings: [], model: 'mock', inputTokens: 0, costInr: 0 };
        },
        async checkHealth() {
          return { healthy: true };
        },
      };

      const result = await evaluateAndRouteMeeting(sql, {
        orgId,
        meetingId,
        llmAdapter: lowConfidenceLlm,
      });

      expect(result.routed).toBe(false);
      expect(result.status).toBe('awaiting_project_choice');
      expect(result.suggestedNodeId).toBe(publicProjectId);
      expect(result.confidence).toBe(0.65);

      // Verify database record
      const [meetingRow] = await sql<Array<{ status: string; suggested_node_id: string }>>`
        SELECT status, suggested_node_id FROM meetings WHERE id = ${meetingId}
      `;
      expect(meetingRow?.status).toBe('awaiting_project_choice');
      expect(meetingRow?.suggested_node_id).toBe(publicProjectId);
    });

    it('automatically routes meeting if confidence is >= 0.70', async () => {
      const highConfidenceLlm: LLMPort = {
        provider: 'mock',
        async complete<T>(req: LLMCompletionRequest<T>): Promise<LLMCompletionResult<T>> {
          const validated = req.schema.parse({
            selectedProjectId: publicProjectId,
            confidence: 0.92, // >= 0.70 threshold!
            explanation: 'Transcript directly discusses Workspace v1 Platform architecture',
            alternatives: [],
          });
          return {
            data: validated,
            model: 'mock-model',
            promptVersion: req.promptVersion,
            inputTokens: 50,
            outputTokens: 25,
            costInr: 0.01,
            durationMs: 10,
          };
        },
        async embed() {
          return { embeddings: [], model: 'mock', inputTokens: 0, costInr: 0 };
        },
        async checkHealth() {
          return { healthy: true };
        },
      };

      const result = await evaluateAndRouteMeeting(sql, {
        orgId,
        meetingId,
        llmAdapter: highConfidenceLlm,
      });

      expect(result.routed).toBe(true);
      expect(result.status).toBe('routed');
      expect(result.suggestedNodeId).toBe(publicProjectId);

      const [meetingRow] = await sql<Array<{ status: string; node_id: string }>>`
        SELECT status, node_id FROM meetings WHERE id = ${meetingId}
      `;
      expect(meetingRow?.status).toBe('routed');
      expect(meetingRow?.node_id).toBe(publicProjectId);
    });

    it('supports manual routing decision with OCC version check', async () => {
      const [currentMeeting] = await sql<Array<{ version: number }>>`
        SELECT version FROM meetings WHERE id = ${meetingId}
      `;

      // 1. Version mismatch fails
      await expect(
        manuallyRouteMeeting(sql, {
          orgId,
          meetingId,
          nodeId: privateProjectId,
          actorId: ownerId,
          role: 'owner',
          expectedVersion: 9999,
        })
      ).rejects.toThrow(/Resource version mismatch/i);

      // 2. Correct version succeeds
      const updated = await manuallyRouteMeeting(sql, {
        orgId,
        meetingId,
        nodeId: privateProjectId,
        actorId: ownerId,
        role: 'owner',
        expectedVersion: currentMeeting?.version,
      });

      expect(updated.nodeId).toBe(privateProjectId);
      expect(updated.status).toBe('routed');
      expect(updated.routingActorId).toBe(ownerId);
      expect(updated.version).toBe((currentMeeting?.version ?? 0) + 1);

      // Verify outbox has meeting.routed event
      const [outboxEvent] = await sql<Array<{ topic: string }>>`
        SELECT topic FROM outbox 
        WHERE org_id = ${orgId} AND topic = 'meeting.routed'
        ORDER BY created_at DESC LIMIT 1
      `;
      expect(outboxEvent?.topic).toBe('meeting.routed');
    });

    it('resolves guest consent attestation', async () => {
      const resolved = await resolveGuestConsent(sql, {
        orgId,
        meetingId,
        actorId: ownerId,
        guestConsentStatus: 'consented',
        attestationNotes: 'External contractor consented verbally at meeting start',
      });

      expect(resolved.guestConsentStatus).toBe('consented');
    });

    it('supports host self-service consent opt-in and opt-out', async () => {
      // 1. Host opts in
      const consentIn = await updateMyHostConsent(sql, {
        orgId,
        userId: ownerId,
        userEmail: hostEmail,
        userName: 'Host Owner',
        consentStatus: 'opted_in',
      });
      expect(consentIn.consentStatus).toBe('opted_in');

      // Check getMyHostConsent
      const fetched = await getMyHostConsent(sql, {
        orgId,
        userId: ownerId,
        userEmail: hostEmail,
      });
      expect(fetched?.consentStatus).toBe('opted_in');

      // 2. Host opts out -> fences in-flight meetings
      const consentOut = await updateMyHostConsent(sql, {
        orgId,
        userId: ownerId,
        userEmail: hostEmail,
        userName: 'Host Owner',
        consentStatus: 'opted_out',
      });
      expect(consentOut.consentStatus).toBe('opted_out');
    });
  });
});
