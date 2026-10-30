import {
  ValidationError,
  NotFoundError,
  type LLMPort,
  SpeakerResolutionResultSchema,
  type ZoomMeetingParticipant,
} from '@workspace/core';
import { tenantSql, type DbOrSql } from './client.js';

export interface SpeakerResolutionInfo {
  userId: string | null;
  method: 'email_verified' | 'fuzzy_llm' | 'manual' | 'unresolved';
  confidence: number;
  reason?: string;
}

export interface ResolveMeetingSpeakersResult {
  resolvedCount: number;
  unresolvedCount: number;
  mapping: Record<string, SpeakerResolutionInfo>;
}

interface OrgMemberRow {
  id: string;
  email: string;
  name: string;
  role: string;
}

/**
 * Resolves transcript speaker labels to verified Workspace identities.
 * 1. Verified participant emails matched to active org members first (confidence 1.0).
 * 2. Ambiguous or partial matches resolved via fast LLM tier against candidate active org members.
 * 3. Never creates speculative users or alters original transcript text, timestamps, or speaker_labels.
 */
export async function resolveMeetingSpeakers(
  target: DbOrSql,
  params: {
    orgId: string;
    meetingId: string;
    participants: ZoomMeetingParticipant[];
    llmAdapter?: LLMPort;
  }
): Promise<ResolveMeetingSpeakersResult> {
  const sql = tenantSql(target, { orgId: params.orgId, system: true });
  const { orgId, meetingId, participants, llmAdapter } = params;

  // 1. Fetch distinct speaker labels from transcript_segments
  const distinctSpeakers = await sql<Array<{ speaker_label: string; count: number }>>`
    SELECT speaker_label, count(*)::int as count
    FROM transcript_segments
    WHERE org_id = ${orgId} AND meeting_id = ${meetingId}
    GROUP BY speaker_label
  `;

  if (distinctSpeakers.length === 0) {
    return { resolvedCount: 0, unresolvedCount: 0, mapping: {} };
  }

  // 2. Fetch all active organization members
  const members = await sql<OrgMemberRow[]>`
    SELECT u.id, u.email, u.name, m.role
    FROM memberships m
    JOIN users u ON m.user_id = u.id
    WHERE m.org_id = ${orgId}
  `;

  const memberByEmail = new Map<string, OrgMemberRow>();
  const memberById = new Map<string, OrgMemberRow>();
  const memberByName = new Map<string, OrgMemberRow[]>();

  for (const m of members) {
    memberById.set(m.id, m);
    if (m.email) {
      memberByEmail.set(m.email.toLowerCase().trim(), m);
    }
    if (m.name) {
      const normName = m.name.toLowerCase().trim();
      const existing = memberByName.get(normName) || [];
      existing.push(m);
      memberByName.set(normName, existing);
    }
  }

  // Build mapping from participant name to participant
  const participantsByName = new Map<string, ZoomMeetingParticipant[]>();
  for (const p of participants) {
    if (p.name) {
      const normName = p.name.toLowerCase().trim();
      const existing = participantsByName.get(normName) || [];
      existing.push(p);
      participantsByName.set(normName, existing);
    }
  }

  const mapping: Record<string, SpeakerResolutionInfo> = {};
  const unresolvedLabels: string[] = [];

  // Phase 1: Match verified participant emails
  for (const s of distinctSpeakers) {
    const label = s.speaker_label;
    const normLabel = label.toLowerCase().trim();

    // Look for participant matching this label
    const matchingParticipants = participantsByName.get(normLabel);
    let matchedMember: OrgMemberRow | undefined;

    if (matchingParticipants && matchingParticipants.length > 0) {
      // Find one with verified email in org members
      for (const p of matchingParticipants) {
        if (p.user_email) {
          const found = memberByEmail.get(p.user_email.toLowerCase().trim());
          if (found) {
            matchedMember = found;
            break;
          }
        }
      }
    }

    // Direct name match if exactly one member in org has that name
    if (!matchedMember) {
      const candidates = memberByName.get(normLabel);
      if (candidates && candidates.length === 1) {
        matchedMember = candidates[0];
      }
    }

    if (matchedMember) {
      mapping[label] = {
        userId: matchedMember.id,
        method: 'email_verified',
        confidence: 1.0,
        reason: `Matched verified org member ${matchedMember.name} (${matchedMember.email})`,
      };
    } else {
      unresolvedLabels.push(label);
    }
  }

  // Phase 2: Disambiguate remaining labels via fast LLM tier if available
  if (unresolvedLabels.length > 0 && llmAdapter && members.length > 0) {
    try {
      // Fetch sample transcript snippets for unresolved labels
      const samples = await sql<Array<{ speaker_label: string; text: string }>>`
        SELECT speaker_label, text
        FROM transcript_segments
        WHERE org_id = ${orgId} AND meeting_id = ${meetingId}
          AND speaker_label = ANY(${unresolvedLabels})
        ORDER BY seq ASC
        LIMIT 20
      `;

      const candidateUsers = members.map((m) => ({ id: m.id, name: m.name, email: m.email }));

      const llmResult = await llmAdapter.complete({
        promptId: 'resolve.speakers',
        promptVersion: '1.0',
        tier: 'fast',
        schema: SpeakerResolutionResultSchema,
        systemPrefix:
          'You are an identity disambiguation assistant in Workspace v1. Match transcript speaker labels to active organization user IDs. Only match if confident. If external guest or uncertain, set matchedUserId to null.',
        input: {
          candidateUsers,
          unresolvedLabels,
          transcriptSamples: samples.map((s) => ({ speaker: s.speaker_label, text: s.text })),
        },
      });

      if (llmResult.data && Array.isArray(llmResult.data.resolutions)) {
        for (const res of llmResult.data.resolutions) {
          if (res.matchedUserId && memberById.has(res.matchedUserId)) {
            const member = memberById.get(res.matchedUserId)!;
            mapping[res.speakerLabel] = {
              userId: member.id,
              method: 'fuzzy_llm',
              confidence: Number(res.confidence.toFixed(3)),
              reason: res.reason,
            };
            const idx = unresolvedLabels.indexOf(res.speakerLabel);
            if (idx !== -1) unresolvedLabels.splice(idx, 1);
          }
        }
      }
    } catch {
      // LLM failure gracefully degrades to unresolved
    }
  }

  // Phase 3: Any remaining speakers are marked unresolved
  for (const label of unresolvedLabels) {
    if (!mapping[label]) {
      mapping[label] = {
        userId: null,
        method: 'unresolved',
        confidence: 0,
        reason: 'No matching verified organization identity found',
      };
    }
  }

  // 3. Atomically update transcript_segments and meeting metadata in database
  let resolvedCount = 0;
  let unresolvedCount = 0;

  await sql.begin(async (txn) => {
    for (const [label, info] of Object.entries(mapping)) {
      if (info.userId) {
        resolvedCount++;
      } else {
        unresolvedCount++;
      }

      await txn`
        UPDATE transcript_segments
        SET 
          user_id = ${info.userId},
          resolution_method = ${info.method},
          resolution_confidence = ${info.confidence}
        WHERE org_id = ${orgId} 
          AND meeting_id = ${meetingId} 
          AND speaker_label = ${label}
      `;
    }

    await txn`
      UPDATE meetings
      SET 
        speakers_resolved = true,
        speaker_resolution_metadata = ${JSON.stringify(mapping)}::jsonb,
        updated_at = NOW()
      WHERE org_id = ${orgId} AND id = ${meetingId}
    `;
  });

  return {
    resolvedCount,
    unresolvedCount,
    mapping,
  };
}

/**
 * Manually updates the speaker mapping for a meeting.
 */
export async function updateSpeakerMapping(
  target: DbOrSql,
  params: {
    orgId: string;
    meetingId: string;
    speakerLabel: string;
    userId: string | null;
    actorId?: string;
  }
): Promise<void> {
  const sql = tenantSql(target, { orgId: params.orgId, userId: params.actorId });
  const { orgId, meetingId, speakerLabel, userId, actorId } = params;

  if (userId) {
    // Verify user belongs to organization
    const [membership] = await sql`
      SELECT 1 FROM memberships WHERE org_id = ${orgId} AND user_id = ${userId}
    `;
    if (!membership) {
      throw new ValidationError('Selected user is not an active member of this organization');
    }
  }

  // Verify meeting exists
  const [meeting] = await sql<Array<{ id: string; speaker_resolution_metadata: any }>>`
    SELECT id, speaker_resolution_metadata
    FROM meetings
    WHERE org_id = ${orgId} AND id = ${meetingId}
  `;
  if (!meeting) {
    throw new NotFoundError(`Meeting "${meetingId}" not found`);
  }

  let existingMeta: Record<string, any> = {};
  if (meeting.speaker_resolution_metadata) {
    if (typeof meeting.speaker_resolution_metadata === 'string') {
      try {
        existingMeta = JSON.parse(meeting.speaker_resolution_metadata);
      } catch {
        existingMeta = {};
      }
    } else if (typeof meeting.speaker_resolution_metadata === 'object') {
      existingMeta = { ...meeting.speaker_resolution_metadata };
    }
  }

  existingMeta[speakerLabel] = {
    userId,
    method: 'manual',
    confidence: 1.0,
    updatedBy: actorId || null,
    updatedAt: new Date().toISOString(),
  };

  await sql.begin(async (txn) => {
    await txn`
      UPDATE transcript_segments
      SET 
        user_id = ${userId},
        resolution_method = 'manual',
        resolution_confidence = 1.0
      WHERE org_id = ${orgId} 
        AND meeting_id = ${meetingId} 
        AND speaker_label = ${speakerLabel}
    `;

    await txn`
      UPDATE meetings
      SET 
        speaker_resolution_metadata = ${JSON.stringify(existingMeta)}::jsonb,
        updated_at = NOW()
      WHERE org_id = ${orgId} AND id = ${meetingId}
    `;

    if (actorId) {
      await txn`
        INSERT INTO activity_log (org_id, actor_id, verb, target_type, target_id, payload)
        VALUES (
          ${orgId}, 
          ${actorId}, 
          'speaker.mapped', 
          'meeting', 
          ${meetingId}, 
          ${JSON.stringify({ speakerLabel, userId })}::jsonb
        )
      `;
    }
  });
}

/**
 * Retrieves the speaker summary and resolution mapping for a meeting.
 */
export async function getMeetingSpeakers(
  target: DbOrSql,
  /** actorUserId: the viewer, so mapped members' names resolve under RLS. */
  params: { orgId: string; meetingId: string; actorUserId?: string }
): Promise<
  Array<{
    speakerLabel: string;
    userId: string | null;
    userName: string | null;
    userEmail: string | null;
    resolutionMethod: string | null;
    resolutionConfidence: number | null;
    segmentCount: number;
  }>
> {
  const sql = tenantSql(target, { orgId: params.orgId, userId: params.actorUserId });
  const { orgId, meetingId } = params;

  const rows = await sql<
    Array<{
      speakerLabel: string;
      userId: string | null;
      userName: string | null;
      userEmail: string | null;
      resolutionMethod: string | null;
      resolutionConfidence: string | number | null;
      segmentCount: number;
    }>
  >`
    SELECT 
      ts.speaker_label as "speakerLabel",
      ts.user_id as "userId",
      u.name as "userName",
      u.email as "userEmail",
      ts.resolution_method as "resolutionMethod",
      ts.resolution_confidence as "resolutionConfidence",
      count(*)::int as "segmentCount"
    FROM transcript_segments ts
    LEFT JOIN users u ON ts.user_id = u.id
    WHERE ts.org_id = ${orgId} AND ts.meeting_id = ${meetingId}
    GROUP BY ts.speaker_label, ts.user_id, u.name, u.email, ts.resolution_method, ts.resolution_confidence
    ORDER BY ts.speaker_label ASC
  `;

  return rows.map((r) => ({
    ...r,
    resolutionConfidence: r.resolutionConfidence ? Number(r.resolutionConfidence) : null,
  }));
}
