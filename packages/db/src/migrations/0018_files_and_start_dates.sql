-- ==============================================================================
-- Files and task start dates
--
-- A file belongs to a project and, when it is a task attachment, to one of its tasks. The bytes live in the blob
-- store under storage_key; this table is what decides who can see them. Like comments, a file is visible when its
-- project is, and clients see a project's files but never task attachments.
-- Tasks get an optional start date so the Timeline can draw them from start to due date.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  node_id uuid NOT NULL,
  task_id uuid,
  name varchar(255) NOT NULL,
  content_type varchar(255) NOT NULL,
  size_bytes integer NOT NULL,
  storage_key varchar(1024) NOT NULL,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz,
  CONSTRAINT chk_files_size CHECK (size_bytes >= 0),
  FOREIGN KEY (org_id, node_id) REFERENCES nodes(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, task_id) REFERENCES tasks(org_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_files_node_created ON files(node_id, created_at);
CREATE INDEX IF NOT EXISTS idx_files_task ON files(task_id);

ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;

CREATE POLICY files_tenant_policy ON files
TO workspace_app
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY files_project_visible_policy ON files
AS RESTRICTIVE FOR ALL TO workspace_app
USING (
  EXISTS (SELECT 1 FROM nodes n WHERE n.id = files.node_id)
  AND (
    task_id IS NULL
    OR (NOT (SELECT acting_user_is_client()) AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = files.task_id))
  )
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_task_start_before_due;
ALTER TABLE tasks ADD CONSTRAINT chk_task_start_before_due
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date);
