-- ==============================================================================
-- Progress summaries
--
-- The plain-words summary on the Progress page is written by AI from the projects the reader can see, so it is
-- kept per person and per set of visible projects (scope_key). It is only ever read by the person it was written
-- for: a client's summary never reaches anyone else.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS progress_summaries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_key varchar(64) NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_progress_summaries_user ON progress_summaries(org_id, user_id, created_at DESC);

ALTER TABLE progress_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_summaries FORCE ROW LEVEL SECURITY;

CREATE POLICY progress_summaries_owner_policy ON progress_summaries
TO workspace_app
USING (
  org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
)
WITH CHECK (
  org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
);
