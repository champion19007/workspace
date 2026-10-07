import type { FastifyPluginAsync } from 'fastify';
import {
  type DatabaseInstance,
  listLabels,
  createLabel,
  deleteLabel,
} from '@workspace/db';
import {
  type AppPorts,
  CreateLabelSchema,
  ValidationError,
} from '@workspace/core';

export const labelRoutes: FastifyPluginAsync<{ db: DatabaseInstance; ports?: AppPorts }> = async (
  app,
  { db }
) => {
  // 1. List labels for the organisation
  app.get(
    '/api/v1/orgs/:orgSlug/labels',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const labels = await listLabels(db, {
        orgId: request.tenant!.orgId,
      });

      return reply.status(200).send({ labels });
    }
  );

  // 2. Create a label in the organisation
  app.post(
    '/api/v1/orgs/:orgSlug/labels',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const parsed = CreateLabelSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid label creation payload', parsed.error.format());
      }

      const label = await createLabel(db, {
        orgId: request.tenant!.orgId,
        role: request.tenant!.role,
        input: parsed.data,
      });

      return reply.status(201).send(label);
    }
  );

  // 3. Delete a label from the organisation
  app.delete(
    '/api/v1/orgs/:orgSlug/labels/:labelId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { labelId } = request.params as { labelId: string };

      await deleteLabel(db, {
        orgId: request.tenant!.orgId,
        role: request.tenant!.role,
        labelId,
      });

      return reply.status(200).send({ success: true });
    }
  );
};
