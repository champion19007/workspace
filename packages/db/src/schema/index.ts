import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// 1. Orgs (Tenant Root)
export const orgs = pgTable(
  'orgs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 64 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    plan: varchar('plan', { length: 32 }).notNull().default('starter'),
    retentionDays: integer('retention_days').notNull().default(180),
    aiBudgetInr: numeric('ai_budget_inr', { precision: 12, scale: 2 }).notNull().default('5000.00'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('chk_org_retention_days', sql`${table.retentionDays} >= 30 AND ${table.retentionDays} <= 365`),
  ]
);

// 2. Users (Global Identity)
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }),
    cognitoSub: varchar('cognito_sub', { length: 128 }),
    supabaseUid: varchar('supabase_uid', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_users_cognito_sub').on(table.cognitoSub),
    uniqueIndex('idx_users_supabase_uid').on(table.supabaseUid),
  ]
);

// 3. Memberships (Authorization Authority)
export const memberships = pgTable(
  'memberships',
  {
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 32 }).notNull().default('member'), // owner | admin | member | viewer
    sessionEpoch: integer('session_epoch').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId] }),
    uniqueIndex('idx_memberships_org_user').on(table.orgId, table.userId),
    index('idx_memberships_user_id').on(table.userId),
    check('chk_membership_role', sql`${table.role} IN ('owner', 'admin', 'member', 'viewer')`),
  ]
);

// 4. Nodes (Org Tree: Teams & Projects)
export const nodes = pgTable(
  'nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    kind: varchar('kind', { length: 32 }).notNull(), // team | project
    name: varchar('name', { length: 255 }).notNull(),
    path: varchar('path', { length: 1024 }).notNull(), // materialized ltree path
    visibility: varchar('visibility', { length: 32 }).notNull().default('public'), // public | private
    rollup: jsonb('rollup').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_nodes_org_id').on(table.orgId, table.id),
    index('idx_nodes_org_parent').on(table.orgId, table.parentId),
    index('idx_nodes_path').on(table.path),
    check('chk_node_kind', sql`${table.kind} IN ('team', 'project')`),
    check('chk_node_visibility', sql`${table.visibility} IN ('public', 'private')`),
    check('chk_node_no_self_parent', sql`${table.parentId} IS NULL OR ${table.parentId} != ${table.id}`),
  ]
);

// 5. Node Members (Explicit membership for private nodes)
export const nodeMembers = pgTable(
  'node_members',
  {
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.nodeId, table.userId] }),
    uniqueIndex('idx_node_members_org_node_user').on(table.orgId, table.nodeId, table.userId),
    index('idx_node_members_user_org').on(table.userId, table.orgId),
  ]
);

// 6. Tasks
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
    parentTaskId: uuid('parent_task_id'),
    key: varchar('key', { length: 32 }).notNull(), // e.g. ENG-142
    title: varchar('title', { length: 512 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 32 }).notNull().default('todo'), // todo | in_progress | done | blocked
    priority: varchar('priority', { length: 32 }).notNull().default('medium'), // low | medium | high | urgent
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    dueDate: date('due_date'), // date-only distinct from timestamptz
    rank: varchar('rank', { length: 64 }).notNull().default('0|hzzzzz:'), // base-62 fractional index string
    version: integer('version').notNull().default(1), // If-Match concurrency version
    source: varchar('source', { length: 32 }).notNull().default('manual'), // manual | zoom_meeting
    sourceRef: varchar('source_ref', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_tasks_org_id').on(table.orgId, table.id),
    uniqueIndex('idx_tasks_org_project_id').on(table.orgId, table.projectId, table.id),
    uniqueIndex('idx_tasks_org_key').on(table.orgId, table.key),
    index('idx_tasks_project_status_rank').on(table.projectId, table.status, table.rank),
    index('idx_tasks_org_assignee_status_due').on(table.orgId, table.assigneeId, table.status, table.dueDate),
    check('chk_task_status', sql`${table.status} IN ('todo', 'in_progress', 'done', 'blocked')`),
    check('chk_task_priority', sql`${table.priority} IN ('low', 'medium', 'high', 'urgent')`),
    check('chk_task_no_self_parent', sql`${table.parentTaskId} IS NULL OR ${table.parentTaskId} != ${table.id}`),
  ]
);

// 7. Labels
export const labels = pgTable(
  'labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 64 }).notNull(),
    color: varchar('color', { length: 16 }).notNull().default('#64748B'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_labels_org_name').on(table.orgId, table.name),
    uniqueIndex('idx_labels_org_id').on(table.orgId, table.id),
  ]
);

// 8. Task Labels
export const taskLabels = pgTable(
  'task_labels',
  {
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.taskId, table.labelId] }),
  ]
);

// 9. Project Key Counters (for atomic key allocation like ENG-142)
export const projectKeyCounters = pgTable(
  'project_key_counters',
  {
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
    prefix: varchar('prefix', { length: 16 }).notNull(), // e.g. ENG
    lastNumber: integer('last_number').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.prefix] }),
  ]
);

// 10. Meetings
export const meetings = pgTable(
  'meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').references(() => nodes.id, { onDelete: 'set null' }),
    provider: varchar('provider', { length: 32 }).notNull().default('zoom'),
    providerMeetingUuid: varchar('provider_meeting_uuid', { length: 128 }).notNull(),
    title: varchar('title', { length: 255 }),
    hostId: uuid('host_id').references(() => users.id, { onDelete: 'set null' }),
    scheduledStartAt: timestamp('scheduled_start_at', { withTimezone: true }),
    actualStartAt: timestamp('actual_start_at', { withTimezone: true }),
    status: varchar('status', { length: 32 }).notNull().default('ingesting'),
    guestsPresent: boolean('guests_present').notNull().default(false),
    consentSent: boolean('consent_sent').notNull().default(false),
    skipped: boolean('skipped').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_meetings_org_id').on(table.orgId, table.id),
    uniqueIndex('idx_meetings_org_provider_uuid').on(table.orgId, table.provider, table.providerMeetingUuid),
    index('idx_meetings_org_node').on(table.orgId, table.nodeId),
    check('chk_meeting_status', sql`${table.status} IN ('scheduled', 'ingesting', 'routing', 'extracting', 'completed', 'failed', 'skipped')`),
  ]
);

// 11. Transcript Segments (Evidence Anchors)
export const transcriptSegments = pgTable(
  'transcript_segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    meetingId: uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    speakerLabel: varchar('speaker_label', { length: 128 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_transcript_segments_meeting_seq').on(table.meetingId, table.seq),
    uniqueIndex('idx_transcript_segments_org_meeting_seq').on(table.orgId, table.meetingId, table.seq),
    check('chk_transcript_timestamps', sql`${table.startMs} >= 0 AND ${table.startMs} <= ${table.endMs}`),
  ]
);

// 12. Meeting Notes (AI Notes & Provenance)
export const meetingNotes = pgTable(
  'meeting_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    meetingId: uuid('meeting_id').notNull().unique().references(() => meetings.id, { onDelete: 'cascade' }),
    summaryMd: text('summary_md').notNull(),
    decisions: jsonb('decisions').notNull().default([]),
    openQuestions: jsonb('open_questions').notNull().default([]),
    evidence: jsonb('evidence').notNull().default([]),
    model: varchar('model', { length: 64 }).notNull(),
    promptVersion: varchar('prompt_version', { length: 32 }).notNull(),
    costInr: numeric('cost_inr', { precision: 10, scale: 4 }).notNull().default('0.0000'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_meeting_notes_org_meeting').on(table.orgId, table.meetingId),
  ]
);

// 13. Action Items (Approval Queue)
export const actionItems = pgTable(
  'action_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    meetingId: uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    suggestedOwnerId: uuid('suggested_owner_id').references(() => users.id, { onDelete: 'set null' }),
    suggestedDue: date('suggested_due'),
    evidence: jsonb('evidence').notNull(), // array of { seq, quote }
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    state: varchar('state', { length: 32 }).notNull().default('suggested'), // suggested | approved | edited | rejected
    proposalType: varchar('proposal_type', { length: 32 }).notNull().default('create_task'), // create_task | update_task
    targetTaskId: uuid('target_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_action_items_meeting').on(table.meetingId),
    index('idx_action_items_org_suggested_owner').on(table.orgId, table.suggestedOwnerId),
    check('chk_action_item_state', sql`${table.state} IN ('suggested', 'approved', 'edited', 'rejected')`),
    check('chk_action_item_proposal_type', sql`${table.proposalType} IN ('create_task', 'update_task')`),
  ]
);

// 14. Docs
export const docs = pgTable(
  'docs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    bodyMd: text('body_md').notNull().default(''),
    bodyJson: jsonb('body_json'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_docs_org_id').on(table.orgId, table.id),
    index('idx_docs_org_node').on(table.orgId, table.nodeId),
  ]
);

// 15. Doc Versions (Last 30 versions retained)
export const docVersions = pgTable(
  'doc_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    docId: uuid('doc_id').notNull().references(() => docs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    bodyMd: text('body_md').notNull(),
    bodyJson: jsonb('body_json'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_doc_versions_doc_version').on(table.docId, table.version),
    uniqueIndex('idx_doc_versions_org_doc_version').on(table.orgId, table.docId, table.version),
  ]
);

// 16. Comments (Polymorphic Discussions)
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    targetType: varchar('target_type', { length: 32 }).notNull(), // task | node | doc | meeting
    targetId: uuid('target_id').notNull(),
    parentId: uuid('parent_id'),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    bodyMd: text('body_md').notNull(),
    mentions: jsonb('mentions').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_comments_target').on(table.targetType, table.targetId, table.createdAt),
    index('idx_comments_org_author').on(table.orgId, table.authorId),
    check('chk_comments_target_type', sql`${table.targetType} IN ('task', 'node', 'doc', 'meeting')`),
    check('chk_comments_no_self_parent', sql`${table.parentId} IS NULL OR ${table.parentId} != ${table.id}`),
  ]
);

// 17. Notifications
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 32 }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    dedupeKey: varchar('dedupe_key', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_notifications_user_read').on(table.userId, table.readAt),
    uniqueIndex('idx_notifications_org_user_dedupe').on(table.orgId, table.userId, table.dedupeKey),
  ]
);

// 18. Chunks (Vector Chunks for Ask AI)
export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    sourceType: varchar('source_type', { length: 32 }).notNull(),
    sourceId: uuid('source_id').notNull(),
    version: integer('version').notNull().default(1),
    nodePath: varchar('node_path', { length: 1024 }).notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_chunks_org_node_path').on(table.orgId, table.nodePath),
    index('idx_chunks_source').on(table.sourceType, table.sourceId),
    check('chk_chunks_source_type', sql`${table.sourceType} IN ('task', 'meeting_notes', 'doc', 'transcript_segment')`),
  ]
);

// 19. Integrations (Zoom OAuth, etc.)
export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    accountId: varchar('account_id', { length: 128 }).notNull(),
    scopes: jsonb('scopes').notNull().default([]),
    secretArn: varchar('secret_arn', { length: 255 }).notNull(), // Secret reference only, never plaintext tokens
    status: varchar('status', { length: 32 }).notNull().default('connected'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_integrations_org_provider').on(table.orgId, table.provider),
  ]
);

// 20. Outbox (Transactional Outbox)
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    topic: varchar('topic', { length: 128 }).notNull(),
    payload: jsonb('payload').notNull(),
    deliveryAttempts: integer('delivery_attempts').notNull().default(0),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: varchar('locked_by', { length: 64 }),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_outbox_sent_at').on(table.sentAt, table.createdAt),
    index('idx_outbox_unprocessed').on(table.id, table.createdAt),
  ]
);

// 21. Activity Log
export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    verb: varchar('verb', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 32 }).notNull(),
    targetId: uuid('target_id').notNull(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_activity_log_org_created').on(table.orgId, table.createdAt),
  ]
);

// 22. Invitations (Supporting Table for Org Membership Onboarding)
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    role: varchar('role', { length: 32 }).notNull().default('member'),
    token: varchar('token', { length: 128 }).notNull().unique(),
    invitedBy: uuid('invited_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_invitations_org_email').on(table.orgId, table.email),
    check('chk_invitations_role', sql`${table.role} IN ('owner', 'admin', 'member', 'viewer')`),
  ]
);
