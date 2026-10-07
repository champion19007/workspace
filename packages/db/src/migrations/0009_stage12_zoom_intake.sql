-- Stage 12 Migration: Zoom Webhook Intake, Meeting Metadata, and Poller Checkpoints

-- 1. Extend meetings table check constraint with truthful lifecycle statuses
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS chk_meeting_status;
ALTER TABLE meetings ADD CONSTRAINT chk_meeting_status 
  CHECK (status IN (
    'scheduled', 
    'waiting_for_transcript', 
    'pending_consent', 
    'ready_for_transcript_retrieval', 
    'ingesting', 
    'routing', 
    'extracting', 
    'completed', 
    'failed', 
    'intake_failed', 
    'connection_requires_reconnection', 
    'skipped'
  ));

-- 2. Add columns to meetings table for provider metadata and intake coordination
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS provider_numeric_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS zoom_host_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS zoom_host_email CITEXT,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64),
  ADD COLUMN IF NOT EXISTS recording_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transcript_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS has_transcript BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_recording BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS intake_error TEXT,
  ADD COLUMN IF NOT EXISTS connection_generation INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_meetings_org_status ON meetings (org_id, status);
CREATE INDEX IF NOT EXISTS idx_meetings_org_zoom_host ON meetings (org_id, zoom_host_id);
CREATE INDEX IF NOT EXISTS idx_meetings_org_created_at ON meetings (org_id, created_at DESC);

-- 3. Create zoom_webhook_events for deduplicated intake receipts
CREATE TABLE IF NOT EXISTS zoom_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  account_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  event_id VARCHAR(128) NOT NULL,
  provider_meeting_uuid VARCHAR(128),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_zoom_webhook_events UNIQUE (account_id, event_type, event_id)
);

CREATE INDEX IF NOT EXISTS idx_zoom_webhook_events_org ON zoom_webhook_events (org_id);
CREATE INDEX IF NOT EXISTS idx_zoom_webhook_events_account_type ON zoom_webhook_events (account_id, event_type);

-- 4. Create zoom_poll_checkpoints for thirty-minute fallback polling coordinator
CREATE TABLE IF NOT EXISTS zoom_poll_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  account_id VARCHAR(64) NOT NULL,
  last_scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cursor VARCHAR(255),
  lease_owner VARCHAR(128),
  lease_expires_at TIMESTAMPTZ,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_zoom_poll_checkpoints UNIQUE (org_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_zoom_poll_checkpoints_account ON zoom_poll_checkpoints (account_id);

-- 5. Role permissions for workspace_app
GRANT SELECT, INSERT, UPDATE, DELETE ON meetings TO workspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON zoom_webhook_events TO workspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON zoom_poll_checkpoints TO workspace_app;

-- 6. Enable RLS on newly created tables
ALTER TABLE zoom_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoom_poll_checkpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zoom_webhook_events_tenant_isolation ON zoom_webhook_events;
CREATE POLICY zoom_webhook_events_tenant_isolation ON zoom_webhook_events
  FOR ALL
  USING (
    org_id IS NULL OR
    current_setting('app.org_id', true) IS NULL OR
    current_setting('app.org_id', true) = '' OR
    org_id = current_setting('app.org_id', true)::uuid
  )
  WITH CHECK (
    org_id IS NULL OR
    current_setting('app.org_id', true) IS NULL OR
    current_setting('app.org_id', true) = '' OR
    org_id = current_setting('app.org_id', true)::uuid
  );

DROP POLICY IF EXISTS zoom_poll_checkpoints_tenant_isolation ON zoom_poll_checkpoints;
CREATE POLICY zoom_poll_checkpoints_tenant_isolation ON zoom_poll_checkpoints
  FOR ALL
  USING (
    current_setting('app.org_id', true) IS NULL OR
    current_setting('app.org_id', true) = '' OR
    org_id = current_setting('app.org_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.org_id', true) IS NULL OR
    current_setting('app.org_id', true) = '' OR
    org_id = current_setting('app.org_id', true)::uuid
  );
