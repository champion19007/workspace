import type { FastifyPluginAsync } from 'fastify';
import {
  type DatabaseInstance,
  createDoc,
  getDocById,
  listDocs,
  updateDoc,
  archiveDoc,
  listDocVersions,
  getDocVersion,
  restoreDocVersion,
} from '@workspace/db';
import {
  type AppPorts,
  CreateDocSchema,
  UpdateDocSchema,
  RestoreDocSchema,
  ListDocsQuerySchema,
  ValidationError,
  formatETag,
} from '@workspace/core';

export const docRoutes: FastifyPluginAsync<{ db: DatabaseInstance; ports?: AppPorts }> = async (
  app,
  { db }
) => {
  // 1. List documents for organization (with optional nodeId, search, pagination)
  app.get(
    '/api/v1/orgs/:orgSlug/docs',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const parsed = ListDocsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError('Invalid documents query parameters', parsed.error.format());
      }

      const result = await listDocs(db, {
        orgId: request.tenant!.orgId,
        userId: request.user!.id,
        role: request.tenant!.role,
        query: parsed.data,
      });

      return reply.status(200).send(result);
    }
  );

  // 2. List documents under a specific node (team or project)
  app.get(
    '/api/v1/orgs/:orgSlug/nodes/:nodeId/docs',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string };
      const parsed = ListDocsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError('Invalid documents query parameters', parsed.error.format());
      }

      const result = await listDocs(db, {
        orgId: request.tenant!.orgId,
        userId: request.user!.id,
        role: request.tenant!.role,
        query: {
          ...parsed.data,
          nodeId,
        },
      });

      return reply.status(200).send(result);
    }
  );

  // 3. Create document under a specific node
  app.post(
    '/api/v1/orgs/:orgSlug/nodes/:nodeId/docs',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string };
      const body = (request.body as Record<string, unknown>) || {};
      const parsed = CreateDocSchema.safeParse({ ...body, nodeId });
      if (!parsed.success) {
        throw new ValidationError('Invalid document creation payload', parsed.error.format());
      }

      const doc = await createDoc(db, {
        orgId: request.tenant!.orgId,
        actorUserId: request.user!.id,
        role: request.tenant!.role,
        input: parsed.data,
      });

      reply.header('ETag', formatETag(doc.version));
      return reply.status(201).send(doc);
    }
  );

  // 3b. Create document (nodeId provided in body)
  app.post(
    '/api/v1/orgs/:orgSlug/docs',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const parsed = CreateDocSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid document creation payload', parsed.error.format());
      }

      const doc = await createDoc(db, {
        orgId: request.tenant!.orgId,
        actorUserId: request.user!.id,
        role: request.tenant!.role,
        input: parsed.data,
      });

      reply.header('ETag', formatETag(doc.version));
      return reply.status(201).send(doc);
    }
  );

  // 4. Get single document by ID
  app.get(
    '/api/v1/orgs/:orgSlug/docs/:docId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { docId } = request.params as { docId: string };

      const doc = await getDocById(db, {
        orgId: request.tenant!.orgId,
        docId,
        userId: request.user!.id,
        role: request.tenant!.role,
      });

      reply.header('ETag', formatETag(doc.version));
      return reply.status(200).send(doc);
    }
  );

  // 5. Update document with strong If-Match OCC
  app.patch(
    '/api/v1/orgs/:orgSlug/docs/:docId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { docId } = request.params as { docId: string };
      const parsed = UpdateDocSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid document update payload', parsed.error.format());
      }

      // Step 1: Read current entity to verify read permission (zero leakage -> 404)
      const currentDoc = await getDocById(db, {
        orgId: request.tenant!.orgId,
        docId,
        userId: request.user!.id,
        role: request.tenant!.role,
      });

      // Step 2: Strict If-Match verification (Missing -> 428, Mismatch -> 412)
      const ifMatchVersion = app.verifyIfMatch(request, currentDoc.version, currentDoc);

      // Step 3: Atomic update
      const updated = await updateDoc(db, {
        orgId: request.tenant!.orgId,
        docId,
        actorUserId: request.user!.id,
        role: request.tenant!.role,
        ifMatchVersion,
        input: parsed.data,
      });

      reply.header('ETag', formatETag(updated.version));
      return reply.status(200).send(updated);
    }
  );

  // 6. Archive document with strong If-Match OCC
  app.delete(
    '/api/v1/orgs/:orgSlug/docs/:docId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { docId } = request.params as { docId: string };

      const currentDoc = await getDocById(db, {
        orgId: request.tenant!.orgId,
        docId,
        userId: request.user!.id,
        role: request.tenant!.role,
      });

      const ifMatchVersion = app.verifyIfMatch(request, currentDoc.version, currentDoc);

      const archived = await archiveDoc(db, {
        orgId: request.tenant!.orgId,
        docId,
        actorUserId: request.user!.id,
        role: request.tenant!.role,
        ifMatchVersion,
      });

      reply.header('ETag', formatETag(archived.version));
      return reply.status(200).send(archived);
    }
  );

  // 7. List retained document versions (Up to 30 snapshots)
  app.get(
    '/api/v1/orgs/:orgSlug/docs/:docId/versions',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { docId } = request.params as { docId: string };

      const versions = await listDocVersions(db, {
        orgId: request.tenant!.orgId,
        docId,
        userId: request.user!.id,
        role: request.tenant!.role,
      });

      return reply.status(200).send({ versions });
    }
  );

  // 8. Get specific historical version snapshot
  app.get(
    '/api/v1/orgs/:orgSlug/docs/:docId/versions/:version',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { docId, version: versionStr } = request.params as { docId: string; version: string };
      const versionNum = parseInt(versionStr, 10);
      if (isNaN(versionNum) || versionNum < 1) {
        throw new ValidationError('Version must be a positive integer');
      }

      const snapshot = await getDocVersion(db, {
        orgId: request.tenant!.orgId,
        docId,
        version: versionNum,
        userId: request.user!.id,
        role: request.tenant!.role,
      });

      return reply.status(200).send(snapshot);
    }
  );

  // 9. Restore historical version snapshot into a NEW current version
  app.post(
    '/api/v1/orgs/:orgSlug/docs/:docId/restore',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { docId } = request.params as { docId: string };
      const parsed = RestoreDocSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid restore payload', parsed.error.format());
      }

      const currentDoc = await getDocById(db, {
        orgId: request.tenant!.orgId,
        docId,
        userId: request.user!.id,
        role: request.tenant!.role,
      });

      const ifMatchVersion = app.verifyIfMatch(request, currentDoc.version, currentDoc);

      const restored = await restoreDocVersion(db, {
        orgId: request.tenant!.orgId,
        docId,
        targetVersion: parsed.data.version,
        actorUserId: request.user!.id,
        role: request.tenant!.role,
        ifMatchVersion,
      });

      reply.header('ETag', formatETag(restored.version));
      return reply.status(200).send(restored);
    }
  );
};
