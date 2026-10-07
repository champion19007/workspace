-- Workspace v1 Database Migration: 0002_stage5_idempotency.sql
-- Idempotency keys table with strict tenant isolation and 24-hour expiration

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key varchar(128) NOT NULL,
  operation varchar(64) NOT NULL,
  fingerprint varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  status_code integer,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  CONSTRAINT chk_idempotency_status CHECK (status IN ('pending', 'completed', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_org_actor_key ON idempotency_keys(org_id, actor_id, key);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_org_actor ON idempotency_keys(org_id, actor_id);

-- Enable strict tenant isolation via RLS
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY idempotency_keys_tenant_policy ON idempotency_keys
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
