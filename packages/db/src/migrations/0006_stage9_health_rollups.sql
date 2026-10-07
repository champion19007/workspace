-- Workspace v1 Database Migration: 0006_stage9_health_rollups.sql
-- Adds node_rollup_dirty table for debounced background health recomputations and race-free generational watermarking

CREATE TABLE IF NOT EXISTS node_rollup_dirty (
  node_id uuid PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  dirty_generation integer NOT NULL DEFAULT 1,
  requested_at timestamptz NOT NULL DEFAULT now(),
  debounce_until timestamptz NOT NULL DEFAULT (now() + interval '10 seconds'),
  locked_at timestamptz,
  locked_by varchar(64)
);

CREATE INDEX IF NOT EXISTS idx_node_rollup_dirty_debounce
  ON node_rollup_dirty (debounce_until)
  WHERE locked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_node_rollup_dirty_org
  ON node_rollup_dirty (org_id);

-- Enable RLS for node_rollup_dirty
ALTER TABLE node_rollup_dirty ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_rollup_dirty FORCE ROW LEVEL SECURITY;

CREATE POLICY node_rollup_dirty_tenant_policy ON node_rollup_dirty
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
