-- Workspace v1 Database Foundation & Migrations (Stage 2)
-- PostgreSQL 16 System of Record with Strict Tenant Isolation, ltree, citext, and pgvector

-- ==============================================================================
-- 1. Required PostgreSQL Extensions
-- ==============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "ltree";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ==============================================================================
-- 2. PostgreSQL UUIDv7 Generation Function
-- ==============================================================================
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
AS $$
DECLARE
  v_time timestamp with time zone := clock_timestamp();
  v_epoch_ms bigint;
  v_bytes bytea;
BEGIN
  v_epoch_ms := (extract(epoch from v_time) * 1000)::bigint;
  v_bytes := gen_random_bytes(16);
  
  -- Set 48-bit timestamp
  v_bytes := set_byte(v_bytes, 0, ((v_epoch_ms >> 40) & 255)::integer);
  v_bytes := set_byte(v_bytes, 1, ((v_epoch_ms >> 32) & 255)::integer);
  v_bytes := set_byte(v_bytes, 2, ((v_epoch_ms >> 24) & 255)::integer);
  v_bytes := set_byte(v_bytes, 3, ((v_epoch_ms >> 16) & 255)::integer);
  v_bytes := set_byte(v_bytes, 4, ((v_epoch_ms >> 8) & 255)::integer);
  v_bytes := set_byte(v_bytes, 5, (v_epoch_ms & 255)::integer);
  
  -- Version 7: 0111
  v_bytes := set_byte(v_bytes, 6, ((get_byte(v_bytes, 6) & 15) | 112)::integer);
  -- Variant 1: 10xxxxxx
  v_bytes := set_byte(v_bytes, 8, ((get_byte(v_bytes, 8) & 63) | 128)::integer);
  
  RETURN encode(v_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ==============================================================================
-- 3. Core Database Tables
-- ==============================================================================

-- 3.1 Orgs (Tenant Root)
CREATE TABLE IF NOT EXISTS orgs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug varchar(64) NOT NULL UNIQUE,
  name varchar(255) NOT NULL,
  plan varchar(32) NOT NULL DEFAULT 'starter',
  retention_days integer NOT NULL DEFAULT 180,
  ai_budget_inr numeric(12, 2) NOT NULL DEFAULT 5000.00,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_org_retention_days CHECK (retention_days >= 30 AND retention_days <= 365)
);

-- 3.2 Users (Global Identity)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  email citext NOT NULL UNIQUE,
  name varchar(255),
  cognito_sub varchar(128) UNIQUE,
  supabase_uid varchar(128) UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3.3 Memberships (Authority for Authorization)
CREATE TABLE IF NOT EXISTS memberships (
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(32) NOT NULL DEFAULT 'member',
  session_epoch integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id),
  CONSTRAINT chk_membership_role CHECK (role IN ('owner', 'admin', 'member', 'viewer'))
);
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id);

-- 3.4 Nodes (Hierarchical Tree: Teams & Projects)
CREATE TABLE IF NOT EXISTS nodes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  parent_id uuid,
  kind varchar(32) NOT NULL,
  name varchar(255) NOT NULL,
  path ltree NOT NULL,
  visibility varchar(32) NOT NULL DEFAULT 'public',
  rollup jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_nodes_org_id UNIQUE (org_id, id),
  CONSTRAINT chk_node_kind CHECK (kind IN ('team', 'project')),
  CONSTRAINT chk_node_visibility CHECK (visibility IN ('public', 'private')),
  CONSTRAINT chk_node_no_self_parent CHECK (parent_id IS NULL OR parent_id != id),
  FOREIGN KEY (org_id, parent_id) REFERENCES nodes(org_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_nodes_org_parent ON nodes(org_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_path_gist ON nodes USING gist(path);

-- 3.5 Node Members (Private Node Access Control)
CREATE TABLE IF NOT EXISTS node_members (
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  node_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, user_id),
  CONSTRAINT uq_node_members_org_node_user UNIQUE (org_id, node_id, user_id),
  FOREIGN KEY (org_id, node_id) REFERENCES nodes(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, user_id) REFERENCES memberships(org_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_node_members_user_org ON node_members(user_id, org_id);

-- 3.6 Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  parent_task_id uuid,
  key varchar(32) NOT NULL,
  title varchar(512) NOT NULL,
  description text,
  status varchar(32) NOT NULL DEFAULT 'todo',
  priority varchar(32) NOT NULL DEFAULT 'medium',
  assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  due_date date, -- date-only distinct from timestamptz
  rank varchar(64) NOT NULL DEFAULT '0|hzzzzz:',
  version integer NOT NULL DEFAULT 1,
  source varchar(32) NOT NULL DEFAULT 'manual',
  source_ref varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tasks_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_tasks_org_project_id UNIQUE (org_id, project_id, id),
  CONSTRAINT uq_tasks_org_key UNIQUE (org_id, key),
  CONSTRAINT chk_task_status CHECK (status IN ('todo', 'in_progress', 'done', 'blocked')),
  CONSTRAINT chk_task_priority CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  CONSTRAINT chk_task_no_self_parent CHECK (parent_task_id IS NULL OR parent_task_id != id),
  FOREIGN KEY (org_id, project_id) REFERENCES nodes(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, parent_task_id) REFERENCES tasks(org_id, project_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status_rank ON tasks(project_id, status, rank);
CREATE INDEX IF NOT EXISTS idx_tasks_org_assignee_status_due ON tasks(org_id, assignee_id, status, due_date);

-- Subtask level enforcement trigger: ensures only 1 level of subtasks is permitted
CREATE OR REPLACE FUNCTION check_subtask_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_parent_id uuid;
  v_has_children boolean;
BEGIN
  IF NEW.parent_task_id IS NOT NULL THEN
    -- Check if parent task itself is a subtask
    SELECT parent_task_id INTO v_parent_parent_id FROM tasks WHERE id = NEW.parent_task_id;
    IF v_parent_parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'One level of subtasks enforced: task % is already a subtask', NEW.parent_task_id;
    END IF;

    -- Check if this task already has subtasks (cannot turn a parent into a child)
    IF TG_OP = 'UPDATE' THEN
      SELECT EXISTS(SELECT 1 FROM tasks WHERE parent_task_id = NEW.id) INTO v_has_children;
      IF v_has_children THEN
        RAISE EXCEPTION 'Cannot convert a parent task with subtasks into a subtask';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_check_subtask_hierarchy
BEFORE INSERT OR UPDATE OF parent_task_id ON tasks
FOR EACH ROW EXECUTE FUNCTION check_subtask_hierarchy();

-- 3.7 Labels & Task Labels
CREATE TABLE IF NOT EXISTS labels (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name varchar(64) NOT NULL,
  color varchar(16) NOT NULL DEFAULT '#64748B',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_labels_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_labels_org_name UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS task_labels (
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  task_id uuid NOT NULL,
  label_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, task_id, label_id),
  FOREIGN KEY (org_id, task_id) REFERENCES tasks(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, label_id) REFERENCES labels(org_id, id) ON DELETE CASCADE
);

-- 3.8 Project Key Counters (Atomic sequential task key generation, e.g. ENG-142)
CREATE TABLE IF NOT EXISTS project_key_counters (
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  prefix varchar(16) NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, prefix),
  FOREIGN KEY (org_id, project_id) REFERENCES nodes(org_id, id) ON DELETE CASCADE
);

-- 3.9 Meetings
CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  node_id uuid,
  provider varchar(32) NOT NULL DEFAULT 'zoom',
  provider_meeting_uuid varchar(128) NOT NULL,
  title varchar(255),
  host_id uuid REFERENCES users(id) ON DELETE SET NULL,
  scheduled_start_at timestamptz,
  actual_start_at timestamptz,
  status varchar(32) NOT NULL DEFAULT 'ingesting',
  guests_present boolean NOT NULL DEFAULT false,
  consent_sent boolean NOT NULL DEFAULT false,
  skipped boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_meetings_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_meetings_org_provider_uuid UNIQUE (org_id, provider, provider_meeting_uuid),
  CONSTRAINT chk_meeting_status CHECK (status IN ('scheduled', 'ingesting', 'routing', 'extracting', 'completed', 'failed', 'skipped')),
  FOREIGN KEY (org_id, node_id) REFERENCES nodes(org_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_meetings_org_node ON meetings(org_id, node_id);

-- 3.10 Transcript Segments (Evidence Anchors)
CREATE TABLE IF NOT EXISTS transcript_segments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL,
  seq integer NOT NULL,
  speaker_label varchar(128) NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_transcript_segments_meeting_seq UNIQUE (meeting_id, seq),
  CONSTRAINT uq_transcript_segments_org_meeting_seq UNIQUE (org_id, meeting_id, seq),
  CONSTRAINT chk_transcript_timestamps CHECK (start_ms >= 0 AND start_ms <= end_ms),
  FOREIGN KEY (org_id, meeting_id) REFERENCES meetings(org_id, id) ON DELETE CASCADE
);

-- 3.11 Meeting Notes
CREATE TABLE IF NOT EXISTS meeting_notes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL UNIQUE,
  summary_md text NOT NULL,
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  model varchar(64) NOT NULL,
  prompt_version varchar(32) NOT NULL,
  cost_inr numeric(10, 4) NOT NULL DEFAULT 0.0000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_meeting_notes_org_meeting UNIQUE (org_id, meeting_id),
  FOREIGN KEY (org_id, meeting_id) REFERENCES meetings(org_id, id) ON DELETE CASCADE
);

-- 3.12 Action Items (Approval Queue)
CREATE TABLE IF NOT EXISTS action_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL,
  text text NOT NULL,
  suggested_owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  suggested_due date,
  evidence jsonb NOT NULL,
  confidence numeric(4, 3) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'suggested',
  proposal_type varchar(32) NOT NULL DEFAULT 'create_task',
  target_task_id uuid,
  task_id uuid,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_action_item_state CHECK (state IN ('suggested', 'approved', 'edited', 'rejected')),
  CONSTRAINT chk_action_item_proposal_type CHECK (proposal_type IN ('create_task', 'update_task')),
  FOREIGN KEY (org_id, meeting_id) REFERENCES meetings(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, task_id) REFERENCES tasks(org_id, id) ON DELETE SET NULL,
  FOREIGN KEY (org_id, target_task_id) REFERENCES tasks(org_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_action_items_meeting ON action_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_action_items_org_suggested_owner ON action_items(org_id, suggested_owner_id) WHERE state = 'suggested';

-- 3.13 Docs & Doc Versions
CREATE TABLE IF NOT EXISTS docs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  node_id uuid NOT NULL,
  title varchar(255) NOT NULL,
  body_md text NOT NULL DEFAULT '',
  body_json jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_docs_org_id UNIQUE (org_id, id),
  FOREIGN KEY (org_id, node_id) REFERENCES nodes(org_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_docs_org_node ON docs(org_id, node_id);

CREATE TABLE IF NOT EXISTS doc_versions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  doc_id uuid NOT NULL,
  version integer NOT NULL,
  title varchar(255) NOT NULL,
  body_md text NOT NULL,
  body_json jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_doc_versions_doc_version UNIQUE (doc_id, version),
  CONSTRAINT uq_doc_versions_org_doc_version UNIQUE (org_id, doc_id, version),
  FOREIGN KEY (org_id, doc_id) REFERENCES docs(org_id, id) ON DELETE CASCADE
);

-- 3.14 Comments (Polymorphic Target Discussions)
CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  target_type varchar(32) NOT NULL,
  target_id uuid NOT NULL,
  parent_id uuid,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body_md text NOT NULL,
  mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_comments_target_type CHECK (target_type IN ('task', 'node', 'doc', 'meeting')),
  CONSTRAINT chk_comments_no_self_parent CHECK (parent_id IS NULL OR parent_id != id),
  FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_org_author ON comments(org_id, author_id);

-- 3.15 Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(32) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  dedupe_key varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notifications_org_user_dedupe UNIQUE (org_id, user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at);

-- 3.16 Chunks (Hybrid Search & 1024-Dimension Vector Retrieval)
CREATE TABLE IF NOT EXISTS chunks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  source_type varchar(32) NOT NULL,
  source_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  node_path ltree NOT NULL,
  content text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding vector(1024),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_chunks_source_type CHECK (source_type IN ('task', 'meeting_notes', 'doc', 'transcript_segment'))
);
CREATE INDEX IF NOT EXISTS idx_chunks_org_node_path_gist ON chunks USING gist(node_path);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv_gin ON chunks USING gin(tsv);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_type, source_id);

-- 3.17 Integrations (Third-Party OAuth Metadata)
CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL,
  account_id varchar(128) NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  secret_arn varchar(255) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'connected',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_integrations_org_provider UNIQUE (org_id, provider)
);

-- 3.18 Outbox (Transactional Outbox)
CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  topic varchar(128) NOT NULL,
  payload jsonb NOT NULL,
  delivery_attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  locked_by varchar(64),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON outbox(id, created_at) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_sent_at ON outbox(sent_at, created_at);

-- 3.19 Activity Log (Partitioned by Range)
CREATE TABLE IF NOT EXISTS activity_log (
  id uuid DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL,
  actor_id uuid,
  verb varchar(64) NOT NULL,
  target_type varchar(32) NOT NULL,
  target_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS activity_log_2026_10 PARTITION OF activity_log
  FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS activity_log_2026_11 PARTITION OF activity_log
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS activity_log_default PARTITION OF activity_log DEFAULT;

CREATE INDEX IF NOT EXISTS idx_activity_log_org_created ON activity_log(org_id, created_at);

-- 3.20 Invitations (Supporting Table for Membership Invites)
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email citext NOT NULL,
  role varchar(32) NOT NULL DEFAULT 'member',
  token varchar(128) NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_invitations_role CHECK (role IN ('owner', 'admin', 'member', 'viewer'))
);
CREATE INDEX IF NOT EXISTS idx_invitations_org_email ON invitations(org_id, email);

-- ==============================================================================
-- 4. Isolated Organization Bootstrap Function (SECURITY DEFINER)
-- ==============================================================================
CREATE OR REPLACE FUNCTION create_organization_with_owner(
  p_slug varchar(64),
  p_name varchar(255),
  p_owner_user_id uuid,
  p_plan varchar(32) DEFAULT 'starter',
  p_retention_days integer DEFAULT 180,
  p_ai_budget_inr numeric(12, 2) DEFAULT 5000.00
)
RETURNS TABLE (
  org_id uuid,
  org_slug varchar(64),
  org_name varchar(255),
  owner_user_id uuid,
  owner_role varchar(32)
)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  -- 1. Ensure owner user exists
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_owner_user_id) THEN
    RAISE EXCEPTION 'Cannot bootstrap organization: User % does not exist', p_owner_user_id;
  END IF;

  -- 2. Insert organization
  INSERT INTO orgs (slug, name, plan, retention_days, ai_budget_inr)
  VALUES (p_slug, p_name, p_plan, p_retention_days, p_ai_budget_inr)
  RETURNING id INTO v_org_id;

  -- 3. Insert initial owner membership
  INSERT INTO memberships (org_id, user_id, role, session_epoch)
  VALUES (v_org_id, p_owner_user_id, 'owner', 1);

  RETURN QUERY
  SELECT v_org_id, p_slug, p_name, p_owner_user_id, 'owner'::varchar(32);
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- 5. Restricted Runtime Database Role & Privileges
-- ==============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workspace_app') THEN
    CREATE ROLE workspace_app WITH LOGIN PASSWORD 'workspace_app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

GRANT CONNECT ON DATABASE workspace_dev TO workspace_app;
GRANT USAGE ON SCHEMA public TO workspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO workspace_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO workspace_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO workspace_app;

-- ==============================================================================
-- 6. Row-Level Security (RLS) Implementation
-- ==============================================================================

-- Enable and FORCE RLS on all tenant tables
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgs FORCE ROW LEVEL SECURITY;

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;

ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodes FORCE ROW LEVEL SECURITY;

ALTER TABLE node_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_members FORCE ROW LEVEL SECURITY;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;

ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE labels FORCE ROW LEVEL SECURITY;

ALTER TABLE task_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_labels FORCE ROW LEVEL SECURITY;

ALTER TABLE project_key_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_key_counters FORCE ROW LEVEL SECURITY;

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings FORCE ROW LEVEL SECURITY;

ALTER TABLE transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_segments FORCE ROW LEVEL SECURITY;

ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_notes FORCE ROW LEVEL SECURITY;

ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_items FORCE ROW LEVEL SECURITY;

ALTER TABLE docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE docs FORCE ROW LEVEL SECURITY;

ALTER TABLE doc_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments FORCE ROW LEVEL SECURITY;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks FORCE ROW LEVEL SECURITY;

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations FORCE ROW LEVEL SECURITY;

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log FORCE ROW LEVEL SECURITY;

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;

-- 6.1 Users RLS (Global Identity scoped to authenticated self or org peers)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_isolation_policy ON users
USING (
  -- User can read self, OR user shares an organization membership with the target user
  id = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR EXISTS (
    SELECT 1 FROM memberships m1
    JOIN memberships m2 ON m1.org_id = m2.org_id
    WHERE m1.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m2.user_id = users.id
      AND m1.org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  )
);

-- 6.2 Strict Tenant Isolation Policy Macro
-- Tenant policies act as the permissive boundary for each organization.

-- Orgs policy
CREATE POLICY orgs_tenant_policy ON orgs
USING (id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Memberships policy
CREATE POLICY memberships_tenant_policy ON memberships
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Labels policy
CREATE POLICY labels_tenant_policy ON labels
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Task labels policy
CREATE POLICY task_labels_tenant_policy ON task_labels
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Project key counters policy
CREATE POLICY project_key_counters_tenant_policy ON project_key_counters
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Meetings policy
CREATE POLICY meetings_tenant_policy ON meetings
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Transcript segments policy
CREATE POLICY transcript_segments_tenant_policy ON transcript_segments
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Meeting notes policy
CREATE POLICY meeting_notes_tenant_policy ON meeting_notes
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Action items policy
CREATE POLICY action_items_tenant_policy ON action_items
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Comments policy
CREATE POLICY comments_tenant_policy ON comments
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Notifications policy
CREATE POLICY notifications_tenant_policy ON notifications
USING (
  org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
)
WITH CHECK (
  org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
);

-- Integrations policy (Admins/Owners only)
CREATE POLICY integrations_tenant_policy ON integrations
USING (
  org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = integrations.org_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = integrations.org_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner', 'admin')
  )
);

-- Outbox policy
CREATE POLICY outbox_tenant_policy ON outbox
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Activity log policy
CREATE POLICY activity_log_tenant_policy ON activity_log
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Invitations policy
CREATE POLICY invitations_tenant_policy ON invitations
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- 6.3 Private Project & Node Visibility Policies (RESTRICTIVE)

-- Nodes: Public nodes accessible to org members; Private nodes require explicit node membership or owner/admin role
CREATE POLICY nodes_tenant_policy ON nodes
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY nodes_private_visibility_policy ON nodes
AS RESTRICTIVE
USING (
  visibility = 'public'
  OR EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = nodes.org_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner', 'admin')
  )
  OR EXISTS (
    SELECT 1 FROM node_members nm
    WHERE nm.node_id = nodes.id
      AND nm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
);

-- Node Members Policy
CREATE POLICY node_members_tenant_policy ON node_members
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Tasks: Inherit project node visibility
CREATE POLICY tasks_tenant_policy ON tasks
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY tasks_private_project_policy ON tasks
AS RESTRICTIVE
USING (
  EXISTS (
    SELECT 1 FROM nodes n
    WHERE n.id = tasks.project_id
      AND n.org_id = tasks.org_id
      AND (
        n.visibility = 'public'
        OR EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.org_id = tasks.org_id
            AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
            AND m.role IN ('owner', 'admin')
        )
        OR EXISTS (
          SELECT 1 FROM node_members nm
          WHERE nm.node_id = n.id
            AND nm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        )
      )
  )
);

-- Docs: Inherit node visibility
CREATE POLICY docs_tenant_policy ON docs
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY docs_private_node_policy ON docs
AS RESTRICTIVE
USING (
  EXISTS (
    SELECT 1 FROM nodes n
    WHERE n.id = docs.node_id
      AND n.org_id = docs.org_id
      AND (
        n.visibility = 'public'
        OR EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.org_id = docs.org_id
            AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
            AND m.role IN ('owner', 'admin')
        )
        OR EXISTS (
          SELECT 1 FROM node_members nm
          WHERE nm.node_id = n.id
            AND nm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        )
      )
  )
);

-- Doc Versions: Inherit doc parent node visibility
CREATE POLICY doc_versions_tenant_policy ON doc_versions
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY doc_versions_private_node_policy ON doc_versions
AS RESTRICTIVE
USING (
  EXISTS (
    SELECT 1 FROM docs d
    JOIN nodes n ON n.id = d.node_id
    WHERE d.id = doc_versions.doc_id
      AND d.org_id = doc_versions.org_id
      AND (
        n.visibility = 'public'
        OR EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.org_id = doc_versions.org_id
            AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
            AND m.role IN ('owner', 'admin')
        )
        OR EXISTS (
          SELECT 1 FROM node_members nm
          WHERE nm.node_id = n.id
            AND nm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        )
      )
  )
);

-- Chunks: Permission-filtered retrieval
CREATE POLICY chunks_tenant_policy ON chunks
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY chunks_private_node_policy ON chunks
AS RESTRICTIVE
USING (
  EXISTS (
    SELECT 1 FROM nodes n
    WHERE n.org_id = chunks.org_id
      AND n.path @> chunks.node_path
      AND (
        n.visibility = 'public'
        OR EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.org_id = chunks.org_id
            AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
            AND m.role IN ('owner', 'admin')
        )
        OR EXISTS (
          SELECT 1 FROM node_members nm
          WHERE nm.node_id = n.id
            AND nm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        )
      )
  )
);

-- ==============================================================================
-- 7. Audit Triggers to Prevent Altering org_id on UPDATE
-- ==============================================================================
CREATE OR REPLACE FUNCTION prevent_org_id_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.org_id != OLD.org_id THEN
    RAISE EXCEPTION 'Modifying org_id is strictly prohibited (attempted change from % to %)', OLD.org_id, NEW.org_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_prevent_tasks_org_change
BEFORE UPDATE OF org_id ON tasks
FOR EACH ROW EXECUTE FUNCTION prevent_org_id_mutation();

CREATE OR REPLACE TRIGGER trg_prevent_nodes_org_change
BEFORE UPDATE OF org_id ON nodes
FOR EACH ROW EXECUTE FUNCTION prevent_org_id_mutation();

CREATE OR REPLACE TRIGGER trg_prevent_docs_org_change
BEFORE UPDATE OF org_id ON docs
FOR EACH ROW EXECUTE FUNCTION prevent_org_id_mutation();

CREATE OR REPLACE TRIGGER trg_prevent_meetings_org_change
BEFORE UPDATE OF org_id ON meetings
FOR EACH ROW EXECUTE FUNCTION prevent_org_id_mutation();
