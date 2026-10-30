-- ==============================================================================
-- Stage 17b: Runtime RLS enforcement (ADR "17b — Runtime RLS enforcement")
--
-- Until now the API, BFF and worker connected as the database owner (SUPERUSER + BYPASSRLS), so the
-- policies of migrations 0001-0014 were inert at runtime. This migration adds the role model the
-- application now runs under. None of these roles is SUPERUSER or BYPASSRLS:
--
--   workspace_api     LOGIN, NOINHERIT  API/BFF login. No table privileges of its own; may SET ROLE workspace_app.
--   workspace_worker  LOGIN, NOINHERIT  Worker login. May SET ROLE workspace_app or workspace_system.
--   workspace_app     NOLOGIN           Tenant work for an acting user: tenant + per-user policies.
--   workspace_system  NOLOGIN           Background work in one org with no acting user: tenant policies only.
--   workspace_definer NOLOGIN           Owns the SECURITY DEFINER entry points of section 6. Nobody can assume it.
--
-- Tenant transactions start with set_config('role', ..., true) (= SET LOCAL ROLE) plus the app.* GUCs, so
-- the role and context reset at COMMIT/ROLLBACK (safe with transaction poolers and RDS Proxy).
-- Login roles are created without a password: operators set it from the secret store (local docker:
-- infra/docker/postgres/init.sql). Migrations keep running as the database owner (DATABASE_MIGRATION_URL).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Roles
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workspace_system') THEN
    CREATE ROLE workspace_system NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workspace_definer') THEN
    CREATE ROLE workspace_definer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workspace_api') THEN
    CREATE ROLE workspace_api LOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workspace_worker') THEN
    CREATE ROLE workspace_worker LOGIN NOINHERIT;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO workspace_api, workspace_worker', current_database());
  -- A non-superuser migration owner (e.g. Supabase's postgres role) must be able to hand the entry points of
  -- section 6 to workspace_definer and create the pgboss schema owned by workspace_worker.
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('GRANT workspace_definer, workspace_worker TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  END IF;
END $$;

-- 0001 created workspace_app as a login role with a password committed to the repository. It is now only
-- a SET ROLE target of the login roles.
ALTER ROLE workspace_app NOLOGIN PASSWORD NULL;

-- Login roles can only SET ROLE into the runtime roles: no inherited (ambient) table privileges, so a query
-- issued outside a tenant transaction fails with "permission denied" instead of running unscoped.
GRANT workspace_app TO workspace_api WITH INHERIT FALSE, SET TRUE;
GRANT workspace_app, workspace_system TO workspace_worker WITH INHERIT FALSE, SET TRUE;

-- ------------------------------------------------------------------------------
-- 2. Privileges
-- ------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO workspace_api, workspace_worker, workspace_system, workspace_definer;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO workspace_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO workspace_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO workspace_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO workspace_app, workspace_system;

-- The decision log is append-only for every runtime role (0014).
REVOKE UPDATE, DELETE ON action_item_decisions FROM workspace_system;

-- Migration bookkeeping is not application data (the table exists when the runner applies migrations).
DO $$
BEGIN
  IF to_regclass('public._migrations') IS NOT NULL THEN
    REVOKE ALL ON _migrations FROM workspace_app, workspace_system;
  END IF;
END $$;

-- RLS on a partitioned table applies only when it is queried through the parent: no direct partition access.
DO $$
DECLARE
  part regclass;
BEGIN
  FOR part IN SELECT inhrelid::regclass FROM pg_inherits WHERE inhparent = 'activity_log'::regclass LOOP
    EXECUTE format('REVOKE ALL ON %s FROM workspace_app, workspace_system', part);
  END LOOP;
END $$;

-- pg-boss (QUEUE_PROVIDER=pgboss) installs into its own schema under the worker login.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION workspace_worker;

-- ------------------------------------------------------------------------------
-- 3. Tenant tables that had no RLS (Stage 15) and policies that failed open (Stage 12)
-- ------------------------------------------------------------------------------
ALTER TABLE extraction_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY extraction_runs_tenant_policy ON extraction_runs
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

ALTER TABLE ai_usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_ledger_tenant_policy ON ai_usage_ledger
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- 0009 admitted every row when app.org_id was unset and was not FORCEd. Receipts for Zoom accounts that
-- map to no organization (org_id NULL) are written only by the entry points of section 6.
ALTER TABLE zoom_webhook_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zoom_webhook_events_tenant_isolation ON zoom_webhook_events;
CREATE POLICY zoom_webhook_events_tenant_policy ON zoom_webhook_events
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

ALTER TABLE zoom_poll_checkpoints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zoom_poll_checkpoints_tenant_isolation ON zoom_poll_checkpoints;
CREATE POLICY zoom_poll_checkpoints_tenant_policy ON zoom_poll_checkpoints
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- ------------------------------------------------------------------------------
-- 4. Per-user policies vs. background work
-- ------------------------------------------------------------------------------
-- Private-project visibility is a per-user rule: it applies to workspace_app (an acting user). The worker's
-- workspace_system processes every project of the one organization set in app.org_id.
-- nodes: same visibility rule as 0001 for reading, changing and deleting. The creator's node membership can only
-- be written after the node (foreign key), so creating a private node is admitted for its own creator.
DROP POLICY nodes_private_visibility_policy ON nodes;
CREATE POLICY nodes_private_visibility_policy ON nodes
AS RESTRICTIVE FOR SELECT TO workspace_app
USING (
  visibility = 'public'
  OR EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = nodes.org_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner', 'admin')
  )
  OR EXISTS (
    SELECT 1 FROM node_members nm
    WHERE nm.node_id = nodes.id
      AND nm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
);
CREATE POLICY nodes_private_visibility_update_policy ON nodes
AS RESTRICTIVE FOR UPDATE TO workspace_app
USING (
  visibility = 'public'
  OR EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = nodes.org_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner', 'admin')
  )
  OR EXISTS (
    SELECT 1 FROM node_members nm
    WHERE nm.node_id = nodes.id
      AND nm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
);
CREATE POLICY nodes_private_visibility_delete_policy ON nodes
AS RESTRICTIVE FOR DELETE TO workspace_app
USING (
  visibility = 'public'
  OR EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = nodes.org_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner', 'admin')
  )
  OR EXISTS (
    SELECT 1 FROM node_members nm
    WHERE nm.node_id = nodes.id
      AND nm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
);
CREATE POLICY nodes_private_visibility_insert_policy ON nodes
AS RESTRICTIVE FOR INSERT TO workspace_app
WITH CHECK (
  visibility = 'public'
  OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = nodes.org_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner', 'admin')
  )
);
ALTER POLICY tasks_private_project_policy ON tasks TO workspace_app;
ALTER POLICY docs_private_node_policy ON docs TO workspace_app;
ALTER POLICY doc_versions_private_node_policy ON doc_versions TO workspace_app;
ALTER POLICY chunks_private_node_policy ON chunks TO workspace_app;
ALTER POLICY task_embeddings_private_project_policy ON task_embeddings TO workspace_app;
ALTER POLICY action_items_private_project_policy ON action_items TO workspace_app;
ALTER POLICY action_item_decisions_private_project_policy ON action_item_decisions TO workspace_app;

-- The worker resolves speakers and owners against the members of the organization being processed.
CREATE POLICY users_system_policy ON users
FOR SELECT TO workspace_system
USING (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = users.id
      AND m.org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  )
);

-- integrations is Owner/Admin-only for users (0001); the worker reads it and refreshes credentials.
CREATE POLICY integrations_system_policy ON integrations
TO workspace_system
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Self-service host consent (Stage 14) by Members: 0008 only admitted writes by Owners/Admins, which worked
-- only because RLS was bypassed. A user may claim or create only the consent row bound to their own user id
-- and their own verified email.
CREATE POLICY zoom_host_consents_self_service_policy ON zoom_host_consents
FOR INSERT TO workspace_app
WITH CHECK (
  org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND lower(zoom_email) = (SELECT lower(u.email) FROM users u WHERE u.id = zoom_host_consents.user_id)
);
CREATE POLICY zoom_host_consents_self_service_update_policy ON zoom_host_consents
FOR UPDATE TO workspace_app
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (
  org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND lower(zoom_email) = (SELECT lower(u.email) FROM users u WHERE u.id = zoom_host_consents.user_id)
);

-- ------------------------------------------------------------------------------
-- 5. What the SECURITY DEFINER entry points may touch (as workspace_definer)
-- ------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON users TO workspace_definer;
GRANT SELECT ON orgs, memberships, invitations TO workspace_definer;
GRANT SELECT, INSERT, UPDATE, DELETE ON outbox TO workspace_definer;
GRANT SELECT, DELETE ON idempotency_keys TO workspace_definer;
GRANT SELECT, UPDATE ON node_rollup_dirty TO workspace_definer;
GRANT SELECT, UPDATE ON integrations TO workspace_definer;
GRANT SELECT, UPDATE ON meetings TO workspace_definer;
GRANT SELECT, INSERT ON zoom_webhook_events TO workspace_definer;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'orgs', 'memberships', 'invitations', 'outbox', 'idempotency_keys',
                           'node_rollup_dirty', 'integrations', 'meetings', 'zoom_webhook_events'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I TO workspace_definer USING (true) WITH CHECK (true)', t || '_definer_policy', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 6. Narrowly privileged entry points. Fixed statements, explicit search_path, no dynamic SQL.
--    EXECUTE is granted to the login roles only (except 6.4); the runtime roles cannot call 6.1-6.3.
--    The full list is asserted by packages/db/src/__tests__/runtime-rls.test.ts.
-- ------------------------------------------------------------------------------

-- 0001's bootstrap function is unused (orgs are created inside the new org's own tenant transaction) and
-- was executable by PUBLIC.
DROP FUNCTION IF EXISTS create_organization_with_owner(varchar, varchar, uuid, varchar, integer, numeric);

-- 6.1 Auth bootstrap (workspace_api). The identity has been verified by the application before the call.

-- Sign-in: find the user by verified email, link missing provider ids, or create the user.
CREATE OR REPLACE FUNCTION sys_auth_upsert_user(p_email text, p_name text, p_supabase_uid text, p_cognito_sub text)
RETURNS SETOF users
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  INSERT INTO users (id, email, name, supabase_uid, cognito_sub)
  VALUES (uuid_generate_v7(), lower(btrim(p_email)), p_name, p_supabase_uid, p_cognito_sub)
  ON CONFLICT (email) DO UPDATE SET
    name = COALESCE(users.name, EXCLUDED.name),
    supabase_uid = COALESCE(users.supabase_uid, EXCLUDED.supabase_uid),
    cognito_sub = COALESCE(users.cognito_sub, EXCLUDED.cognito_sub),
    updated_at = CASE
      WHEN (users.name IS NULL AND EXCLUDED.name IS NOT NULL)
        OR (users.supabase_uid IS NULL AND EXCLUDED.supabase_uid IS NOT NULL)
        OR (users.cognito_sub IS NULL AND EXCLUDED.cognito_sub IS NOT NULL)
      THEN now()
      ELSE users.updated_at
    END
  RETURNING *;
$$;

-- Organization switcher: the caller's own memberships.
CREATE OR REPLACE FUNCTION sys_auth_user_orgs(p_user_id uuid)
RETURNS TABLE (org_id uuid, org_slug varchar, org_name varchar, plan varchar, role varchar, session_epoch integer, joined_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT o.id, o.slug, o.name, o.plan, m.role, m.session_epoch, m.created_at
  FROM memberships m
  JOIN orgs o ON o.id = m.org_id
  WHERE m.user_id = p_user_id
  ORDER BY m.created_at, o.id;
$$;

-- Request bootstrap: resolve an org by id or slug for a user. Members get the org and their membership; for
-- anyone else only the id and slug come back (role NULL), so callers can answer 403 rather than 404.
CREATE OR REPLACE FUNCTION sys_auth_org_membership(p_org text, p_user_id uuid)
RETURNS TABLE (org_id uuid, org_slug varchar, org_name varchar, role varchar, session_epoch integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_org ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN QUERY
      SELECT o.id, o.slug, CASE WHEN m.user_id IS NULL THEN NULL ELSE o.name END, m.role, m.session_epoch
      FROM orgs o LEFT JOIN memberships m ON m.org_id = o.id AND m.user_id = p_user_id
      WHERE o.id = p_org::uuid;
  ELSE
    RETURN QUERY
      SELECT o.id, o.slug, CASE WHEN m.user_id IS NULL THEN NULL ELSE o.name END, m.role, m.session_epoch
      FROM orgs o LEFT JOIN memberships m ON m.org_id = o.id AND m.user_id = p_user_id
      WHERE o.slug = p_org;
  END IF;
END;
$$;

-- Invitation acceptance: the organization behind a (hashed, unguessable) invitation token. Validity is
-- checked by the caller inside that organization's tenant transaction.
CREATE OR REPLACE FUNCTION sys_auth_invitation_org(p_token_hash text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT i.org_id FROM invitations i WHERE i.token = p_token_hash;
$$;

-- 6.2 Worker maintenance across organizations (workspace_worker).

CREATE OR REPLACE FUNCTION sys_outbox_claim(p_worker_id text, p_batch_size integer, p_lease_seconds integer)
RETURNS SETOF outbox
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH claimable AS (
    SELECT c.id
    FROM outbox c
    WHERE c.sent_at IS NULL
      AND (c.locked_at IS NULL OR c.locked_at < now() - make_interval(secs => p_lease_seconds))
    ORDER BY c.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox o
  SET locked_at = now(),
      locked_by = p_worker_id,
      delivery_attempts = o.delivery_attempts + 1
  FROM claimable
  WHERE o.id = claimable.id
  RETURNING o.*;
$$;

CREATE OR REPLACE FUNCTION sys_outbox_mark_delivered(p_id uuid, p_worker_id text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH updated AS (
    UPDATE outbox o
    SET sent_at = now(), locked_at = NULL, locked_by = NULL, last_error = NULL
    WHERE o.id = p_id AND o.locked_by = p_worker_id
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$$;

CREATE OR REPLACE FUNCTION sys_outbox_record_failure(p_id uuid, p_worker_id text, p_error text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH updated AS (
    UPDATE outbox o
    SET locked_at = NULL, locked_by = NULL, last_error = p_error
    WHERE o.id = p_id AND o.locked_by = p_worker_id
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$$;

CREATE OR REPLACE FUNCTION sys_outbox_purge(p_retention_days integer)
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH deleted AS (
    DELETE FROM outbox o
    WHERE o.sent_at IS NOT NULL AND o.sent_at < now() - make_interval(days => p_retention_days)
    RETURNING 1
  )
  SELECT count(*)::integer FROM deleted;
$$;

CREATE OR REPLACE FUNCTION sys_idempotency_purge()
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH deleted AS (
    DELETE FROM idempotency_keys k WHERE k.expires_at < now() RETURNING 1
  )
  SELECT count(*)::integer FROM deleted;
$$;

-- Claims due rollup jobs; the recomputation itself runs per organization as workspace_system.
CREATE OR REPLACE FUNCTION sys_rollup_claim(p_worker_id text, p_limit integer)
RETURNS TABLE (node_id uuid, org_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH to_claim AS (
    SELECT c.node_id
    FROM node_rollup_dirty c
    WHERE c.debounce_until <= now()
      AND (c.locked_at IS NULL OR c.locked_at < now() - interval '60 seconds')
    ORDER BY c.requested_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE node_rollup_dirty d
  SET locked_at = now(), locked_by = p_worker_id
  FROM to_claim
  WHERE d.node_id = to_claim.node_id
  RETURNING d.node_id, d.org_id;
$$;

-- Organizations the Zoom fallback poller scans; the scan itself runs per organization as workspace_system.
CREATE OR REPLACE FUNCTION sys_zoom_poll_orgs()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT i.org_id FROM integrations i WHERE i.provider = 'zoom' AND i.status = 'connected';
$$;

-- Startup recovery sweep: identifiers only; each meeting is then processed in its own organization.
CREATE OR REPLACE FUNCTION sys_meetings_pending_ready(p_limit integer)
RETURNS TABLE (id uuid, org_id uuid, provider_meeting_uuid varchar, connection_generation integer, processing_generation integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT m.id, m.org_id, m.provider_meeting_uuid, m.connection_generation, m.processing_generation
  FROM meetings m
  WHERE m.status = 'ready_for_transcript_retrieval' AND m.skipped = false
  ORDER BY m.created_at ASC
  LIMIT p_limit;
$$;

-- 6.3 Zoom webhook intake (workspace_api; workspace_worker for the fallback poller). Requests are
--     authenticated by the Zoom signature before any call.

-- The active integration (and so the organization) a Zoom account maps to.
CREATE OR REPLACE FUNCTION sys_zoom_account_integration(p_account_id text)
RETURNS TABLE (id uuid, org_id uuid, status varchar, connection_generation integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT i.id, i.org_id, i.status, i.connection_generation
  FROM integrations i
  WHERE i.provider = 'zoom' AND i.account_id = p_account_id AND i.status <> 'disconnected'
  LIMIT 1;
$$;

-- Receipt for an event whose account maps to no organization (no tenant data is created).
CREATE OR REPLACE FUNCTION sys_zoom_record_unmapped_event(p_account_id text, p_event_type text, p_event_id text, p_provider_meeting_uuid text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  INSERT INTO zoom_webhook_events (account_id, event_type, event_id, provider_meeting_uuid)
  SELECT p_account_id, p_event_type, p_event_id, p_provider_meeting_uuid
  WHERE NOT EXISTS (
    SELECT 1 FROM integrations i
    WHERE i.provider = 'zoom' AND i.account_id = p_account_id AND i.status <> 'disconnected'
  )
  ON CONFLICT (account_id, event_type, event_id) DO NOTHING;
$$;

-- app_deauthorized: atomically record the receipt, disconnect the integration (bumping the fencing
-- generation), park waiting meetings and emit the outbox event. Returns the secret reference to delete.
CREATE OR REPLACE FUNCTION sys_zoom_deauthorize(p_account_id text, p_event_id text, p_event_ts timestamptz, p_deauthorized_at text)
RETURNS TABLE (outcome text, org_id uuid, secret_arn varchar)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v integrations%ROWTYPE;
BEGIN
  SELECT * INTO v
  FROM integrations i
  WHERE i.provider = 'zoom' AND i.account_id = p_account_id AND i.status <> 'disconnected'
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO zoom_webhook_events (account_id, event_type, event_id)
    VALUES (p_account_id, 'app_deauthorized', p_event_id)
    ON CONFLICT (account_id, event_type, event_id) DO NOTHING;
    RETURN QUERY SELECT 'ignored_unmapped_account'::text, NULL::uuid, NULL::varchar;
    RETURN;
  END IF;

  IF v.installed_at > p_event_ts THEN
    RETURN QUERY SELECT 'ignored_stale_deauthorization'::text, NULL::uuid, NULL::varchar;
    RETURN;
  END IF;

  INSERT INTO zoom_webhook_events (org_id, account_id, event_type, event_id)
  VALUES (v.org_id, p_account_id, 'app_deauthorized', p_event_id)
  ON CONFLICT (account_id, event_type, event_id) DO NOTHING;

  UPDATE integrations
  SET status = 'disconnected',
      connection_generation = connection_generation + 1,
      last_error_category = 'deauthorized',
      last_error_message = 'Zoom application was uninstalled/deauthorized by customer',
      updated_at = now()
  WHERE id = v.id;

  UPDATE meetings
  SET status = 'connection_requires_reconnection',
      intake_error = 'Zoom integration was deauthorized',
      updated_at = now()
  WHERE org_id = v.org_id
    AND status IN ('waiting_for_transcript', 'pending_consent');

  INSERT INTO outbox (org_id, topic, payload)
  VALUES (
    v.org_id,
    'integration.zoom.deauthorized',
    jsonb_build_object(
      'orgId', v.org_id,
      'accountId', p_account_id,
      'deauthorizedAt', p_deauthorized_at,
      'connectionGeneration', v.connection_generation + 1
    )
  );

  RETURN QUERY SELECT 'deauthorized'::text, v.org_id, v.secret_arn;
END;
$$;

-- 6.4 Tenant-confined helper (workspace_app): the id of the caller's own organization's Zoom integration,
--     needed by Members to create their self-service consent row (integration rows stay Owner/Admin-only).
CREATE OR REPLACE FUNCTION sys_zoom_integration_id_for_tenant()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT i.id
  FROM integrations i
  WHERE i.org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND i.provider = 'zoom'
  LIMIT 1;
$$;

-- Ownership and EXECUTE grants (PostgreSQL grants EXECUTE on new functions to PUBLIC by default).
-- A non-superuser may only hand a function to a role that can create in its schema: granted for the
-- hand-over, revoked right after.
GRANT CREATE ON SCHEMA public TO workspace_definer;
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig, p.proname AS name
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'sys\_%'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO workspace_definer', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO %s',
      fn.sig,
      CASE
        WHEN fn.name LIKE 'sys\_auth\_%' THEN 'workspace_api'
        WHEN fn.name IN ('sys_zoom_account_integration', 'sys_zoom_record_unmapped_event', 'sys_zoom_deauthorize')
          THEN 'workspace_api, workspace_worker'
        WHEN fn.name = 'sys_zoom_integration_id_for_tenant' THEN 'workspace_app'
        ELSE 'workspace_worker'
      END
    );
  END LOOP;
END $$;
REVOKE CREATE ON SCHEMA public FROM workspace_definer;
