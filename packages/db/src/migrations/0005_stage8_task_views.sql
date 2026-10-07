-- 0005_stage8_task_views.sql
-- Stage 8: Fractional Indexing Collation, Move Coordination & Board/My Tasks Indexes

-- 1. Alter rank column to use "C" collation (case-sensitive byte order matching JavaScript string comparison)
ALTER TABLE tasks ALTER COLUMN rank TYPE varchar(128) COLLATE "C";
ALTER TABLE tasks ALTER COLUMN rank SET DEFAULT 'a0';

-- 2. Normalize any historical null or legacy placeholder ranks to valid base-62 fractional ranks
UPDATE tasks SET rank = 'a0' WHERE rank IS NULL OR rank = '0|hzzzzz:';

-- 3. Recreate index on project_id, status, rank, id with C collation
DROP INDEX IF EXISTS idx_tasks_project_status_rank;
CREATE INDEX idx_tasks_project_status_rank ON tasks (project_id, status, rank, id) WHERE archived_at IS NULL;

-- 4. Fast retrieval index for My Tasks (org, assignee, status, due date)
DROP INDEX IF EXISTS idx_tasks_org_assignee_status_due;
CREATE INDEX idx_tasks_org_assignee_status_due ON tasks (org_id, assignee_id, status, due_date) WHERE archived_at IS NULL;

-- 5. Fast retrieval index for parent-scoped subtasks and root tasks ordering
CREATE INDEX IF NOT EXISTS idx_tasks_parent_scope ON tasks (org_id, project_id, parent_task_id, status, rank, id) WHERE archived_at IS NULL;
