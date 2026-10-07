-- Stage 13 Migration: Authenticated Transcript Retrieval, Normalization, Stable Evidence Anchors, and Meeting Skip Cleanup

-- 1. Extend meetings table check constraint with transcript_ready status
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
    'extracting', 
    'completed', 
    'failed', 
    'intake_failed', 
    'connection_requires_reconnection', 
    'skipped'
  ));

-- 2. Add columns to meetings table for OCC, generation fencing, consent, source preservation, and cleanup
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS processing_generation INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS guest_consent_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS raw_transcript_object_key TEXT,
  ADD COLUMN IF NOT EXISTS raw_transcript_checksum VARCHAR(64),
  ADD COLUMN IF NOT EXISTS raw_transcript_byte_count INTEGER,
  ADD COLUMN IF NOT EXISTS transcript_retention_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_manifest JSONB,
  ADD COLUMN IF NOT EXISTS cleanup_status VARCHAR(32) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS cleaned_up_at TIMESTAMPTZ;

ALTER TABLE meetings DROP CONSTRAINT IF EXISTS chk_meeting_guest_consent_status;
ALTER TABLE meetings ADD CONSTRAINT chk_meeting_guest_consent_status
  CHECK (guest_consent_status IN ('absent', 'consented', 'unknown', 'pending'));

ALTER TABLE meetings DROP CONSTRAINT IF EXISTS chk_meeting_cleanup_status;
ALTER TABLE meetings ADD CONSTRAINT chk_meeting_cleanup_status
  CHECK (cleanup_status IN ('none', 'pending', 'completed'));

-- 3. Extend transcript_segments with checksum and source cue identifier
ALTER TABLE transcript_segments
  ADD COLUMN IF NOT EXISTS checksum VARCHAR(64),
  ADD COLUMN IF NOT EXISTS source_cue_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_meeting_speaker ON transcript_segments (meeting_id, speaker_label);

-- 4. Ensure workspace_app role has permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON meetings TO workspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON transcript_segments TO workspace_app;
