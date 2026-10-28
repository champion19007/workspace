-- ==============================================================================
-- Email notifications and rate limits
--
-- Notifications double as the email queue: emailed_at records that one has gone out by email, so each is
-- emailed at most once. Mentions and new requests are emailed straight away; everything else still unread is
-- gathered into a daily digest. People choose per organization in notification_preferences; no row means
-- everything is on.
-- Emails go out after a request has finished or from the daily job, with no signed-in person, so they read and
-- mark notifications only through the SECURITY DEFINER functions below. So does the rate limiter, which also
-- counts sign-in attempts made before anyone is signed in.
-- ==============================================================================

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_notifications_to_email ON notifications(created_at) WHERE emailed_at IS NULL AND read_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_preferences (
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_mentions boolean NOT NULL DEFAULT true,
  email_requests boolean NOT NULL DEFAULT true,
  email_digest boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_own_policy ON notification_preferences
TO workspace_app
USING (
  org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
)
WITH CHECK (
  org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
);

-- Only the functions below use it; the app roles have no policy and so no rows.
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key varchar(200) NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (key, window_start)
);
ALTER TABLE rate_limit_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_counters FORCE ROW LEVEL SECURITY;

-- What the functions may touch (as workspace_definer).
GRANT SELECT, UPDATE ON notifications TO workspace_definer;
GRANT SELECT, INSERT, UPDATE ON notification_preferences TO workspace_definer;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_counters TO workspace_definer;
-- 0019's policy only let the request form add notifications; the email functions also read and mark them.
ALTER POLICY notifications_definer_policy ON notifications USING (true);
CREATE POLICY notification_preferences_definer_policy ON notification_preferences TO workspace_definer USING (true) WITH CHECK (true);
CREATE POLICY rate_limit_counters_definer_policy ON rate_limit_counters TO workspace_definer USING (true) WITH CHECK (true);

-- Unread mentions and new requests from the last day that haven't been emailed, for people who want them;
-- marks them emailed. At most once: a failed send is logged, and the notification still waits in the app.
CREATE OR REPLACE FUNCTION sys_email_claim_instant(p_limit integer)
RETURNS TABLE (notification_id uuid, org_id uuid, org_name text, user_id uuid, email text, kind text, payload jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH picked AS (
    SELECT n.id
    FROM notifications n
    LEFT JOIN notification_preferences p ON p.org_id = n.org_id AND p.user_id = n.user_id
    WHERE n.emailed_at IS NULL AND n.read_at IS NULL
      AND n.created_at > NOW() - INTERVAL '1 day'
      AND ((n.kind = 'mention' AND COALESCE(p.email_mentions, true))
        OR (n.kind = 'request' AND COALESCE(p.email_requests, true)))
    ORDER BY n.created_at
    LIMIT p_limit
    FOR UPDATE OF n SKIP LOCKED
  )
  UPDATE notifications n SET emailed_at = NOW()
  FROM picked, users u, orgs o
  WHERE n.id = picked.id AND u.id = n.user_id AND o.id = n.org_id
  RETURNING n.id, n.org_id, o.name::text, n.user_id, u.email::text, n.kind::text, n.payload;
$$;

-- Everything else still unread and not emailed, for up to p_limit people: one row per person and organization,
-- newest first. Marks it all emailed so the next digest starts fresh. Looks back two days so a daily job that
-- runs late misses nothing.
CREATE OR REPLACE FUNCTION sys_email_claim_digests(p_limit integer)
RETURNS TABLE (org_id uuid, org_name text, user_id uuid, email text, items jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH due AS (
    SELECT n.id, n.org_id, n.user_id
    FROM notifications n
    LEFT JOIN notification_preferences p ON p.org_id = n.org_id AND p.user_id = n.user_id
    WHERE n.emailed_at IS NULL AND n.read_at IS NULL
      AND n.created_at > NOW() - INTERVAL '2 days'
      AND COALESCE(p.email_digest, true)
  ), people AS (
    SELECT DISTINCT org_id, user_id FROM due LIMIT p_limit
  ), picked AS (
    SELECT n.id, n.org_id, n.user_id, n.payload, n.created_at
    FROM notifications n
    JOIN due ON due.id = n.id
    JOIN people ON people.org_id = n.org_id AND people.user_id = n.user_id
    -- Checked again on the locked row, so two overlapping runs never send the same item.
    WHERE n.emailed_at IS NULL AND n.read_at IS NULL
    FOR UPDATE OF n SKIP LOCKED
  ), marked AS (
    UPDATE notifications n SET emailed_at = NOW() FROM picked WHERE n.id = picked.id
  )
  SELECT picked.org_id, o.name::text, picked.user_id, u.email::text,
         jsonb_agg(picked.payload ORDER BY picked.created_at DESC)
  FROM picked
  JOIN orgs o ON o.id = picked.org_id
  JOIN users u ON u.id = picked.user_id
  GROUP BY picked.org_id, o.name, picked.user_id, u.email;
$$;

-- Turns one kind of email ('mentions', 'requests' or 'digest') on or off: the unsubscribe link in an email,
-- which works without signing in. Does nothing for someone who is no longer a member.
CREATE OR REPLACE FUNCTION sys_set_email_preference(p_org uuid, p_user uuid, p_kind text, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_kind NOT IN ('mentions', 'requests', 'digest') THEN
    RAISE EXCEPTION 'unknown email kind %', p_kind;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = p_org AND m.user_id = p_user) THEN
    RETURN;
  END IF;
  INSERT INTO notification_preferences (org_id, user_id, email_mentions, email_requests, email_digest)
  VALUES (p_org, p_user, p_kind <> 'mentions' OR p_enabled, p_kind <> 'requests' OR p_enabled, p_kind <> 'digest' OR p_enabled)
  ON CONFLICT (org_id, user_id) DO UPDATE SET
    email_mentions = CASE WHEN p_kind = 'mentions' THEN p_enabled ELSE notification_preferences.email_mentions END,
    email_requests = CASE WHEN p_kind = 'requests' THEN p_enabled ELSE notification_preferences.email_requests END,
    email_digest = CASE WHEN p_kind = 'digest' THEN p_enabled ELSE notification_preferences.email_digest END,
    updated_at = NOW();
END;
$$;

-- Counts one hit on p_key in the current fixed window and says whether it is still within p_limit.
-- ponytail: fixed windows let up to twice the limit through around a window boundary; switch to a sliding
-- window (or Redis) if that matters.
CREATE OR REPLACE FUNCTION sys_rate_limit_hit(p_key text, p_window_seconds integer, p_limit integer)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  INSERT INTO rate_limit_counters AS c (key, window_start, count)
  VALUES (left(p_key, 200), to_timestamp(floor(extract(epoch FROM NOW()) / p_window_seconds) * p_window_seconds), 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = c.count + 1
  RETURNING c.count <= p_limit;
$$;

-- Drops counters older than a day (run by the daily job).
CREATE OR REPLACE FUNCTION sys_rate_limit_purge()
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH gone AS (DELETE FROM rate_limit_counters WHERE window_start < NOW() - INTERVAL '1 day' RETURNING 1)
  SELECT count(*)::int FROM gone;
$$;

GRANT CREATE ON SCHEMA public TO workspace_definer;
ALTER FUNCTION sys_email_claim_instant(integer) OWNER TO workspace_definer;
ALTER FUNCTION sys_email_claim_digests(integer) OWNER TO workspace_definer;
ALTER FUNCTION sys_set_email_preference(uuid, uuid, text, boolean) OWNER TO workspace_definer;
ALTER FUNCTION sys_rate_limit_hit(text, integer, integer) OWNER TO workspace_definer;
ALTER FUNCTION sys_rate_limit_purge() OWNER TO workspace_definer;
REVOKE CREATE ON SCHEMA public FROM workspace_definer;
REVOKE ALL ON FUNCTION sys_email_claim_instant(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION sys_email_claim_digests(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION sys_set_email_preference(uuid, uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION sys_rate_limit_hit(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION sys_rate_limit_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sys_email_claim_instant(integer) TO workspace_api;
GRANT EXECUTE ON FUNCTION sys_email_claim_digests(integer) TO workspace_api;
GRANT EXECUTE ON FUNCTION sys_set_email_preference(uuid, uuid, text, boolean) TO workspace_api;
GRANT EXECUTE ON FUNCTION sys_rate_limit_hit(text, integer, integer) TO workspace_api;
GRANT EXECUTE ON FUNCTION sys_rate_limit_purge() TO workspace_api;
