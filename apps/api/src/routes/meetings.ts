import type { FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';
import type { AppPorts } from '@workspace/core';
import {
  ListMeetingsQuerySchema,
  GetTranscriptQuerySchema,
  SkipMeetingRequestSchema,
  RouteMeetingRequestSchema,
  UpdateSpeakerMappingSchema,
  ResolveGuestConsentSchema,
  formatETag,
} from '@workspace/core';
import {
  listOrgMeetings,
  retryMeetingIntake,
  getMeetingById,
  getMeetingTranscript,
  skipMeetingAndCleanup,
  manuallyRouteMeeting,
  updateSpeakerMapping,
  getMeetingSpeakers,
  getRoutingCandidatesForUser,
  resolveGuestConsent,
  getMeetingNotesAndSuggestions,
  authorizeMeetingAccess,
} from '@workspace/db';

export interface MeetingRouteOptions {
  sql: Sql;
  ports: AppPorts;
}

export const meetingRoutes: FastifyPluginAsync<MeetingRouteOptions> = async (app, options) => {
  const { sql, ports } = options;

  /**
   * GET /api/v1/orgs/:orgSlug/meetings
   * Lists permitted meeting intake records.
   * RBAC: Owners and Admins view all organization meetings.
   * Members view only meetings where they are the verified host.
   * Viewers receive an empty list (read-only without unrouted intake exposure).
   */
  app.get(
    '/api/v1/orgs/:orgSlug/meetings',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const parsed = ListMeetingsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid meeting query parameters',
          details: parsed.error.format(),
        });
      }

      const tenant = request.tenant!;
      const user = request.user!;

      const meetings = await listOrgMeetings(sql, {
        orgId: tenant.orgId,
        userId: user.id,
        role: tenant.role,
        status: parsed.data.status,
        query: parsed.data.query,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });

      return reply.status(200).send({ meetings });
    }
  );

  /**
   * GET /api/v1/orgs/:orgSlug/meetings/:meetingId/transcript
   * Retrieves paginated transcript segments for an ingested meeting.
   * RBAC: Owners and Admins can view any org meeting. Members can view meetings they hosted.
   * Viewers receive 403 Forbidden.
   */
  app.get(
    '/api/v1/orgs/:orgSlug/meetings/:meetingId/transcript',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { meetingId } = request.params as { meetingId: string };
      const parsed = GetTranscriptQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid transcript query parameters',
          details: parsed.error.format(),
        });
      }

      const tenant = request.tenant!;
      const user = request.user!;

      const auth = await authorizeMeetingAccess(sql, {
        orgId: tenant.orgId,
        meetingId,
        userId: user.id,
        userRole: tenant.role,
        action: 'read',
      });
      if (!auth.authorized) {
        return reply.status(auth.httpStatus).send({
          error: auth.errorCode,
          message: auth.errorMessage,
        });
      }
      const meeting = auth.meeting!;

      const result = await getMeetingTranscript(sql, {
        orgId: tenant.orgId,
        meetingId,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        search: parsed.data.search,
      });

      reply.header('ETag', formatETag(meeting.version));
      return reply.status(200).send(result);
    }
  );

  /**
   * POST /api/v1/orgs/:orgSlug/meetings/:meetingId/retry
   * Re-evaluates host eligibility and retries transcript readiness transition.
   * Permitted only for organization Owners or Admins.
   */
  app.post(
    '/api/v1/orgs/:orgSlug/meetings/:meetingId/retry',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { meetingId } = request.params as { meetingId: string };
      const tenant = request.tenant!;
      const user = request.user!;

      const meeting = await retryMeetingIntake(sql, {
        orgId: tenant.orgId,
        meetingId,
        userId: user.id,
        role: tenant.role,
      });

      reply.header('ETag', formatETag(meeting.version));
      return reply.status(200).send({ meeting });
    }
  );

  /**
   * POST /api/v1/orgs/:orgSlug/meetings/:meetingId/skip
   * Skips meeting processing, increments processing generation to fence active workers,
   * purges database transcript segments and AI notes, and deletes raw transcript blob from storage.
   * Requires strong ETag via If-Match header ("v<version>").
   */
  app.post(
    '/api/v1/orgs/:orgSlug/meetings/:meetingId/skip',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { meetingId } = request.params as { meetingId: string };
      const tenant = request.tenant!;
      const user = request.user!;

      const parsed = SkipMeetingRequestSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid skip request payload',
          details: parsed.error.format(),
        });
      }

      const auth = await authorizeMeetingAccess(sql, {
        orgId: tenant.orgId,
        meetingId,
        userId: user.id,
        userRole: tenant.role,
        action: 'mutate',
      });
      if (!auth.authorized) {
        return reply.status(auth.httpStatus).send({
          error: auth.errorCode,
          message: auth.errorMessage,
        });
      }
      const currentMeeting = auth.meeting!;

      // Strong If-Match OCC check: missing -> 428, mismatch/weak -> 412
      const ifMatchVersion = app.verifyIfMatch(request, currentMeeting.version, currentMeeting);

      const updatedMeeting = await skipMeetingAndCleanup(sql, {
        orgId: tenant.orgId,
        meetingId,
        ifMatchVersion,
        reason: parsed.data.reason,
        blobStore: ports.blobStore,
      });

      reply.header('ETag', formatETag(updatedMeeting.version));
      return reply.status(200).send({ meeting: updatedMeeting });
    }
  );

  /**
   * GET /api/v1/orgs/:orgSlug/meetings/:meetingId/routing-candidates
   * Lists active project leaves visible to the caller within the organization.
   */
  app.get(
    '/api/v1/orgs/:orgSlug/meetings/:meetingId/routing-candidates',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { meetingId } = request.params as { meetingId: string };
      const tenant = request.tenant!;
      const user = request.user!;

      const auth = await authorizeMeetingAccess(sql, {
        orgId: tenant.orgId,
        meetingId,
        userId: user.id,
        userRole: tenant.role,
        action: 'mutate',
      });
      if (!auth.authorized) {
        return reply.status(auth.httpStatus).send({
          error: auth.errorCode,
          message: auth.errorMessage,
        });
      }

      const candidates = await getRoutingCandidatesForUser(sql, {
        orgId: tenant.orgId,
        userId: user.id,
      });

      return reply.status(200).send({ candidates });
    }
  );

  /**
   * GET /api/v1/orgs/:orgSlug/meetings/:meetingId/speakers
   * Retrieves the speaker labels, resolved users, resolution methods, and counts.
   */
  app.get(
    '/api/v1/orgs/:orgSlug/meetings/:meetingId/speakers',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { meetingId } = request.params as { meetingId: string };
      const tenant = request.tenant!;
      const user = request.user!;

      const auth = await authorizeMeetingAccess(sql, {
        orgId: tenant.orgId,
        meetingId,
        userId: user.id,
        userRole: tenant.role,
        action: 'read',
      });
      if (!auth.authorized) {
        return reply.status(auth.httpStatus).send({
          error: auth.errorCode,
          message: auth.errorMessage,
        });
      }
      const meeting = auth.meeting!;

      const speakers = await getMeetingSpeakers(sql, {
        orgId: tenant.orgId,
        meetingId,
      });

      return reply.status(200).send({
        speakers,
        metadata: meeting.speakerResolutionMetadata || {},
        speakersResolved: meeting.speakersResolved,
      });
    }
  );

  /**
   * POST /api/v1/orgs/:orgSlug/meetings/:meetingId/route
   * Manually routes a meeting to a designated active project leaf node.
   * Requires strong ETag OCC via If-Match ("v<version>").
   */
  app.post(
    '/api/v1/orgs/:orgSlug/meetings/:meetingId/route',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { meetingId } = request.params as { meetingId: string };
      const tenant = request.tenant!;
      const user = request.user!;

      const parsed = RouteMeetingRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid project routing payload',
          details: parsed.error.format(),
        });
      }

      const auth = await authorizeMeetingAccess(sql, {
        orgId: tenant.orgId,
        meetingId,
        userId: user.id,
        userRole: tenant.role,
        action: 'mutate',
      });
      if (!auth.authorized) {
        return reply.status(auth.httpStatus).send({
          error: auth.errorCode,
          message: auth.errorMessage,
        });
      }
      const currentMeeting = auth.meeting!;

      // Strong If-Match OCC check: missing -> 428, mismatch/weak -> 412
      const ifMatchVersion = app.verifyIfMatch(request, currentMeeting.version, currentMeeting);

      const targetProjectId = (parsed.data.nodeId || parsed.data.targetProjectId)!;

      const updatedMeeting = await manuallyRouteMeeting(sql, {
        orgId: tenant.orgId,
        meetingId,
        nodeId: targetProjectId,
        actorId: user.id,
        role: tenant.role,
        expectedVersion: ifMatchVersion,
      });

      reply.header('ETag', formatETag(updatedMeeting.version));
      return reply.status(200).send({ meeting: updatedMeeting });
    }
  );

  /**
   * POST /api/v1/orgs/:orgSlug/meetings/:meetingId/speakers
   * Manually maps or corrects a speaker label to an active organization member.
   */
  app.post(
    '/api/v1/orgs/:orgSlug/meetings/:meetingId/speakers',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { meetingId } = request.params as { meetingId: string };
      const tenant = request.tenant!;
      const user = request.user!;

      const parsed = UpdateSpeakerMappingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid speaker mapping payload',
          details: parsed.error.format(),
        });
      }

      const auth = await authorizeMeetingAccess(sql, {
        orgId: tenant.orgId,
        meetingId,
        userId: user.id,
        userRole: tenant.role,
        action: 'mutate',
      });
      if (!auth.authorized) {
        return reply.status(auth.httpStatus).send({
          error: auth.errorCode,
          message: auth.errorMessage,
        });
      }

      await updateSpeakerMapping(sql, {
        orgId: tenant.orgId,
        meetingId,
        speakerLabel: parsed.data.speakerLabel,
        userId: parsed.data.userId,
        actorId: user.id,
      });

      const updatedMeeting = await getMeetingById(sql, tenant.orgId, meetingId);
      return reply.status(200).send({ meeting: updatedMeeting });
    }
  );

  /**
   * POST /api/v1/orgs/:orgSlug/meetings/:meetingId/guest-consent
   * Resolves guest consent status when external participants are present.
   */
  app.post(
    '/api/v1/orgs/:orgSlug/meetings/:meetingId/guest-consent',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { meetingId } = request.params as { meetingId: string };
      const tenant = request.tenant!;
      const user = request.user!;

      const parsed = ResolveGuestConsentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid guest consent payload',
          details: parsed.error.format(),
        });
      }

      const auth = await authorizeMeetingAccess(sql, {
        orgId: tenant.orgId,
        meetingId,
        userId: user.id,
        userRole: tenant.role,
        action: 'mutate',
      });
      if (!auth.authorized) {
        return reply.status(auth.httpStatus).send({
          error: auth.errorCode,
          message: auth.errorMessage,
        });
      }

      const updatedMeeting = await resolveGuestConsent(sql, {
        orgId: tenant.orgId,
        meetingId,
        actorId: user.id,
        guestConsentStatus: parsed.data.guestConsentStatus,
        attestationNotes: parsed.data.attestationNotes,
      });

      reply.header('ETag', formatETag(updatedMeeting.version));
      return reply.status(200).send({ meeting: updatedMeeting });
    }
  );

  /**
   * GET /api/v1/orgs/:orgSlug/meetings/:meetingId/notes
   * Retrieves generated AI meeting notes, key decisions, open questions, and staged action items.
   * Centralized RBAC via authorizeMeetingAccess:
   * - Owners & Admins can access all meetings in the org.
   * - Routed meetings: project privacy strictly governs access (public or node_members).
   *   Hosting a meeting does NOT bypass private-project access.
   * - Inaccessible private resources return 404.
   * - Viewers can read permitted meeting notes.
   */
  app.get(
    '/api/v1/orgs/:orgSlug/meetings/:meetingId/notes',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { meetingId } = request.params as { meetingId: string };
      const tenant = request.tenant!;
      const user = request.user!;

      const auth = await authorizeMeetingAccess(sql, {
        orgId: tenant.orgId,
        meetingId,
        userId: user.id,
        userRole: tenant.role,
        action: 'read',
      });
      if (!auth.authorized) {
        return reply.status(auth.httpStatus).send({
          error: auth.errorCode,
          message: auth.errorMessage,
        });
      }
      const meeting = auth.meeting!;

      const result = await getMeetingNotesAndSuggestions(sql, tenant.orgId, meetingId);
      reply.header('ETag', formatETag(meeting.version));
      return reply.status(200).send(result);
    }
  );
};
