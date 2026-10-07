-- Stage 15: AI Notes, Decisions, and Action Items Extraction Pipeline (Requirement N-1)

-- 1. Extraction Runs Table (Durable Run Tracking, Window Progress, and Idempotency)
CREATE TABLE IF NOT EXISTS extraction_runs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  run_key varchar(255) NOT NULL,
  processing_generation integer NOT NULL,
  transcript_checksum varchar(64) NOT NULL,
  prompt_version varchar(32) NOT NULL,
  model varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  total_windows integer NOT NULL DEFAULT 1,
  completed_windows integer NOT NULL DEFAULT 0,
  window_progress jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_inr numeric(12, 6) NOT NULL DEFAULT 0.000000,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_extraction_runs_org_meeting_run_key UNIQUE (org_id, meeting_id, run_key),
  CONSTRAINT chk_extraction_run_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'aborted'))
);

CREATE INDEX IF NOT EXISTS idx_extraction_runs_meeting ON extraction_runs(org_id, meeting_id);
CREATE INDEX IF NOT EXISTS idx_extraction_runs_status ON extraction_runs(org_id, status);

-- 2. AI Usage Ledger Table (Real Provider Auditing, Honest Cost Accounting, and Budget Boundary)
CREATE TABLE IF NOT EXISTS ai_usage_ledger (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES meetings(id) ON DELETE CASCADE,
  extraction_run_id uuid REFERENCES extraction_runs(id) ON DELETE CASCADE,
  operation varchar(64) NOT NULL,
  provider varchar(32) NOT NULL,
  model varchar(64) NOT NULL,
  prompt_id varchar(64) NOT NULL,
  prompt_version varchar(32) NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_inr numeric(12, 6) NOT NULL DEFAULT 0.000000,
  estimated boolean NOT NULL DEFAULT false,
  duration_ms integer NOT NULL DEFAULT 0,
  status varchar(32) NOT NULL DEFAULT 'succeeded',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ai_usage_status CHECK (status IN ('succeeded', 'failed', 'refused'))
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_org_created ON ai_usage_ledger(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_meeting ON ai_usage_ledger(org_id, meeting_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_run ON ai_usage_ledger(extraction_run_id);

-- 3. Extend action_items with Stage 15 fields
ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS owner_name varchar(255),
  ADD COLUMN IF NOT EXISTS due_phrase varchar(255),
  ADD COLUMN IF NOT EXISTS extraction_run_id uuid REFERENCES extraction_runs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_action_items_meeting_state ON action_items(meeting_id, state);

-- 4. Extend meeting_notes with extraction run and linked document provenance
ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS extraction_run_id uuid REFERENCES extraction_runs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS doc_id uuid REFERENCES docs(id) ON DELETE SET NULL;

-- 5. Extend docs with source meeting linkage
ALTER TABLE docs
  ADD COLUMN IF NOT EXISTS source_meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_docs_source_meeting ON docs(org_id, source_meeting_id);
