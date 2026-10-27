import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  numeric,
  boolean,
  timestamp,
  date,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  check,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1024)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    if (!value) return [];
    if (typeof value === 'string') {
      return value.replace(/^\[|\]$/g, '').split(',').map(Number);
    }
    return value;
  },
});

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
    role: varchar('role', { length: 32 }).notNull().default('member'), // owner | admin | member | viewer | client
    sessionEpoch: integer('session_epoch').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId] }),
    uniqueIndex('idx_memberships_org_user').on(table.orgId, table.userId),
    index('idx_memberships_user_id').on(table.userId),
    check('chk_membership_role', sql`${table.role} IN ('owner', 'admin', 'member', 'viewer', 'client')`),
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
    description: text('description'),
    path: varchar('path', { length: 1024 }).notNull(), // materialized ltree path
    visibility: varchar('visibility', { length: 32 }).notNull().default('public'), // public | private
    rollup: jsonb('rollup').notNull().default({}),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    keyPrefix: varchar('key_prefix', { length: 16 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_nodes_org_id').on(table.orgId, table.id),
    uniqueIndex('uq_nodes_org_key_prefix')
      .on(table.orgId, table.keyPrefix)
      .where(sql`${table.kind} = 'project' AND ${table.keyPrefix} IS NOT NULL`),
    index('idx_nodes_org_parent').on(table.orgId, table.parentId),
    index('idx_nodes_path').on(table.path),
    index('idx_nodes_org_archived').on(table.orgId, table.archivedAt),
    index('idx_nodes_org_kind').on(table.orgId, table.kind),
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
    rank: varchar('rank', { length: 128 }).notNull().default('a0'), // base-62 fractional index string (C collation)
    version: integer('version').notNull().default(1), // If-Match concurrency version
    source: varchar('source', { length: 32 }).notNull().default('manual'), // manual | zoom_meeting
    sourceRef: varchar('source_ref', { length: 1024 }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_tasks_org_id').on(table.orgId, table.id),
    uniqueIndex('idx_tasks_org_project_id').on(table.orgId, table.projectId, table.id),
    uniqueIndex('idx_tasks_org_key').on(table.orgId, table.key),
    index('idx_tasks_project_status_rank').on(table.projectId, table.status, table.rank),
    index('idx_tasks_org_assignee_status_due').on(table.orgId, table.assigneeId, table.status, table.dueDate),
    index('idx_tasks_org_archived').on(table.orgId, table.archivedAt),
    index('idx_tasks_project_archived').on(table.projectId, table.archivedAt),
    index('idx_tasks_parent').on(table.parentTaskId),
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
    providerNumericId: varchar('provider_numeric_id', { length: 64 }),
    title: varchar('title', { length: 255 }),
    hostId: uuid('host_id').references(() => users.id, { onDelete: 'set null' }),
    zoomHostId: varchar('zoom_host_id', { length: 64 }),
    zoomHostEmail: varchar('zoom_host_email', { length: 255 }),
    scheduledStartAt: timestamp('scheduled_start_at', { withTimezone: true }),
    actualStartAt: timestamp('actual_start_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    timezone: varchar('timezone', { length: 64 }),
    recordingCompletedAt: timestamp('recording_completed_at', { withTimezone: true }),
    transcriptCompletedAt: timestamp('transcript_completed_at', { withTimezone: true }),
    hasTranscript: boolean('has_transcript').notNull().default(false),
    hasRecording: boolean('has_recording').notNull().default(true),
    status: varchar('status', { length: 32 }).notNull().default('waiting_for_transcript'),
    guestsPresent: boolean('guests_present').notNull().default(false),
    consentSent: boolean('consent_sent').notNull().default(false),
    skipped: boolean('skipped').notNull().default(false),
    intakeError: text('intake_error'),
    connectionGeneration: integer('connection_generation').notNull().default(1),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    retryCount: integer('retry_count').notNull().default(0),
    version: integer('version').notNull().default(1),
    processingGeneration: integer('processing_generation').notNull().default(1),
    guestConsentStatus: varchar('guest_consent_status', { length: 32 }).notNull().default('unknown'),
    rawTranscriptObjectKey: text('raw_transcript_object_key'),
    rawTranscriptChecksum: varchar('raw_transcript_checksum', { length: 64 }),
    rawTranscriptByteCount: integer('raw_transcript_byte_count'),
    transcriptRetentionDeadline: timestamp('transcript_retention_deadline', { withTimezone: true }),
    sourceManifest: jsonb('source_manifest'),
    cleanupStatus: varchar('cleanup_status', { length: 32 }).notNull().default('none'),
    cleanedUpAt: timestamp('cleaned_up_at', { withTimezone: true }),
    suggestedNodeId: uuid('suggested_node_id').references(() => nodes.id, { onDelete: 'set null' }),
    routingConfidence: numeric('routing_confidence', { precision: 4, scale: 3 }),
    routingReason: text('routing_reason'),
    routingAlternatives: jsonb('routing_alternatives').default([]),
    routingActorId: uuid('routing_actor_id').references(() => users.id, { onDelete: 'set null' }),
    routingDecidedAt: timestamp('routing_decided_at', { withTimezone: true }),
    speakersResolved: boolean('speakers_resolved').notNull().default(false),
    speakerResolutionMetadata: jsonb('speaker_resolution_metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_meetings_org_id').on(table.orgId, table.id),
    uniqueIndex('idx_meetings_org_provider_uuid').on(table.orgId, table.provider, table.providerMeetingUuid),
    index('idx_meetings_org_node').on(table.orgId, table.nodeId),
    index('idx_meetings_org_status').on(table.orgId, table.status),
    index('idx_meetings_org_zoom_host').on(table.orgId, table.zoomHostId),
    index('idx_meetings_org_created_at').on(table.orgId, table.createdAt),
    index('idx_meetings_org_suggested_node').on(table.orgId, table.suggestedNodeId),
    check('chk_meeting_status', sql`${table.status} IN ('scheduled', 'waiting_for_transcript', 'pending_consent', 'ready_for_transcript_retrieval', 'ingesting', 'transcript_ready', 'routing', 'awaiting_project_choice', 'routed', 'extracting', 'completed', 'failed', 'intake_failed', 'connection_requires_reconnection', 'skipped')`),
    check('chk_meeting_guest_consent_status', sql`${table.guestConsentStatus} IN ('absent', 'consented', 'unknown', 'pending')`),
    check('chk_meeting_cleanup_status', sql`${table.cleanupStatus} IN ('none', 'pending', 'completed')`),
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
    checksum: varchar('checksum', { length: 64 }),
    sourceCueId: varchar('source_cue_id', { length: 64 }),
    resolutionMethod: varchar('resolution_method', { length: 32 }),
    resolutionConfidence: numeric('resolution_confidence', { precision: 4, scale: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_transcript_segments_meeting_seq').on(table.meetingId, table.seq),
    uniqueIndex('idx_transcript_segments_org_meeting_seq').on(table.orgId, table.meetingId, table.seq),
    index('idx_transcript_segments_meeting_speaker').on(table.meetingId, table.speakerLabel),
    index('idx_transcript_segments_meeting_user').on(table.meetingId, table.userId),
    check('chk_transcript_timestamps', sql`${table.startMs} >= 0 AND ${table.startMs} <= ${table.endMs}`),
    check('chk_transcript_resolution_method', sql`${table.resolutionMethod} IS NULL OR ${table.resolutionMethod} IN ('email_verified', 'fuzzy_llm', 'manual', 'unresolved')`),
  ]
);

// 11b. Extraction Runs (Stage 15: Durable Pipeline Tracking & Window Progress)
export const extractionRuns = pgTable(
  'extraction_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    meetingId: uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
    runKey: varchar('run_key', { length: 255 }).notNull(),
    processingGeneration: integer('processing_generation').notNull(),
    transcriptChecksum: varchar('transcript_checksum', { length: 64 }).notNull(),
    promptVersion: varchar('prompt_version', { length: 32 }).notNull(),
    model: varchar('model', { length: 64 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    totalWindows: integer('total_windows').notNull().default(1),
    completedWindows: integer('completed_windows').notNull().default(0),
    windowProgress: jsonb('window_progress').notNull().default([]),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costInr: numeric('cost_inr', { precision: 12, scale: 6 }).notNull().default('0.000000'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_extraction_runs_org_meeting_run_key').on(table.orgId, table.meetingId, table.runKey),
    index('idx_extraction_runs_meeting').on(table.orgId, table.meetingId),
    index('idx_extraction_runs_status').on(table.orgId, table.status),
    check('chk_extraction_run_status', sql`${table.status} IN ('pending', 'running', 'completed', 'failed', 'aborted')`),
  ]
);

// 11c. AI Usage Ledger (Stage 15: Auditable Provider Usage & Cost Accounting)
export const aiUsageLedger = pgTable(
  'ai_usage_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    meetingId: uuid('meeting_id').references(() => meetings.id, { onDelete: 'cascade' }),
    extractionRunId: uuid('extraction_run_id').references(() => extractionRuns.id, { onDelete: 'cascade' }),
    operation: varchar('operation', { length: 64 }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    model: varchar('model', { length: 64 }).notNull(),
    promptId: varchar('prompt_id', { length: 64 }).notNull(),
    promptVersion: varchar('prompt_version', { length: 32 }).notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costInr: numeric('cost_inr', { precision: 12, scale: 6 }).notNull().default('0.000000'),
    estimated: boolean('estimated').notNull().default(false),
    durationMs: integer('duration_ms').notNull().default(0),
    status: varchar('status', { length: 32 }).notNull().default('succeeded'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ai_usage_ledger_org_created').on(table.orgId, table.createdAt),
    index('idx_ai_usage_ledger_meeting').on(table.orgId, table.meetingId),
    index('idx_ai_usage_ledger_run').on(table.extractionRunId),
    check('chk_ai_usage_status', sql`${table.status} IN ('succeeded', 'failed', 'refused')`),
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
    extractionRunId: uuid('extraction_run_id').references(() => extractionRuns.id, { onDelete: 'cascade' }),
    docId: uuid('doc_id').references(() => docs.id, { onDelete: 'set null' }),
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
    ownerName: varchar('owner_name', { length: 255 }),
    duePhrase: varchar('due_phrase', { length: 255 }),
    suggestedOwnerId: uuid('suggested_owner_id').references(() => users.id, { onDelete: 'set null' }),
    suggestedDue: date('suggested_due'),
    evidence: jsonb('evidence').notNull(), // array of { seq, quote }
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    state: varchar('state', { length: 32 }).notNull().default('suggested'), // suggested | approved | edited | rejected
    proposalType: varchar('proposal_type', { length: 32 }).notNull().default('create_task'), // create_task | update_task
    targetTaskId: uuid('target_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    targetTaskVersion: integer('target_task_version'),
    targetTaskHash: varchar('target_task_hash', { length: 64 }),
    similarityScore: numeric('similarity_score', { precision: 5, scale: 4 }),
    rankedAlternatives: jsonb('ranked_alternatives').notNull().default([]),
    embeddingSpace: varchar('embedding_space', { length: 64 }),
    dedupStatus: varchar('dedup_status', { length: 32 }).notNull().default('pending'), // pending | matched | no_match | incomplete | skipped
    dedupedAt: timestamp('deduped_at', { withTimezone: true }),
    ownerResolutionMethod: varchar('owner_resolution_method', { length: 64 }),
    ownerResolutionConfidence: numeric('owner_resolution_confidence', { precision: 4, scale: 3 }),
    ownerResolutionEvidence: text('owner_resolution_evidence'),
    dueResolutionExplanation: text('due_resolution_explanation'),
    dueResolutionStatus: varchar('due_resolution_status', { length: 32 }),
    validationStatus: varchar('validation_status', { length: 32 }).notNull().default('valid'), // valid | invalid_evidence | unvalidated
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    extractionRunId: uuid('extraction_run_id').references(() => extractionRuns.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    decisionReason: varchar('decision_reason', { length: 32 }), // wrong | duplicate | not_a_task | other
    decisionNote: text('decision_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_action_items_org_id').on(table.orgId, table.id),
    index('idx_action_items_org_state_created').on(table.orgId, table.state, table.createdAt, table.id),
    index('idx_action_items_inbox_open')
      .on(table.orgId, table.suggestedOwnerId, table.createdAt, table.id)
      .where(sql`${table.state} = 'suggested'`),
    index('idx_action_items_meeting').on(table.meetingId),
    index('idx_action_items_meeting_state').on(table.meetingId, table.state),
    index('idx_action_items_org_suggested_owner').on(table.orgId, table.suggestedOwnerId),
    index('idx_action_items_dedup_status').on(table.meetingId, table.dedupStatus),
    index('idx_action_items_validation_status').on(table.meetingId, table.validationStatus),
    check('chk_action_item_state', sql`${table.state} IN ('suggested', 'approved', 'edited', 'rejected')`),
    check('chk_action_item_proposal_type', sql`${table.proposalType} IN ('create_task', 'update_task')`),
    check(
      'chk_action_item_decision_reason',
      sql`${table.decisionReason} IS NULL OR ${table.decisionReason} IN ('wrong', 'duplicate', 'not_a_task', 'other')`
    ),
  ]
);

// 13a. Action Item Decisions (append-only human decision log for eval curation, Stage 17)
export const actionItemDecisions = pgTable(
  'action_item_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    actionItemId: uuid('action_item_id').notNull(),
    meetingId: uuid('meeting_id').notNull(),
    decision: varchar('decision', { length: 16 }).notNull(), // approve | edit | reject
    reason: varchar('reason', { length: 32 }),
    note: text('note'),
    proposalSnapshot: jsonb('proposal_snapshot').notNull(),
    appliedValues: jsonb('applied_values'),
    editSummary: jsonb('edit_summary').notNull().default({}),
    titleEditDistance: numeric('title_edit_distance', { precision: 5, scale: 4 }),
    timeToDecisionMs: bigint('time_to_decision_ms', { mode: 'number' }).notNull(),
    taskId: uuid('task_id'),
    taskOperation: varchar('task_operation', { length: 16 }), // created | updated
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_action_item_decisions_item').on(table.orgId, table.actionItemId),
    index('idx_action_item_decisions_org_decided').on(table.orgId, table.decidedAt),
    index('idx_action_item_decisions_meeting').on(table.orgId, table.meetingId),
    check('chk_action_item_decisions_decision', sql`${table.decision} IN ('approve', 'edit', 'reject')`),
    check(
      'chk_action_item_decisions_reason',
      sql`${table.reason} IS NULL OR ${table.reason} IN ('wrong', 'duplicate', 'not_a_task', 'other')`
    ),
    check(
      'chk_action_item_decisions_task_operation',
      sql`${table.taskOperation} IS NULL OR ${table.taskOperation} IN ('created', 'updated')`
    ),
  ]
);

// 13b. Task Embeddings (Deduplication & Semantic Search)
export const taskEmbeddings = pgTable(
  'task_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    embeddingSpace: varchar('embedding_space', { length: 64 }).notNull(),
    policyVersion: varchar('policy_version', { length: 32 }).notNull().default('v1.0.0'),
    embedding: vector('embedding').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_task_embeddings_org').on(table.orgId),
    index('idx_task_embeddings_task').on(table.taskId),
    index('idx_task_embeddings_hash').on(table.contentHash),
    uniqueIndex('uq_task_embeddings_task_space').on(table.taskId, table.embeddingSpace, table.policyVersion),
  ]
);

// 14. Docs
export const docs = pgTable(
  'docs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 500 }).notNull(),
    bodyMd: text('body_md').notNull().default(''),
    bodyJson: jsonb('body_json'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    sourceMeetingId: uuid('source_meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_docs_org_id').on(table.orgId, table.id),
    index('idx_docs_org_node').on(table.orgId, table.nodeId),
    index('idx_docs_source_meeting').on(table.orgId, table.sourceMeetingId),
    index('idx_docs_org_archived').on(table.orgId, table.archivedAt),
    index('idx_docs_node_archived').on(table.nodeId, table.archivedAt),
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
    connectionGeneration: integer('connection_generation').notNull().default(1),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    installedBy: uuid('installed_by').references(() => users.id, { onDelete: 'set null' }),
    accountName: varchar('account_name', { length: 255 }),
    accountEmail: varchar('account_email', { length: 255 }),
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
    lastErrorCategory: varchar('last_error_category', { length: 64 }),
    lastErrorMessage: text('last_error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_integrations_org_provider').on(table.orgId, table.provider),
    uniqueIndex('uq_integrations_active_provider_account')
      .on(table.provider, table.accountId)
      .where(sql`${table.status} != 'disconnected'`),
  ]
);

// 19b. Zoom OAuth States (Temporary single-use PKCE/state binding)
export const zoomOauthStates = pgTable(
  'zoom_oauth_states',
  {
    state: varchar('state', { length: 128 }).primaryKey(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    sessionId: varchar('session_id', { length: 128 }).notNull(),
    codeVerifier: varchar('code_verifier', { length: 128 }).notNull(),
    redirectUri: text('redirect_uri').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_zoom_oauth_states_org').on(table.orgId),
    index('idx_zoom_oauth_states_expires').on(table.expiresAt),
  ]
);

// 19c. Zoom Host Consents (Explicit host-level opt-in & admin processing control)
export const zoomHostConsents = pgTable(
  'zoom_host_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    integrationId: uuid('integration_id').notNull().references(() => integrations.id, { onDelete: 'cascade' }),
    zoomUserId: varchar('zoom_user_id', { length: 128 }).notNull(),
    zoomEmail: varchar('zoom_email', { length: 255 }).notNull(),
    zoomName: varchar('zoom_name', { length: 255 }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    consentStatus: varchar('consent_status', { length: 32 }).notNull().default('unknown'),
    consentTimestamp: timestamp('consent_timestamp', { withTimezone: true }),
    policyVersion: varchar('policy_version', { length: 32 }).notNull().default('1.0'),
    adminDisabled: boolean('admin_disabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_zoom_host_consents_org_user').on(table.orgId, table.zoomUserId),
    index('idx_zoom_host_consents_org_email').on(table.orgId, table.zoomEmail),
    index('idx_zoom_host_consents_org_user').on(table.orgId, table.userId),
    index('idx_zoom_host_consents_integration').on(table.integrationId),
    check('chk_zoom_host_consent_status', sql`${table.consentStatus} IN ('opted_in', 'opted_out', 'unknown')`),
  ]
);

// 19d. Zoom Webhook Events (Deduplicated intake receipts)
export const zoomWebhookEvents = pgTable(
  'zoom_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').references(() => orgs.id, { onDelete: 'cascade' }),
    accountId: varchar('account_id', { length: 64 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    eventId: varchar('event_id', { length: 128 }).notNull(),
    providerMeetingUuid: varchar('provider_meeting_uuid', { length: 128 }),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_zoom_webhook_events').on(table.accountId, table.eventType, table.eventId),
    index('idx_zoom_webhook_events_org').on(table.orgId),
    index('idx_zoom_webhook_events_account_type').on(table.accountId, table.eventType),
  ]
);

// 19e. Zoom Poll Checkpoints (Thirty-minute fallback poller coordinator)
export const zoomPollCheckpoints = pgTable(
  'zoom_poll_checkpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    accountId: varchar('account_id', { length: 64 }).notNull(),
    lastScannedAt: timestamp('last_scanned_at', { withTimezone: true }).notNull().defaultNow(),
    cursor: varchar('cursor', { length: 255 }),
    leaseOwner: varchar('lease_owner', { length: 128 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    errorCount: integer('error_count').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_zoom_poll_checkpoints').on(table.orgId, table.accountId),
    index('idx_zoom_poll_checkpoints_account').on(table.accountId),
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
    check('chk_invitations_role', sql`${table.role} IN ('owner', 'admin', 'member', 'viewer', 'client')`),
  ]
);

// 23. Idempotency Keys (PostgreSQL-backed for Architecture A)
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 128 }).notNull(),
    operation: varchar('operation', { length: 64 }).notNull(),
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('pending'), // pending | completed | failed
    statusCode: integer('status_code'),
    headers: jsonb('headers').notNull().default({}),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_idempotency_org_actor_key').on(table.orgId, table.actorId, table.key),
    index('idx_idempotency_expires_at').on(table.expiresAt),
    index('idx_idempotency_org_actor').on(table.orgId, table.actorId),
    check('chk_idempotency_status', sql`${table.status} IN ('pending', 'completed', 'failed')`),
  ]
);

// 24. Node Rollup Dirty (Debounced Health Rollups & Generational Watermarking)
export const nodeRollupDirty = pgTable(
  'node_rollup_dirty',
  {
    nodeId: uuid('node_id').primaryKey().references(() => nodes.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    dirtyGeneration: integer('dirty_generation').notNull().default(1),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    debounceUntil: timestamp('debounce_until', { withTimezone: true }).notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: varchar('locked_by', { length: 64 }),
  },
  (table) => [
    index('idx_node_rollup_dirty_debounce').on(table.debounceUntil).where(sql`${table.lockedAt} IS NULL`),
    index('idx_node_rollup_dirty_org').on(table.orgId),
  ]
);
