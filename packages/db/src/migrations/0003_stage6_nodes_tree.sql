-- Migration: 0003_stage6_nodes_tree.sql
-- Add version, archived_at, created_by, and description to nodes table for Stage 6

ALTER TABLE nodes ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_nodes_org_archived ON nodes(org_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_nodes_org_kind ON nodes(org_id, kind);
