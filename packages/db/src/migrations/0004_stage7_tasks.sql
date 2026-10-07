-- Migration 0004: Stage 7 Tasks, Labels, Key Prefixes, and Concurrency Schema
-- Adds creator, archived_at, and key_prefix to tasks and nodes

-- 1. Tasks additions
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tasks_org_archived ON tasks(org_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_tasks_project_archived ON tasks(project_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_org_created_by ON tasks(org_id, created_by);

-- 2. Nodes project key prefix addition
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS key_prefix varchar(16);

-- Unique key prefix per project within each organization
CREATE UNIQUE INDEX IF NOT EXISTS uq_nodes_org_key_prefix 
  ON nodes(org_id, key_prefix) 
  WHERE kind = 'project' AND key_prefix IS NOT NULL;

-- 3. Backfill key prefixes for existing projects
DO $$
DECLARE
  r RECORD;
  v_base_prefix text;
  v_candidate text;
  v_suffix integer;
  v_exists boolean;
BEGIN
  FOR r IN SELECT id, org_id, name FROM nodes WHERE kind = 'project' AND key_prefix IS NULL LOOP
    -- Generate base prefix: uppercase alphanumeric from name, 2 to 4 chars
    v_base_prefix := UPPER(REGEXP_REPLACE(r.name, '[^a-zA-Z0-9]', '', 'g'));
    IF LENGTH(v_base_prefix) < 2 THEN
      v_base_prefix := 'PRJ';
    ELSE
      v_base_prefix := SUBSTRING(v_base_prefix FROM 1 FOR 4);
    END IF;

    v_candidate := v_base_prefix;
    v_suffix := 1;

    -- Handle collisions within the same org
    LOOP
      SELECT EXISTS(
        SELECT 1 FROM nodes 
        WHERE org_id = r.org_id AND key_prefix = v_candidate AND id != r.id
      ) INTO v_exists;

      IF NOT v_exists THEN
        EXIT;
      END IF;

      v_suffix := v_suffix + 1;
      v_candidate := SUBSTRING(v_base_prefix FROM 1 FOR 3) || v_suffix::text;
    END LOOP;

    -- Update project with allocated prefix
    UPDATE nodes SET key_prefix = v_candidate WHERE id = r.id;

    -- Initialize project key counter if not present
    INSERT INTO project_key_counters (org_id, project_id, prefix, last_number, updated_at)
    VALUES (r.org_id, r.id, v_candidate, 0, NOW())
    ON CONFLICT (org_id, prefix) DO NOTHING;
  END LOOP;
END;
$$;
