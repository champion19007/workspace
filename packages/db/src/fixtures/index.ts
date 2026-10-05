import type postgres from 'postgres';

export const FIXTURE_IDS = {
  orgs: {
    orgA: '01923456-789a-7000-8000-000000000001',
    orgB: '01923456-789a-7000-8000-000000000002',
  },
  users: {
    userAOwner: '01923456-789a-7000-8000-000000000011',
    userAAdmin: '01923456-789a-7000-8000-000000000012',
    userAMember: '01923456-789a-7000-8000-000000000013',
    userAViewer: '01923456-789a-7000-8000-000000000014',
    userBOwner: '01923456-789a-7000-8000-000000000021',
    userCross: '01923456-789a-7000-8000-000000000099',
  },
  nodes: {
    orgAPublic: '01923456-789a-7000-8000-000000000101',
    orgAPrivate: '01923456-789a-7000-8000-000000000102',
    orgBPublic: '01923456-789a-7000-8000-000000000201',
  },
  tasks: {
    taskAPublic: '01923456-789a-7000-8000-000000000301',
    taskAPrivate: '01923456-789a-7000-8000-000000000302',
    taskBPublic: '01923456-789a-7000-8000-000000000401',
  },
  docs: {
    docAPublic: '01923456-789a-7000-8000-000000000501',
    docAPrivate: '01923456-789a-7000-8000-000000000502',
    docBPublic: '01923456-789a-7000-8000-000000000601',
  },
  meetings: {
    meetingA: '01923456-789a-7000-8000-000000000701',
    meetingB: '01923456-789a-7000-8000-000000000801',
  },
  chunks: {
    chunkAPublic: '01923456-789a-7000-8000-000000000901',
    chunkAPrivate: '01923456-789a-7000-8000-000000000902',
    chunkBPublic: '01923456-789a-7000-8000-000000000903',
  },
} as const;

function makeMockVector(): string {
  const arr = new Array(1024).fill('0.0');
  arr[0] = '1.0';
  return `[${arr.join(',')}]`;
}

export async function cleanTestFixtures(sql: postgres.Sql): Promise<void> {
  const orgIds = [FIXTURE_IDS.orgs.orgA, FIXTURE_IDS.orgs.orgB];
  const userIds = Object.values(FIXTURE_IDS.users);

  // Clean tenant rows first
  await sql`DELETE FROM chunks WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM comments WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM doc_versions WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM docs WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM action_items WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM meeting_notes WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM transcript_segments WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM meetings WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM task_labels WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM labels WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM tasks WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM project_key_counters WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM node_members WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM nodes WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM memberships WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM invitations WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM integrations WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM outbox WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM activity_log WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM notifications WHERE org_id = ANY(${orgIds})`;
  await sql`DELETE FROM orgs WHERE id = ANY(${orgIds})`;
  await sql`DELETE FROM users WHERE id = ANY(${userIds})`;
}

export async function seedTestFixtures(sql: postgres.Sql): Promise<void> {
  await cleanTestFixtures(sql);

  // 1. Insert Users (global table)
  await sql`
    INSERT INTO users (id, email, name) VALUES
      (${FIXTURE_IDS.users.userAOwner}, 'owner@acme.corp', 'Acme Owner'),
      (${FIXTURE_IDS.users.userAAdmin}, 'admin@acme.corp', 'Acme Admin'),
      (${FIXTURE_IDS.users.userAMember}, 'member@acme.corp', 'Acme Member'),
      (${FIXTURE_IDS.users.userAViewer}, 'viewer@acme.corp', 'Acme Viewer'),
      (${FIXTURE_IDS.users.userBOwner}, 'owner@stark.corp', 'Tony Stark'),
      (${FIXTURE_IDS.users.userCross}, 'cross@consultant.corp', 'Cross Consultant');
  `;

  // 2. Insert Orgs
  await sql`
    INSERT INTO orgs (id, slug, name, plan, retention_days, ai_budget_inr) VALUES
      (${FIXTURE_IDS.orgs.orgA}, 'acme-corp', 'Acme Corporation', 'business', 180, 50000.00),
      (${FIXTURE_IDS.orgs.orgB}, 'stark-corp', 'Stark Industries', 'enterprise', 365, 200000.00);
  `;

  // 3. Insert Memberships
  await sql`
    INSERT INTO memberships (org_id, user_id, role) VALUES
      (${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.users.userAOwner}, 'owner'),
      (${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.users.userAAdmin}, 'admin'),
      (${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.users.userAMember}, 'member'),
      (${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.users.userAViewer}, 'viewer'),
      (${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.users.userCross}, 'member'),
      (${FIXTURE_IDS.orgs.orgB}, ${FIXTURE_IDS.users.userBOwner}, 'owner'),
      (${FIXTURE_IDS.orgs.orgB}, ${FIXTURE_IDS.users.userCross}, 'member');
  `;

  // 4. Insert Nodes
  await sql`
    INSERT INTO nodes (id, org_id, name, kind, visibility, path) VALUES
      (${FIXTURE_IDS.nodes.orgAPublic}, ${FIXTURE_IDS.orgs.orgA}, 'Frontend Team', 'project', 'public', 'acme.frontend'::ltree),
      (${FIXTURE_IDS.nodes.orgAPrivate}, ${FIXTURE_IDS.orgs.orgA}, 'Project Stealth', 'project', 'private', 'acme.stealth'::ltree),
      (${FIXTURE_IDS.nodes.orgBPublic}, ${FIXTURE_IDS.orgs.orgB}, 'Mark 85 Armor', 'project', 'public', 'stark.armor'::ltree);
  `;

  // 5. Insert Node Members (Private node access for User Cross; User Member has NO entry)
  await sql`
    INSERT INTO node_members (org_id, node_id, user_id) VALUES
      (${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.nodes.orgAPrivate}, ${FIXTURE_IDS.users.userCross});
  `;

  // 6. Insert Tasks
  await sql`
    INSERT INTO tasks (id, org_id, project_id, key, title, status, priority) VALUES
      (${FIXTURE_IDS.tasks.taskAPublic}, ${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.nodes.orgAPublic}, 'ACM-1', 'Build Landing Page', 'in_progress', 'high'),
      (${FIXTURE_IDS.tasks.taskAPrivate}, ${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.nodes.orgAPrivate}, 'STL-1', 'Top Secret Stealth Feature', 'todo', 'urgent'),
      (${FIXTURE_IDS.tasks.taskBPublic}, ${FIXTURE_IDS.orgs.orgB}, ${FIXTURE_IDS.nodes.orgBPublic}, 'STK-1', 'Nanotech Fusion Core', 'todo', 'high');
  `;

  // 7. Insert Docs
  await sql`
    INSERT INTO docs (id, org_id, node_id, title, version) VALUES
      (${FIXTURE_IDS.docs.docAPublic}, ${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.nodes.orgAPublic}, 'Frontend Guidelines', 1),
      (${FIXTURE_IDS.docs.docAPrivate}, ${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.nodes.orgAPrivate}, 'Stealth Spec', 1),
      (${FIXTURE_IDS.docs.docBPublic}, ${FIXTURE_IDS.orgs.orgB}, ${FIXTURE_IDS.nodes.orgBPublic}, 'Armor Specs', 1);
  `;

  // 7b. Insert Doc Versions
  await sql`
    INSERT INTO doc_versions (org_id, doc_id, version, title, body_md, created_by) VALUES
      (${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.docs.docAPublic}, 1, 'Frontend Guidelines', '# Guidelines\nStandard rules.', ${FIXTURE_IDS.users.userAOwner}),
      (${FIXTURE_IDS.orgs.orgA}, ${FIXTURE_IDS.docs.docAPrivate}, 1, 'Stealth Spec', '# Stealth\nConfidential.', ${FIXTURE_IDS.users.userAAdmin}),
      (${FIXTURE_IDS.orgs.orgB}, ${FIXTURE_IDS.docs.docBPublic}, 1, 'Armor Specs', '# Armor\nMark 85 power levels.', ${FIXTURE_IDS.users.userBOwner});
  `;

  // 8. Insert Meetings
  await sql`
    INSERT INTO meetings (id, org_id, provider, provider_meeting_uuid, host_id, status) VALUES
      (${FIXTURE_IDS.meetings.meetingA}, ${FIXTURE_IDS.orgs.orgA}, 'zoom', 'zoom-acme-meet-123', ${FIXTURE_IDS.users.userAOwner}, 'completed'),
      (${FIXTURE_IDS.meetings.meetingB}, ${FIXTURE_IDS.orgs.orgB}, 'zoom', 'zoom-stark-meet-456', ${FIXTURE_IDS.users.userBOwner}, 'completed');
  `;

  // 9. Insert Chunks with 1024-dimension vectors
  const vec = makeMockVector();
  await sql`
    INSERT INTO chunks (id, org_id, source_type, source_id, version, node_path, content, embedding) VALUES
      (${FIXTURE_IDS.chunks.chunkAPublic}, ${FIXTURE_IDS.orgs.orgA}, 'doc', ${FIXTURE_IDS.docs.docAPublic}, 1, 'acme.frontend'::ltree, 'Public engineering standards and best practices', ${vec}::vector),
      (${FIXTURE_IDS.chunks.chunkAPrivate}, ${FIXTURE_IDS.orgs.orgA}, 'doc', ${FIXTURE_IDS.docs.docAPrivate}, 1, 'acme.stealth'::ltree, 'Confidential stealth roadmap details', ${vec}::vector),
      (${FIXTURE_IDS.chunks.chunkBPublic}, ${FIXTURE_IDS.orgs.orgB}, 'doc', ${FIXTURE_IDS.docs.docBPublic}, 1, 'stark.armor'::ltree, 'Arc reactor power distribution', ${vec}::vector);
  `;
}
