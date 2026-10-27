-- ==============================================================================
-- Request forms
--
-- A project can have one public request form. Anyone with its link (a client, another team) can send a request
-- without an account. Requests wait in the Inbox until a team member accepts one, which makes it a task, or
-- declines it. Clients never see forms or requests inside the app.
-- The public side reaches the database only through the two SECURITY DEFINER functions below: they take the
-- form's unguessable token and touch nothing but that form, its project's name and the new request.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS request_forms (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  node_id uuid NOT NULL,
  public_token varchar(64) NOT NULL,
  intro text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_request_forms_token UNIQUE (public_token),
  CONSTRAINT uq_request_forms_node UNIQUE (node_id),
  FOREIGN KEY (org_id, node_id) REFERENCES nodes(org_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES request_forms(id) ON DELETE CASCADE,
  node_id uuid NOT NULL,
  title varchar(200) NOT NULL,
  details text NOT NULL DEFAULT '',
  requester_name varchar(120) NOT NULL,
  requester_email varchar(255) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'new',
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_requests_status CHECK (status IN ('new', 'accepted', 'declined')),
  FOREIGN KEY (org_id, node_id) REFERENCES nodes(org_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_requests_org_status_created ON requests(org_id, status, created_at DESC);

ALTER TABLE request_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_forms FORCE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['request_forms', 'requests'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I TO workspace_app
         USING (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::uuid)
         WITH CHECK (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::uuid)',
      t || '_tenant_policy', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO workspace_app
         USING (NOT (SELECT acting_user_is_client()) AND EXISTS (SELECT 1 FROM nodes n WHERE n.id = %I.node_id))',
      t || '_project_visible_policy', t, t);
  END LOOP;
END $$;

-- What the public entry points may touch (as workspace_definer).
GRANT SELECT ON request_forms, nodes TO workspace_definer;
GRANT INSERT ON requests, notifications TO workspace_definer;
CREATE POLICY request_forms_definer_policy ON request_forms TO workspace_definer USING (true);
CREATE POLICY requests_definer_policy ON requests TO workspace_definer WITH CHECK (true);
CREATE POLICY nodes_definer_policy ON nodes TO workspace_definer USING (true);
CREATE POLICY notifications_definer_policy ON notifications TO workspace_definer WITH CHECK (true);

-- The public form's heading: whose form it is and what it's for. Nothing when the form is switched off.
CREATE OR REPLACE FUNCTION sys_request_form_public(p_token text)
RETURNS TABLE (org_name text, project_name text, intro text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT o.name::text, n.name::text, f.intro
  FROM request_forms f
  JOIN nodes n ON n.id = f.node_id AND n.archived_at IS NULL
  JOIN orgs o ON o.id = f.org_id
  WHERE f.public_token = p_token AND f.enabled;
$$;

-- Records a request sent through the public form and lets the people who look after it know: the form's
-- creator and the organization's Owners and Managers. Returns null when the form doesn't exist or is off.
CREATE OR REPLACE FUNCTION sys_request_submit(p_token text, p_title text, p_details text, p_name text, p_email text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  f record;
  v_id uuid := uuid_generate_v7();
BEGIN
  SELECT rf.id, rf.org_id, rf.node_id, rf.created_by INTO f
  FROM request_forms rf
  JOIN nodes n ON n.id = rf.node_id AND n.archived_at IS NULL
  WHERE rf.public_token = p_token AND rf.enabled;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO requests (id, org_id, form_id, node_id, title, details, requester_name, requester_email)
  VALUES (v_id, f.org_id, f.id, f.node_id, left(p_title, 200), left(p_details, 5000), left(p_name, 120), left(p_email, 255));

  INSERT INTO notifications (id, org_id, user_id, kind, payload, dedupe_key)
  SELECT uuid_generate_v7(), f.org_id, m.user_id, 'request',
         jsonb_build_object(
           'title', 'New request: ' || left(p_title, 120),
           'body', 'From ' || left(p_name, 120),
           'href', '/orgs/' || f.org_id || '/inbox?tab=requests'),
         'request:' || v_id
  FROM memberships m
  WHERE m.org_id = f.org_id AND (m.role IN ('owner', 'admin') OR m.user_id = f.created_by);

  RETURN v_id;
END;
$$;

GRANT CREATE ON SCHEMA public TO workspace_definer;
ALTER FUNCTION sys_request_form_public(text) OWNER TO workspace_definer;
ALTER FUNCTION sys_request_submit(text, text, text, text, text) OWNER TO workspace_definer;
REVOKE CREATE ON SCHEMA public FROM workspace_definer;
REVOKE ALL ON FUNCTION sys_request_form_public(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION sys_request_submit(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sys_request_form_public(text) TO workspace_api;
GRANT EXECUTE ON FUNCTION sys_request_submit(text, text, text, text, text) TO workspace_api;
