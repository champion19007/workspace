-- Stage 14 Migration: Speaker Resolution, Permission-Safe Project Routing, and Host Decision Controls

-- 1. Extend meetings table check constraint with awaiting_project_choice and routed statuses
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS chk_meeting_status;
ALTER TABLE meetings ADD CONSTRAINT chk_meeting_status 
  CHECK (status IN (
    'scheduled', 
    'waiting_for_transcript', 
    'pending_consent', 
    'ready_for_transcript_retrieval', 
    'ingesting', 
    'transcript_ready', 
    'routing', 
    'awaiting_project_choice',
    'routed',
    'extracting', 
    'completed', 
    'failed', 
    'intake_failed', 
    'connection_requires_reconnection', 
    'skipped'
  ));

-- 2. Add columns to meetings for routing decisions, suggestions, and speaker resolution
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS suggested_node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS routing_confidence NUMERIC(4, 3),
  ADD COLUMN IF NOT EXISTS routing_reason TEXT,
  ADD COLUMN IF NOT EXISTS routing_alternatives JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS routing_actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS routing_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS speakers_resolved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS speaker_resolution_metadata JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_meetings_org_suggested_node ON meetings (org_id, suggested_node_id);

-- 3. Extend transcript_segments with speaker resolution method and confidence
ALTER TABLE transcript_segments
  ADD COLUMN IF NOT EXISTS resolution_method VARCHAR(32),
  ADD COLUMN IF NOT EXISTS resolution_confidence NUMERIC(4, 3);

ALTER TABLE transcript_segments DROP CONSTRAINT IF EXISTS chk_transcript_resolution_method;
ALTER TABLE transcript_segments ADD CONSTRAINT chk_transcript_resolution_method
  CHECK (resolution_method IS NULL OR resolution_method IN ('email_verified', 'fuzzy_llm', 'manual', 'unresolved'));

CREATE INDEX IF NOT EXISTS idx_transcript_segments_meeting_user ON transcript_segments (meeting_id, user_id);

-- 4. Extend zoom_host_consents with user_id for self-service host consent
ALTER TABLE zoom_host_consents
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_zoom_host_consents_org_user ON zoom_host_consents (org_id, user_id);

-- 5. Ensure workspace_app role has permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON meetings TO workspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON transcript_segments TO workspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON zoom_host_consents TO workspace_app;
