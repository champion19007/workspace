-- ============================================================================
-- Stage 11 Migration: Zoom Account Connection, Credential Lifecycle, and Host Opt-In (Requirement M-1)
-- ============================================================================

-- 1. Extend integrations table
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS connection_generation integer NOT NULL DEFAULT 1;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS installed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS installed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS account_name varchar(255);
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS account_email varchar(255);
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS last_refreshed_at timestamptz;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS last_error_category varchar(64);
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS last_error_message text;

-- Ensure partial unique index for 1 active Workspace organization per Zoom account
CREATE UNIQUE INDEX IF NOT EXISTS uq_integrations_active_provider_account
  ON integrations (provider, account_id)
  WHERE (status != 'disconnected');

-- 2. Zoom OAuth temporary single-use state table
CREATE TABLE IF NOT EXISTS zoom_oauth_states (
  state varchar(128) PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id varchar(128) NOT NULL,
  code_verifier varchar(128) NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zoom_oauth_states_org ON zoom_oauth_states(org_id);
CREATE INDEX IF NOT EXISTS idx_zoom_oauth_states_expires ON zoom_oauth_states(expires_at);

ALTER TABLE zoom_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoom_oauth_states FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zoom_oauth_states_tenant_policy ON zoom_oauth_states;
CREATE POLICY zoom_oauth_states_tenant_policy ON zoom_oauth_states
USING (
  org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = zoom_oauth_states.org_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = zoom_oauth_states.org_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner', 'admin')
  )
);

-- 3. Zoom Host Consents table
CREATE TABLE IF NOT EXISTS zoom_host_consents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  zoom_user_id varchar(128) NOT NULL,
  zoom_email varchar(255) NOT NULL,
  zoom_name varchar(255),
  consent_status varchar(32) NOT NULL DEFAULT 'unknown',
  consent_timestamp timestamptz,
  policy_version varchar(32) NOT NULL DEFAULT '1.0',
  admin_disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_zoom_host_consent_status CHECK (consent_status IN ('opted_in', 'opted_out', 'unknown'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_zoom_host_consents_org_user ON zoom_host_consents(org_id, zoom_user_id);
CREATE INDEX IF NOT EXISTS idx_zoom_host_consents_org_email ON zoom_host_consents(org_id, zoom_email);
CREATE INDEX IF NOT EXISTS idx_zoom_host_consents_integration ON zoom_host_consents(integration_id);

ALTER TABLE zoom_host_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoom_host_consents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zoom_host_consents_tenant_policy ON zoom_host_consents;
CREATE POLICY zoom_host_consents_tenant_policy ON zoom_host_consents
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (
  org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = zoom_host_consents.org_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner', 'admin')
  )
);

-- 4. Permissions for workspace_app
GRANT SELECT, INSERT, UPDATE, DELETE ON integrations TO workspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON zoom_oauth_states TO workspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON zoom_host_consents TO workspace_app;
