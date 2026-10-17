import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import {
  createApiClient,
  withTenantContext,
  seedTestFixtures,
  cleanTestFixtures,
  FIXTURE_IDS,
  tasks,
  nodes,
  docs,
  meetings,
  chunks,
  orgs,
} from '../index.js';

const ADMIN_DB_URL =
  process.env['DATABASE_DIRECT_URL'] ??
  'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev?sslmode=disable';

// The API login role (Stage 17b): no table privileges of its own; tenant work runs under SET LOCAL ROLE workspace_app.
const APP_DB_URL =
  process.env['DATABASE_API_URL'] ??
  'postgresql://workspace_api:workspace_api_dev_password@localhost:5432/workspace_dev?sslmode=disable';

describe('Database Foundation & Tenant Isolation Suite', () => {
  let adminSql: postgres.Sql;
  let appClient: ReturnType<typeof createApiClient>;

  beforeAll(async () => {
    adminSql = postgres(ADMIN_DB_URL, { max: 1 });
    // Seed database with deterministic multi-tenant fixtures
    await seedTestFixtures(adminSql);

    // Initialize application client connected as the restricted non-superuser login role `workspace_api`
    appClient = createApiClient({
      connectionString: APP_DB_URL,
      maxConnections: 5,
    });
  });

  afterAll(async () => {
    if (adminSql) {
      await cleanTestFixtures(adminSql);
      await adminSql.end({ timeout: 5 });
    }
    if (appClient) {
      await appClient.sql.end({ timeout: 5 });
    }
  });

  // ============================================================================
  // 1. Cross-Organization Isolation
  // ============================================================================
  describe('Cross-Organization Tenant Isolation', () => {
    it('isolates task queries between organizations', async () => {
      // Query as Org A
      const orgATasks = await withTenantContext(
        appClient.db,
        { orgId: FIXTURE_IDS.orgs.orgA, userId: FIXTURE_IDS.users.userAOwner, role: 'owner' },
        async (tx) => {
          return tx.select().from(tasks);
        }
      );

      // Org A should only see its own tasks
      expect(orgATasks.length).toBeGreaterThan(0);
      expect(orgATasks.every((t) => t.orgId === FIXTURE_IDS.orgs.orgA)).toBe(true);
      expect(orgATasks.some((t) => t.id === FIXTURE_IDS.tasks.taskAPublic)).toBe(true);
      expect(orgATasks.some((t) => t.id === FIXTURE_IDS.tasks.taskBPublic)).toBe(false);

      // Query as Org B
      const orgBTasks = await withTenantContext(
        appClient.db,
        { orgId: FIXTURE_IDS.orgs.orgB, userId: FIXTURE_IDS.users.userBOwner, role: 'owner' },
        async (tx) => {
          return tx.select().from(tasks);
        }
      );

      // Org B should only see its own tasks
      expect(orgBTasks.length).toBe(1);
      expect(orgBTasks[0]?.id).toBe(FIXTURE_IDS.tasks.taskBPublic);
      expect(orgBTasks[0]?.orgId).toBe(FIXTURE_IDS.orgs.orgB);
      expect(orgBTasks.some((t) => t.id === FIXTURE_IDS.tasks.taskAPublic)).toBe(false);
    });

    it('returns zero rows when querying other organization resources by ID (fail-closed)', async () => {
      // Org A queries Org B task directly by primary key
      const result = await withTenantContext(
        appClient.db,
        { orgId: FIXTURE_IDS.orgs.orgA, userId: FIXTURE_IDS.users.userAOwner, role: 'owner' },
        async (tx) => {
          return tx.select().from(tasks).where(eq(tasks.id, FIXTURE_IDS.tasks.taskBPublic));
        }
      );
      expect(result).toHaveLength(0);

      // Org A queries Org B doc directly
      const docResult = await withTenantContext(
        appClient.db,
        { orgId: FIXTURE_IDS.orgs.orgA, userId: FIXTURE_IDS.users.userAOwner, role: 'owner' },
        async (tx) => {
          return tx.select().from(docs).where(eq(docs.id, FIXTURE_IDS.docs.docBPublic));
        }
      );
      expect(docResult).toHaveLength(0);

      // Org A queries Org B meeting directly
      const meetingResult = await withTenantContext(
        appClient.db,
        { orgId: FIXTURE_IDS.orgs.orgA, userId: FIXTURE_IDS.users.userAOwner, role: 'owner' },
        async (tx) => {
          return tx.select().from(meetings).where(eq(meetings.id, FIXTURE_IDS.meetings.meetingB));
        }
      );
      expect(meetingResult).toHaveLength(0);

      // Org A queries Org B chunk directly
      const chunkResult = await withTenantContext(
        appClient.db,
        { orgId: FIXTURE_IDS.orgs.orgA, userId: FIXTURE_IDS.users.userAOwner, role: 'owner' },
        async (tx) => {
          return tx.select().from(chunks).where(eq(chunks.id, FIXTURE_IDS.chunks.chunkBPublic));
        }
      );
      expect(chunkResult).toHaveLength(0);
    });
  });

  // ============================================================================
  // 2. Fail-Closed on Missing Tenant Context
  // ============================================================================
  describe('Fail-Closed Enforcement Without Tenant Context', () => {
    it('denies tenant tables outright when no tenant context is set', async () => {
      // The login role holds no table privileges: without withTenantContext nothing is readable at all
      await expect(appClient.db.select().from(tasks)).rejects.toThrow(/permission denied/);
      await expect(appClient.db.select().from(docs)).rejects.toThrow(/permission denied/);
      await expect(appClient.db.select().from(nodes)).rejects.toThrow(/permission denied/);
      await expect(appClient.db.select().from(orgs)).rejects.toThrow(/permission denied/);
    });

    it('returns zero rows under the tenant role when no org_id is set', async () => {
      const directTasks = await appClient.sql.begin(async (txn) => {
        await txn`SELECT set_config('role', 'workspace_app', true)`;
        return txn`SELECT id FROM tasks`;
      });
      expect(directTasks).toHaveLength(0);
    });

    it('rejects INSERT operations when no org_id session context is set', async () => {
      await expect(
        appClient.db.insert(tasks).values({
          id: '01923456-789a-7000-8000-000000000399',
          orgId: FIXTURE_IDS.orgs.orgA,
          projectId: FIXTURE_IDS.nodes.orgAPublic,
          key: 'ACM-999',
          title: 'Unauthorized Task',
        })
      ).rejects.toThrow();
    });
  });

  // ============================================================================
  // 3. Cross-Organization Mutation & Write Protection
  // ============================================================================
  describe('Cross-Organization Mutation Protection', () => {
    it('prevents modifying rows of another organization (UPDATE affects 0 rows)', async () => {
      const updatedRows = await withTenantContext(
        appClient.db,
        { orgId: FIXTURE_IDS.orgs.orgA, userId: FIXTURE_IDS.users.userAOwner, role: 'owner' },
        async (tx) => {
          return tx
            .update(tasks)
            .set({ title: 'Hacked Title' })
            .where(eq(tasks.id, FIXTURE_IDS.tasks.taskBPublic))
            .returning();
        }
      );
      expect(updatedRows).toHaveLength(0);

      // Verify Org B task title remains unchanged
      const [starkTask] = await adminSql`SELECT title FROM tasks WHERE id = ${FIXTURE_IDS.tasks.taskBPublic}`;
      expect(starkTask?.title).toBe('Nanotech Fusion Core');
    });

    it('prevents deleting rows of another organization (DELETE affects 0 rows)', async () => {
      const deletedRows = await withTenantContext(
        appClient.db,
        { orgId: FIXTURE_IDS.orgs.orgA, userId: FIXTURE_IDS.users.userAOwner, role: 'owner' },
        async (tx) => {
          return tx.delete(tasks).where(eq(tasks.id, FIXTURE_IDS.tasks.taskBPublic)).returning();
        }
      );
      expect(deletedRows).toHaveLength(0);

      // Verify Org B task still exists
      const [starkTask] = await adminSql`SELECT id FROM tasks WHERE id = ${FIXTURE_IDS.tasks.taskBPublic}`;
      expect(starkTask?.id).toBe(FIXTURE_IDS.tasks.taskBPublic);
    });

    it('rejects inserting rows for another organization with RLS check violation', async () => {
      await expect(
        withTenantContext(
          appClient.db,
          { orgId: FIXTURE_IDS.orgs.orgA, userId: FIXTURE_IDS.users.userAOwner, role: 'owner' },
          async (tx) => {
            return tx.insert(tasks).values({
              id: '01923456-789a-7000-8000-000000000398',
              orgId: FIXTURE_IDS.orgs.orgB, // Attempt to write to Org B while authenticated in Org A
              projectId: FIXTURE_IDS.nodes.orgBPublic,
              key: 'STK-999',
              title: 'Cross Tenant Injection',
            });
          }
        )
      ).rejects.toThrow(/violates row-level security policy/i);
    });
  });

  // ============================================================================
  // 4. Compound Foreign Keys Prevent Cross-Org Data Relationships
  // ============================================================================
  describe('Compound Foreign Key Cross-Org Invariants', () => {
    it('prevents creating a task in Org A referencing a project in Org B', async () => {
      // Trying to attach Org A task to Org B project violates fk_tasks_project_node
      await expect(
        adminSql`
          INSERT INTO tasks (id, org_id, project_id, key, title)
          VALUES ('01923456-789a-7000-8000-000000000397', ${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.nodes.orgBPublic}, 'ACM-99', 'Cross Project Task');
        `
      ).rejects.toThrow(/tasks_org_id_project_id_fkey|fk_tasks_project_node/i);
    });

    it('prevents adding a user to a node in Org A if the user is not a member of Org A', async () => {
      // User B Owner has membership in Org B, NOT Org A.
      // Trying to add User B Owner to Org A's node violates fk_node_members_membership: (org_id, user_id) REFERENCES memberships(org_id, user_id)
      await expect(
        adminSql`
          INSERT INTO node_members (org_id, node_id, user_id)
          VALUES (${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.nodes.orgAPublic}, ${FIXTURE_IDS.users.userBOwner});
        `
      ).rejects.toThrow(/node_members_org_id_user_id_fkey|fk_node_members_membership/i);
    });

    it('prevents creating a doc version in Org A referencing a doc in Org B', async () => {
      await expect(
        adminSql`
          INSERT INTO doc_versions (org_id, doc_id, version, title, body_md, created_by)
          VALUES (${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.docs.docBPublic}, 2, 'Injected', 'Injected Version', ${FIXTURE_IDS.users.userAOwner});
        `
      ).rejects.toThrow(/doc_versions_org_id_doc_id_fkey|fk_doc_versions_doc/i);
    });
  });

  // ============================================================================
  // 5. Immutability of org_id on UPDATE
  // ============================================================================
  describe('Audit Trigger: org_id Immutability', () => {
    it('rejects changing org_id on tasks via trigger', async () => {
      await expect(
        adminSql`
          UPDATE tasks
          SET org_id = ${FIXTURE_IDS.orgs.orgB}
          WHERE id = ${FIXTURE_IDS.tasks.taskAPublic};
        `
      ).rejects.toThrow(/Modifying org_id is strictly prohibited/i);
    });

    it('rejects changing org_id on nodes via trigger', async () => {
      await expect(
        adminSql`
          UPDATE nodes
          SET org_id = ${FIXTURE_IDS.orgs.orgB}
          WHERE id = ${FIXTURE_IDS.nodes.orgAPublic};
        `
      ).rejects.toThrow(/Modifying org_id is strictly prohibited/i);
    });

    it('rejects changing org_id on docs via trigger', async () => {
      await expect(
        adminSql`
          UPDATE docs
          SET org_id = ${FIXTURE_IDS.orgs.orgB}
          WHERE id = ${FIXTURE_IDS.docs.docAPublic};
        `
      ).rejects.toThrow(/Modifying org_id is strictly prohibited/i);
    });

    it('rejects changing org_id on meetings via trigger', async () => {
      await expect(
        adminSql`
          UPDATE meetings
          SET org_id = ${FIXTURE_IDS.orgs.orgB}
          WHERE id = ${FIXTURE_IDS.meetings.meetingA};
        `
      ).rejects.toThrow(/Modifying org_id is strictly prohibited/i);
    });
  });

  // ============================================================================
  // 6. Private Project & Node Visibility Control
  // ============================================================================
  describe('Private Project Access Control Enforcement', () => {
    it('hides private nodes, tasks, docs, and chunks from ordinary org members without explicit node membership', async () => {
      // User A Member belongs to Org A, but is NOT a node_member of Project Stealth
      await withTenantContext(
        appClient.db,
        {
          orgId: FIXTURE_IDS.orgs.orgA,
          userId: FIXTURE_IDS.users.userAMember,
          role: 'member',
        },
        async (tx) => {
          // 1. Can see public node and public task
          const publicNodes = await tx.select().from(nodes).where(eq(nodes.id, FIXTURE_IDS.nodes.orgAPublic));
          expect(publicNodes).toHaveLength(1);

          const publicTasks = await tx.select().from(tasks).where(eq(tasks.id, FIXTURE_IDS.tasks.taskAPublic));
          expect(publicTasks).toHaveLength(1);

          // 2. CANNOT see private node
          const privateNodes = await tx.select().from(nodes).where(eq(nodes.id, FIXTURE_IDS.nodes.orgAPrivate));
          expect(privateNodes).toHaveLength(0);

          // 3. CANNOT see tasks under private project
          const privateTasks = await tx.select().from(tasks).where(eq(tasks.id, FIXTURE_IDS.tasks.taskAPrivate));
          expect(privateTasks).toHaveLength(0);

          // 4. CANNOT see docs under private node
          const privateDocs = await tx.select().from(docs).where(eq(docs.id, FIXTURE_IDS.docs.docAPrivate));
          expect(privateDocs).toHaveLength(0);

          // 5. CANNOT see chunks under private node path
          const privateChunks = await tx.select().from(chunks).where(eq(chunks.id, FIXTURE_IDS.chunks.chunkAPrivate));
          expect(privateChunks).toHaveLength(0);
        }
      );
    });

    it('allows members explicitly added to node_members to view private node and its resources', async () => {
      // User Cross belongs to Org A as a member AND was added to node_members for Project Stealth
      await withTenantContext(
        appClient.db,
        {
          orgId: FIXTURE_IDS.orgs.orgA,
          userId: FIXTURE_IDS.users.userCross,
          role: 'member',
        },
        async (tx) => {
          // Can see private node
          const privateNodes = await tx.select().from(nodes).where(eq(nodes.id, FIXTURE_IDS.nodes.orgAPrivate));
          expect(privateNodes).toHaveLength(1);

          // Can see private task
          const privateTasks = await tx.select().from(tasks).where(eq(tasks.id, FIXTURE_IDS.tasks.taskAPrivate));
          expect(privateTasks).toHaveLength(1);
          expect(privateTasks[0]?.key).toBe('STL-1');

          // Can see private doc
          const privateDocs = await tx.select().from(docs).where(eq(docs.id, FIXTURE_IDS.docs.docAPrivate));
          expect(privateDocs).toHaveLength(1);

          // Can see private chunk
          const privateChunks = await tx.select().from(chunks).where(eq(chunks.id, FIXTURE_IDS.chunks.chunkAPrivate));
          expect(privateChunks).toHaveLength(1);
        }
      );
    });

    it('allows organization Owners and Admins to view private nodes without explicit node_members entry', async () => {
      // User A Admin is not in node_members, but has org-level admin role
      await withTenantContext(
        appClient.db,
        {
          orgId: FIXTURE_IDS.orgs.orgA,
          userId: FIXTURE_IDS.users.userAAdmin,
          role: 'admin',
        },
        async (tx) => {
          const privateNodes = await tx.select().from(nodes).where(eq(nodes.id, FIXTURE_IDS.nodes.orgAPrivate));
          expect(privateNodes).toHaveLength(1);

          const privateTasks = await tx.select().from(tasks).where(eq(tasks.id, FIXTURE_IDS.tasks.taskAPrivate));
          expect(privateTasks).toHaveLength(1);
        }
      );

      // User A Owner also has access
      await withTenantContext(
        appClient.db,
        {
          orgId: FIXTURE_IDS.orgs.orgA,
          userId: FIXTURE_IDS.users.userAOwner,
          role: 'owner',
        },
        async (tx) => {
          const privateNodes = await tx.select().from(nodes).where(eq(nodes.id, FIXTURE_IDS.nodes.orgAPrivate));
          expect(privateNodes).toHaveLength(1);
        }
      );
    });
  });

  // ============================================================================
  // 7. Connection Pool Hygiene & No Context Leakage
  // ============================================================================
  describe('Connection Pool Hygiene', () => {
    it('guarantees that tenant context resets completely across pooled connection executions', async () => {
      // 1. Run operation with Org A context
      await withTenantContext(
        appClient.db,
        { orgId: FIXTURE_IDS.orgs.orgA, userId: FIXTURE_IDS.users.userAOwner, role: 'owner' },
        async (tx) => {
          const t = await tx.select().from(tasks);
          expect(t.length).toBeGreaterThan(0);
        }
      );

      // 2. Immediately execute raw query without withTenantContext on the same pool
      const [setting] = await appClient.sql`SELECT current_setting('app.org_id', true) as org_id`;
      expect(setting?.org_id).toBe('');

      // 3. Querying tasks outside of context is denied (the connection is back on the login role)
      const [role] = await appClient.sql`SELECT current_user`;
      expect(role?.current_user).toBe('workspace_api');
      await expect(appClient.db.select().from(tasks)).rejects.toThrow(/permission denied/);
    });
  });

  // ============================================================================
  // 8. Subtask Hierarchy Invariants
  // ============================================================================
  describe('Subtask Hierarchy Invariants', () => {
    it('rejects self-parenting tasks via check constraint', async () => {
      const taskId = '01923456-789a-7000-8000-000000000395';
      await expect(
        adminSql`
          INSERT INTO tasks (id, org_id, project_id, parent_task_id, key, title)
          VALUES (${taskId}, ${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.nodes.orgAPublic}, ${taskId}, 'ACM-88', 'Self Parenting Task');
        `
      ).rejects.toThrow(/chk_task_no_self_parent/i);
    });

    it('rejects subtasks belonging to a different project than their parent task', async () => {
      // Parent task is in Public Project (orgAPublic). Attempt to create subtask in Private Project (orgAPrivate) referencing Public parent.
      const subtaskId = '01923456-789a-7000-8000-000000000394';
      await expect(
        adminSql`
          INSERT INTO tasks (id, org_id, project_id, parent_task_id, key, title)
          VALUES (
            ${subtaskId},
            ${FIXTURE_IDS.orgs.orgA},
            ${FIXTURE_IDS.nodes.orgAPrivate},
            ${FIXTURE_IDS.tasks.taskAPublic},
            'ACM-87',
            'Cross Project Subtask'
          );
        `
      ).rejects.toThrow(/tasks_org_id_project_id_parent_task_id_fkey|Subtask must belong to the same project/i);
    });

    it('enforces maximum 1 level of subtasks (rejects subtask of a subtask)', async () => {
      const level1SubtaskId = '01923456-789a-7000-8000-000000000393';
      const level2SubtaskId = '01923456-789a-7000-8000-000000000392';

      // 1. Create valid Level 1 subtask
      await adminSql`
        INSERT INTO tasks (id, org_id, project_id, parent_task_id, key, title)
        VALUES (
          ${level1SubtaskId},
          ${FIXTURE_IDS.orgs.orgA},
          ${FIXTURE_IDS.nodes.orgAPublic},
          ${FIXTURE_IDS.tasks.taskAPublic},
          'ACM-1-1',
          'Level 1 Subtask'
        );
      `;

      // 2. Attempt to create Level 2 subtask (grandchild)
      await expect(
        adminSql`
          INSERT INTO tasks (id, org_id, project_id, parent_task_id, key, title)
          VALUES (
            ${level2SubtaskId},
            ${FIXTURE_IDS.orgs.orgA},
            ${FIXTURE_IDS.nodes.orgAPublic},
            ${level1SubtaskId},
            'ACM-1-1-1',
            'Level 2 Subtask'
          );
        `
      ).rejects.toThrow(/One level of subtasks enforced/i);

      // Clean up level 1 subtask
      await adminSql`DELETE FROM tasks WHERE id = ${level1SubtaskId}`;
    });
  });

  // ============================================================================
  // 9. Natural Key Uniqueness & Constraints
  // ============================================================================
  describe('Natural Key Uniqueness & Domain Constraints', () => {
    it('rejects duplicate organization slugs', async () => {
      await expect(
        adminSql`
          INSERT INTO orgs (id, slug, name)
          VALUES ('01923456-789a-7000-8000-000000000091', 'acme-corp', 'Duplicate Acme');
        `
      ).rejects.toThrow(/orgs_slug_unique|duplicate key/i);
    });

    it('rejects duplicate user emails (case-insensitive citext)', async () => {
      await expect(
        adminSql`
          INSERT INTO users (id, email, name)
          VALUES ('01923456-789a-7000-8000-000000000092', 'OWNER@ACME.CORP', 'Duplicate Owner');
        `
      ).rejects.toThrow(/users_email_unique|duplicate key/i);
    });

    it('rejects duplicate task key within the same organization', async () => {
      await expect(
        adminSql`
          INSERT INTO tasks (id, org_id, project_id, key, title)
          VALUES ('01923456-789a-7000-8000-000000000391', ${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.nodes.orgAPublic}, 'ACM-1', 'Duplicate Key Task');
        `
      ).rejects.toThrow(/tasks_org_id_key_idx|duplicate key/i);
    });

    it('rejects duplicate meeting UUID for the same organization and provider', async () => {
      await expect(
        adminSql`
          INSERT INTO meetings (id, org_id, provider, provider_meeting_uuid)
          VALUES ('01923456-789a-7000-8000-000000000791', ${FIXTURE_IDS.orgs.orgA}, 'zoom', 'zoom-acme-meet-123');
        `
      ).rejects.toThrow(/meetings_org_provider_uuid_idx|duplicate key/i);
    });

    it('rejects duplicate membership pair for the same organization and user', async () => {
      await expect(
        adminSql`
          INSERT INTO memberships (org_id, user_id, role)
          VALUES (${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.users.userAOwner}, 'viewer');
        `
      ).rejects.toThrow(/memberships_org_id_user_id_unique|duplicate key/i);
    });
  });
});
