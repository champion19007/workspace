import type { FastifyPluginAsync } from 'fastify';
import {
  type DatabaseInstance,
  createTask,
  getTaskById,
  listTasks,
  updateTask,
  archiveTask,
  createSubtask,
  verifyProjectAccess,
  moveTask,
  getMyTasks,
  rebalanceColumnRanks,
} from '@workspace/db';
import {
  type AppPorts,
  CreateTaskSchema,
  UpdateTaskSchema,
  CreateSubtaskSchema,
  ListTasksQuerySchema,
  MoveTaskSchema,
  MyTasksQuerySchema,
  ValidationError,
  ForbiddenError,
  formatETag,
  type TaskStatus,
} from '@workspace/core';

export const taskRoutes: FastifyPluginAsync<{ db: DatabaseInstance; ports?: AppPorts }> = async (
  app,
  { db }
) => {
  // 1. List tasks in a project
  app.get(
    '/api/v1/orgs/:orgSlug/projects/:projectId/tasks',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const parsed = ListTasksQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError('Invalid tasks query parameters', parsed.error.format());
      }

      // Verify project exists and caller has access (zero leakage -> 404 for private projects)
      await verifyProjectAccess(db, {
        orgId: request.tenant!.orgId,
        projectId,
        userId: request.user!.id,
        role: request.tenant!.role,
      });

      const tasks = await listTasks(db, {
        orgId: request.tenant!.orgId,
        userId: request.user!.id,
        role: request.tenant!.role,
        projectId,
        status: parsed.data.status,
        priority: parsed.data.priority,
        assigneeId: parsed.data.assigneeId,
        parentTaskId: parsed.data.parentTaskId,
        includeArchived: parsed.data.includeArchived,
        limit: parsed.data.limit,
      });

      return reply.status(200).send({ tasks });
    }
  );

  // 2. List tasks across the organisation
  app.get(
    '/api/v1/orgs/:orgSlug/tasks',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const parsed = ListTasksQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError('Invalid tasks query parameters', parsed.error.format());
      }

      const tasks = await listTasks(db, {
        orgId: request.tenant!.orgId,
        userId: request.user!.id,
        role: request.tenant!.role,
        projectId: parsed.data.projectId,
        status: parsed.data.status,
        priority: parsed.data.priority,
        assigneeId: parsed.data.assigneeId,
        parentTaskId: parsed.data.parentTaskId,
        includeArchived: parsed.data.includeArchived,
        limit: parsed.data.limit,
      });

      return reply.status(200).send({ tasks });
    }
  );

  // 2b. List tasks assigned to the current user (My Tasks - Requirement W-5 / Screenshot 938)
  app.get(
    '/api/v1/orgs/:orgSlug/me/tasks',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const parsed = MyTasksQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError('Invalid my-tasks query parameters', parsed.error.format());
      }

      // Security: Assignee identity resolved strictly from authenticated user.
      // Callers cannot impersonate other users via userId query parameters.
      const result = await getMyTasks(db, {
        orgId: request.tenant!.orgId,
        userId: request.user!.id,
        role: request.tenant!.role,
        query: parsed.data,
      });

      return reply.status(200).send(result);
    }
  );

  // 3. Create a task under a project
  app.post(
    '/api/v1/orgs/:orgSlug/projects/:projectId/tasks',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = request.body as any;

      // Reject attempts to forge AI provenance from client
      if (body && (body.source === 'ai_suggested' || body.source === 'approved_ai' || body.sourceRef)) {
        throw new ValidationError('Client cannot set source or forge AI provenance');
      }

      const payload = {
        ...body,
        projectId,
      };

      const parsed = CreateTaskSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid task creation payload', parsed.error.format());
      }

      const task = await createTask(db, {
        orgId: request.tenant!.orgId,
        actorUserId: request.user!.id,
        role: request.tenant!.role,
        input: parsed.data,
      });

      reply.header('ETag', formatETag(task.version));
      return reply.status(201).send(task);
    }
  );

  // 4. Read single task
  app.get(
    '/api/v1/orgs/:orgSlug/tasks/:taskId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { taskId } = request.params as { taskId: string };
      const task = await getTaskById(db, {
        orgId: request.tenant!.orgId,
        taskId,
        userId: request.user!.id,
        role: request.tenant!.role,
      });

      reply.header('ETag', formatETag(task.version));
      return reply.status(200).send(task);
    }
  );

  // 5. Update task with strict strong If-Match OCC
  app.patch(
    '/api/v1/orgs/:orgSlug/tasks/:taskId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { taskId } = request.params as { taskId: string };
      const parsed = UpdateTaskSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid task update payload', parsed.error.format());
      }

      // Step 1: Read current task & verify permission FIRST (zero information leakage -> 404)
      const currentTask = await getTaskById(db, {
        orgId: request.tenant!.orgId,
        taskId,
        userId: request.user!.id,
        role: request.tenant!.role,
      });

      // Step 2: Strict If-Match validation against current canonical entity
      // Missing If-Match throws 428 Precondition Required
      // Weak validator (W/...) or version mismatch throws 412 Precondition Failed with currentEntity
      const ifMatchVersion = app.verifyIfMatch(request, currentTask.version, currentTask);

      // Step 3: Perform atomic database update or move
      let updated;
      if (parsed.data.prevTaskId !== undefined || parsed.data.nextTaskId !== undefined) {
        updated = await moveTask(db, {
          orgId: request.tenant!.orgId,
          taskId,
          actorUserId: request.user!.id,
          role: request.tenant!.role,
          ifMatchVersion,
          input: {
            status: parsed.data.status,
            prevTaskId: parsed.data.prevTaskId,
            nextTaskId: parsed.data.nextTaskId,
          },
        });
      } else {
        updated = await updateTask(db, {
          orgId: request.tenant!.orgId,
          taskId,
          actorUserId: request.user!.id,
          role: request.tenant!.role,
          ifMatchVersion,
          input: parsed.data,
        });
      }

      reply.header('ETag', formatETag(updated.version));
      return reply.status(200).send(updated);
    }
  );

  // 5b. Reorder / move task with strict strong If-Match OCC (Requirement W-5)
  app.patch(
    '/api/v1/orgs/:orgSlug/tasks/:taskId/move',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { taskId } = request.params as { taskId: string };
      const parsed = MoveTaskSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid task move payload', parsed.error.format());
      }

      // Step 1: Read current task & verify permission FIRST (zero leakage -> 404)
      const currentTask = await getTaskById(db, {
        orgId: request.tenant!.orgId,
        taskId,
        userId: request.user!.id,
        role: request.tenant!.role,
      });

      // Step 2: Strict If-Match validation against current canonical entity
      const ifMatchVersion = app.verifyIfMatch(request, currentTask.version, currentTask);

      // Step 3: Perform atomic 1-row move in tasks table
      const moved = await moveTask(db, {
        orgId: request.tenant!.orgId,
        taskId,
        actorUserId: request.user!.id,
        role: request.tenant!.role,
        ifMatchVersion,
        input: parsed.data,
      });

      reply.header('ETag', formatETag(moved.version));
      return reply.status(200).send(moved);
    }
  );

  // 6. Archive task
  app.delete(
    '/api/v1/orgs/:orgSlug/tasks/:taskId',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { taskId } = request.params as { taskId: string };
      const ifMatchHeader = request.headers['if-match'];
      let ifMatchVersion: number | undefined;

      if (ifMatchHeader) {
        const currentTask = await getTaskById(db, {
          orgId: request.tenant!.orgId,
          taskId,
          userId: request.user!.id,
          role: request.tenant!.role,
        });
        ifMatchVersion = app.verifyIfMatch(request, currentTask.version, currentTask);
      }

      const archived = await archiveTask(db, {
        orgId: request.tenant!.orgId,
        taskId,
        actorUserId: request.user!.id,
        role: request.tenant!.role,
        ifMatchVersion,
      });

      reply.header('ETag', formatETag(archived.version));
      return reply.status(200).send(archived);
    }
  );

  // 7. Create subtask
  app.post(
    '/api/v1/orgs/:orgSlug/tasks/:taskId/subtasks',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { taskId } = request.params as { taskId: string };
      const parsed = CreateSubtaskSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid subtask creation payload', parsed.error.format());
      }

      const subtask = await createSubtask(db, {
        orgId: request.tenant!.orgId,
        parentTaskId: taskId,
        actorUserId: request.user!.id,
        role: request.tenant!.role,
        input: parsed.data,
      });

      reply.header('ETag', formatETag(subtask.version));
      return reply.status(201).send(subtask);
    }
  );

  // 8. List subtasks of a parent task
  app.get(
    '/api/v1/orgs/:orgSlug/tasks/:taskId/subtasks',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { taskId } = request.params as { taskId: string };

      // Verify caller may read the parent task
      await getTaskById(db, {
        orgId: request.tenant!.orgId,
        taskId,
        userId: request.user!.id,
        role: request.tenant!.role,
      });

      const subtasks = await listTasks(db, {
        orgId: request.tenant!.orgId,
        userId: request.user!.id,
        role: request.tenant!.role,
        parentTaskId: taskId,
      });

      return reply.status(200).send({ subtasks });
    }
  );

  // 9. Rebalance column ranks (exceptional maintenance when rank length > 32)
  app.post(
    '/api/v1/orgs/:orgSlug/projects/:projectId/columns/:status/rebalance',
    {
      preHandler: [app.authenticate, app.requireOrgContext],
    },
    async (request, reply) => {
      const { projectId, status } = request.params as { projectId: string; status: string };
      if (!['todo', 'in_progress', 'done', 'blocked'].includes(status)) {
        throw new ValidationError('Invalid status column for rebalancing');
      }

      // Viewers cannot trigger rebalance maintenance
      if (request.tenant!.role === 'viewer') {
        throw new ForbiddenError('Viewers are not permitted to trigger rebalancing maintenance');
      }

      await verifyProjectAccess(db, {
        orgId: request.tenant!.orgId,
        projectId,
        userId: request.user!.id,
        role: request.tenant!.role,
      });

      const body = (request.body as any) || {};
      const parentTaskId = body.parentTaskId || null;

      const result = await rebalanceColumnRanks(db, {
        orgId: request.tenant!.orgId,
        projectId,
        status: status as TaskStatus,
        parentTaskId,
      });

      return reply.status(200).send(result);
    }
  );
};
