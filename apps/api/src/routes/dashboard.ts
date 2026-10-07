import type { FastifyPluginAsync } from 'fastify';
import {
  type DatabaseInstance,
  getProjectDashboard,
  getPermissionSafeRollup,
  getLeadershipSummary,
} from '@workspace/db';
import {
  type AppPorts,
  LeadershipSummaryQuerySchema,
  ValidationError,
  getKolkataTodayDateString,
} from '@workspace/core';
import { z } from 'zod';

const DashboardQuerySchema = z.object({
  dateContext: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const dashboardRoutes: FastifyPluginAsync<{ db: DatabaseInstance; ports?: AppPorts }> = async (
  app,
  { db }
) => {
  // 1. Project Dashboard (Screenshot 927: Hero, Completion Ring, 4-Item Metric Strip, Activity Feed)
  app.get(
    '/api/v1/orgs/:orgSlug/projects/:projectId/dashboard',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const parsedQuery = DashboardQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        throw new ValidationError('Invalid date context format. Expected YYYY-MM-DD', parsedQuery.error.format());
      }

      const dateContext = parsedQuery.data.dateContext || getKolkataTodayDateString();

      const dashboard = await getProjectDashboard(db, {
        orgId: request.tenant!.orgId,
        projectId,
        userId: request.user!.id,
        role: request.tenant!.role,
        dateContext,
      });

      return reply.status(200).send(dashboard);
    }
  );

  // 2. Project Health Rollup (Permission-safe single project metrics)
  app.get(
    '/api/v1/orgs/:orgSlug/projects/:projectId/rollup',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const parsedQuery = DashboardQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        throw new ValidationError('Invalid date context format. Expected YYYY-MM-DD', parsedQuery.error.format());
      }

      const dateContext = parsedQuery.data.dateContext || getKolkataTodayDateString();

      const rollup = await getPermissionSafeRollup(db, {
        orgId: request.tenant!.orgId,
        nodeId: projectId,
        userId: request.user!.id,
        role: request.tenant!.role,
        dateContext,
      });

      return reply.status(200).send({ projectId, rollup });
    }
  );

  // 3. Team Summary (Permission-safe rollup summing accessible leaf projects under the team)
  app.get(
    '/api/v1/orgs/:orgSlug/teams/:teamId/summary',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { teamId } = request.params as { teamId: string };
      const parsedQuery = DashboardQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        throw new ValidationError('Invalid date context format. Expected YYYY-MM-DD', parsedQuery.error.format());
      }

      const dateContext = parsedQuery.data.dateContext || getKolkataTodayDateString();

      const rollup = await getPermissionSafeRollup(db, {
        orgId: request.tenant!.orgId,
        nodeId: teamId,
        userId: request.user!.id,
        role: request.tenant!.role,
        dateContext,
      });

      return reply.status(200).send({ teamId, rollup });
    }
  );

  // 4. Leadership Summary (Screenshots 935-937: Direct-SQL Parity for Counters & Filtered Drilldowns)
  app.get(
    '/api/v1/orgs/:orgSlug/leadership/summary',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const parsedFilters = LeadershipSummaryQuerySchema.safeParse(request.query);
      if (!parsedFilters.success) {
        throw new ValidationError('Invalid leadership query filters', parsedFilters.error.format());
      }

      const parsedQuery = DashboardQuerySchema.safeParse(request.query);
      const dateContext = (parsedQuery.success && parsedQuery.data.dateContext) || getKolkataTodayDateString();

      const leadership = await getLeadershipSummary(db, {
        orgId: request.tenant!.orgId,
        userId: request.user!.id,
        role: request.tenant!.role,
        filters: parsedFilters.data,
        dateContext,
      });

      return reply.status(200).send(leadership);
    }
  );
};
