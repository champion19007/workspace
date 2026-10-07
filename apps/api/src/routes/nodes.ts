import type { FastifyPluginAsync } from 'fastify';
import {
  type DatabaseInstance,
  createNode,
  getNodeById,
  getTree,
  listProjects,
  updateNode,
  moveSubtree,
  deleteOrArchiveNode,
  listNodeMembers,
  addNodeMember,
  removeNodeMember,
} from '@workspace/db';
import {
  type AppPorts,
  CreateNodeSchema,
  UpdateNodeSchema,
  TreeQuerySchema,
  ProjectsQuerySchema,
  AddNodeMemberSchema,
  ValidationError,
  formatETag,
  parseETag,
} from '@workspace/core';

export const nodeRoutes: FastifyPluginAsync<{ db: DatabaseInstance; ports?: AppPorts }> = async (
  app,
  { db }
) => {
  // 1. Get organization node tree with bounded depth loading
  app.get(
    '/api/v1/orgs/:orgSlug/tree',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const parsed = TreeQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError('Invalid tree query parameters', parsed.error.format());
      }

      const { depth, root, includeArchived } = parsed.data;
      const nodes = await getTree(db, {
        orgId: request.tenant!.orgId,
        userId: request.user!.id,
        role: request.tenant!.role,
        rootNodeId: root,
        depth,
        includeArchived,
      });

      return reply.status(200).send({ nodes });
    }
  );

  // 2. List projects with optional team scoping and search
  app.get(
    '/api/v1/orgs/:orgSlug/projects',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const parsed = ProjectsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError('Invalid projects query parameters', parsed.error.format());
      }

      const { teamId, search, limit, cursor } = parsed.data;
      const result = await listProjects(db, {
        orgId: request.tenant!.orgId,
        userId: request.user!.id,
        role: request.tenant!.role,
        teamId,
        search,
        limit,
        cursor,
      });

      return reply.status(200).send(result);
    }
  );

  // 3. Create a team or project node
  app.post(
    '/api/v1/orgs/:orgSlug/nodes',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const parsed = CreateNodeSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid node creation payload', parsed.error.format());
      }

      const node = await createNode(db, {
        orgId: request.tenant!.orgId,
        userId: request.user!.id,
        role: request.tenant!.role,
        name: parsed.data.name,
        kind: parsed.data.kind,
        parentId: parsed.data.parentId,
        visibility: parsed.data.visibility,
        description: parsed.data.description,
      });

      reply.header('ETag', formatETag(node.version));
      return reply.status(201).send(node);
    }
  );

  // 4. Get a single node by ID
  app.get(
    '/api/v1/orgs/:orgSlug/nodes/:nodeId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string };
      const node = await getNodeById(db, {
        orgId: request.tenant!.orgId,
        nodeId,
        userId: request.user!.id,
        role: request.tenant!.role,
        includeArchived: true,
      });

      reply.header('ETag', formatETag(node.version));
      return reply.status(200).send(node);
    }
  );

  // 5. Update node (rename, description, visibility, move) with OCC check
  app.patch(
    '/api/v1/orgs/:orgSlug/nodes/:nodeId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string };
      const parsed = UpdateNodeSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid node update payload', parsed.error.format());
      }

      let currentNode = await getNodeById(db, {
        orgId: request.tenant!.orgId,
        nodeId,
        userId: request.user!.id,
        role: request.tenant!.role,
      });

      const ifMatchHeader = request.headers['if-match'];
      if (ifMatchHeader !== undefined) {
        app.verifyIfMatch(request, currentNode.version, currentNode);
      }

      // If moving beneath a new parent (or moving to root)
      if (parsed.data.parentId !== undefined && parsed.data.parentId !== currentNode.parentId) {
        const moveResult = await moveSubtree(db, {
          orgId: request.tenant!.orgId,
          nodeId,
          newParentId: parsed.data.parentId,
          actorUserId: request.user!.id,
          role: request.tenant!.role,
          ifMatchVersion: currentNode.version,
        });
        currentNode = moveResult.movedRoot;
      }

      // If updating attributes (name, description, visibility)
      if (
        parsed.data.name !== undefined ||
        parsed.data.description !== undefined ||
        parsed.data.visibility !== undefined
      ) {
        currentNode = await updateNode(db, {
          orgId: request.tenant!.orgId,
          nodeId,
          actorUserId: request.user!.id,
          role: request.tenant!.role,
          ifMatchVersion: currentNode.version,
          name: parsed.data.name,
          description: parsed.data.description,
          visibility: parsed.data.visibility,
        });
      }

      reply.header('ETag', formatETag(currentNode.version));
      return reply.status(200).send(currentNode);
    }
  );

  // 6. Delete or archive node
  app.delete(
    '/api/v1/orgs/:orgSlug/nodes/:nodeId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string };
      const query = request.query as { archive?: string | boolean };
      const archive = query.archive === 'true' || query.archive === true;

      const ifMatchHeader = request.headers['if-match'];
      const ifMatchVersion = typeof ifMatchHeader === 'string' ? parseETag(ifMatchHeader) ?? undefined : undefined;

      const result = await deleteOrArchiveNode(db, {
        orgId: request.tenant!.orgId,
        nodeId,
        actorUserId: request.user!.id,
        role: request.tenant!.role,
        archive,
        ifMatchVersion,
      });

      return reply.status(200).send(result);
    }
  );

  // 7. Node members: List members of private project
  app.get(
    '/api/v1/orgs/:orgSlug/nodes/:nodeId/members',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string };
      const members = await listNodeMembers(db, {
        orgId: request.tenant!.orgId,
        nodeId,
        actorUserId: request.user!.id,
        role: request.tenant!.role,
      });

      return reply.status(200).send({ members });
    }
  );

  // 8. Node members: Add member to private project
  app.post(
    '/api/v1/orgs/:orgSlug/nodes/:nodeId/members',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string };
      const parsed = AddNodeMemberSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid member payload', parsed.error.format());
      }

      await addNodeMember(db, {
        orgId: request.tenant!.orgId,
        nodeId,
        actorUserId: request.user!.id,
        role: request.tenant!.role,
        targetUserId: parsed.data.userId,
      });

      return reply.status(201).send({ success: true, userId: parsed.data.userId });
    }
  );

  // 9. Node members: Remove member from private project
  app.delete(
    '/api/v1/orgs/:orgSlug/nodes/:nodeId/members/:userId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { nodeId, userId } = request.params as { nodeId: string; userId: string };
      const result = await removeNodeMember(db, {
        orgId: request.tenant!.orgId,
        nodeId,
        actorUserId: request.user!.id,
        role: request.tenant!.role,
        targetUserId: userId,
      });

      return reply.status(200).send(result);
    }
  );
};
