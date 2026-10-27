-- ==============================================================================
-- Client access level
--
-- A client (memberships.role = 'client') is someone outside the organization who follows its work. Like a
-- viewer they can't change anything (enforced by the application), and they only see the projects an Owner
-- or Manager added them to (node_members). Tasks, docs, doc versions, chunks, embeddings and action items
-- are only visible through a visible node (their private-visibility policies select from nodes), so scoping
-- nodes scopes them too. Activity is visible when what it is about is. Organization-wide data that isn't tied
-- to a project (meetings, comments, Zoom) is hidden from clients.
-- Invitations and memberships stay readable: accepting an invitation reads and updates them as the new client.
-- ==============================================================================

ALTER TABLE memberships DROP CONSTRAINT IF EXISTS chk_membership_role;
ALTER TABLE memberships ADD CONSTRAINT chk_membership_role
  CHECK (role IN ('owner', 'admin', 'member', 'viewer', 'client'));
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS chk_invitations_role;
ALTER TABLE invitations ADD CONSTRAINT chk_invitations_role
  CHECK (role IN ('owner', 'admin', 'member', 'viewer', 'client'));

-- Independent of the row being checked: policies call it as (SELECT acting_user_is_client()), which runs once
-- per statement.
CREATE OR REPLACE FUNCTION acting_user_is_client()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m.role = 'client'
  );
$$;

CREATE POLICY nodes_client_scope_policy ON nodes
AS RESTRICTIVE FOR ALL TO workspace_app
USING (
  NOT (SELECT acting_user_is_client())
  OR EXISTS (
    SELECT 1 FROM node_members nm
    WHERE nm.node_id = nodes.id
      AND nm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
);

CREATE POLICY activity_log_client_scope_policy ON activity_log
AS RESTRICTIVE FOR ALL TO workspace_app
USING (
  NOT (SELECT acting_user_is_client())
  OR EXISTS (SELECT 1 FROM nodes n WHERE n.id = activity_log.target_id)
  OR EXISTS (SELECT 1 FROM tasks t WHERE t.id = activity_log.target_id)
  OR EXISTS (SELECT 1 FROM docs d WHERE d.id = activity_log.target_id)
);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meetings', 'meeting_notes', 'transcript_segments', 'extraction_runs', 'ai_usage_ledger',
                           'comments', 'zoom_host_consents', 'zoom_oauth_states',
                           'zoom_poll_checkpoints', 'zoom_webhook_events'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO workspace_app USING (NOT (SELECT acting_user_is_client()))',
      t || '_client_deny_policy', t);
  END LOOP;
END $$;
