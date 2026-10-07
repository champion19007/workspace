-- ============================================================================
-- Stage 10 Migration: Documents, Autosave, and Version History (Requirement N-3)
-- ============================================================================

-- 1. Extend docs table with creator, updater, and archive state
ALTER TABLE docs ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE docs ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE docs ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- 2. Indexes for efficient lookup, archiving, and version listing
CREATE INDEX IF NOT EXISTS idx_docs_org_archived ON docs(org_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_docs_node_archived ON docs(node_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_docs_org_updated ON docs(org_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_doc_versions_doc_version_desc ON doc_versions(doc_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_doc_versions_created_at ON doc_versions(doc_id, created_at DESC);

-- 3. Ensure permissions for workspace_app restricted role
GRANT SELECT, INSERT, UPDATE, DELETE ON docs TO workspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON doc_versions TO workspace_app;
