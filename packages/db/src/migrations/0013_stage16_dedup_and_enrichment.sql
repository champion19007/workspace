-- Stage 16: Open-Task Deduplication, Task Embeddings, Owner Resolution & Due Dates
-- Requirements N-1, N-2, and M-4

-- 1. Create task_embeddings table
CREATE TABLE IF NOT EXISTS task_embeddings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  content_hash varchar(64) NOT NULL,
  embedding_space varchar(64) NOT NULL,
  policy_version varchar(32) NOT NULL DEFAULT 'v1.0.0',
  embedding vector(1024) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_task_embeddings_task_space UNIQUE (task_id, embedding_space, policy_version)
);

CREATE INDEX IF NOT EXISTS idx_task_embeddings_org ON task_embeddings (org_id);
CREATE INDEX IF NOT EXISTS idx_task_embeddings_task ON task_embeddings (task_id);
CREATE INDEX IF NOT EXISTS idx_task_embeddings_hash ON task_embeddings (content_hash);

-- 2. Row Level Security for task_embeddings
ALTER TABLE task_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_embeddings FORCE ROW LEVEL SECURITY;

CREATE POLICY task_embeddings_tenant_policy ON task_embeddings
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY task_embeddings_private_project_policy ON task_embeddings
AS RESTRICTIVE
USING (
  EXISTS (
    SELECT 1 FROM tasks t
    JOIN nodes n ON n.id = t.project_id
    WHERE t.id = task_embeddings.task_id
      AND t.org_id = task_embeddings.org_id
      AND (
        n.visibility = 'public'
        OR EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.org_id = task_embeddings.org_id
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

-- 3. Extend action_items with deduplication, owner resolution, and due date resolution fields
ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS validation_status varchar(32) NOT NULL DEFAULT 'valid',
  ADD COLUMN IF NOT EXISTS target_task_version integer,
  ADD COLUMN IF NOT EXISTS target_task_hash varchar(64),
  ADD COLUMN IF NOT EXISTS similarity_score numeric(5, 4),
  ADD COLUMN IF NOT EXISTS ranked_alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS embedding_space varchar(64),
  ADD COLUMN IF NOT EXISTS dedup_status varchar(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS deduped_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_resolution_method varchar(64),
  ADD COLUMN IF NOT EXISTS owner_resolution_confidence numeric(4, 3),
  ADD COLUMN IF NOT EXISTS owner_resolution_evidence text,
  ADD COLUMN IF NOT EXISTS due_resolution_explanation text,
  ADD COLUMN IF NOT EXISTS due_resolution_status varchar(32);

CREATE INDEX IF NOT EXISTS idx_action_items_dedup_status ON action_items (meeting_id, dedup_status);
CREATE INDEX IF NOT EXISTS idx_action_items_validation_status ON action_items (meeting_id, validation_status);
