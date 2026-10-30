-- Phase 0 (docs/system-design/12-roadmap.md): the web AI helpers count against the organization's monthly AI
-- budget, three indexes the hot queries were missing, and a retention limit for read notifications.

-- ------------------------------------------------------------------------------
-- 1. AI usage from the web app. workspace_api may only act as workspace_app, and RLS hides the ledger from
--    clients (0016), so recording a call and reading the month's spend go through two narrow definer functions.
-- ------------------------------------------------------------------------------
GRANT SELECT, INSERT ON ai_usage_ledger TO workspace_definer;
CREATE POLICY ai_usage_ledger_definer_policy ON ai_usage_ledger TO workspace_definer USING (true) WITH CHECK (true);

-- Records one AI call. The caller (server code) has already resolved the organization from the session.
CREATE OR REPLACE FUNCTION sys_ai_usage_record(
  p_org uuid, p_operation text, p_provider text, p_model text, p_prompt_id text, p_prompt_version text,
  p_input_tokens integer, p_output_tokens integer, p_cost_inr numeric, p_estimated boolean,
  p_duration_ms integer, p_status text, p_error text
)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  INSERT INTO ai_usage_ledger (id, org_id, operation, provider, model, prompt_id, prompt_version, input_tokens,
    output_tokens, cost_inr, estimated, duration_ms, status, error_message)
  VALUES (uuid_generate_v7(), p_org, left(p_operation, 64), left(p_provider, 32), left(p_model, 64),
    left(p_prompt_id, 64), left(p_prompt_version, 32), GREATEST(p_input_tokens, 0), GREATEST(p_output_tokens, 0),
    GREATEST(p_cost_inr, 0), p_estimated, GREATEST(p_duration_ms, 0), p_status, left(p_error, 1000));
$$;

-- The organization's monthly budget and what it has spent this calendar month (UTC), counted the same way as
-- checkBudgetCapacity() in the worker: succeeded calls only.
-- ponytail: UTC month; switch to the organization's own time zone once orgs.time_zone exists (finding D9).
CREATE OR REPLACE FUNCTION sys_ai_month_usage(p_org uuid)
RETURNS TABLE (budget_inr numeric, used_inr numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT o.ai_budget_inr,
         COALESCE((SELECT SUM(l.cost_inr) FROM ai_usage_ledger l
                   WHERE l.org_id = o.id AND l.status = 'succeeded'
                     AND l.created_at >= date_trunc('month', NOW())), 0)
  FROM orgs o WHERE o.id = p_org;
$$;

-- ------------------------------------------------------------------------------
-- 2. Read notifications older than 90 days are deleted by the daily job (finding D14).
-- ------------------------------------------------------------------------------
GRANT DELETE ON notifications TO workspace_definer;
CREATE POLICY notifications_definer_purge_policy ON notifications FOR DELETE TO workspace_definer USING (true);

CREATE OR REPLACE FUNCTION sys_notifications_purge()
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH gone AS (
    DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < NOW() - INTERVAL '90 days' RETURNING 1
  )
  SELECT count(*)::int FROM gone;
$$;

GRANT CREATE ON SCHEMA public TO workspace_definer;
ALTER FUNCTION sys_ai_usage_record(uuid, text, text, text, text, text, integer, integer, numeric, boolean, integer, text, text) OWNER TO workspace_definer;
ALTER FUNCTION sys_ai_month_usage(uuid) OWNER TO workspace_definer;
ALTER FUNCTION sys_notifications_purge() OWNER TO workspace_definer;
REVOKE CREATE ON SCHEMA public FROM workspace_definer;
REVOKE ALL ON FUNCTION sys_ai_usage_record(uuid, text, text, text, text, text, integer, integer, numeric, boolean, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION sys_ai_month_usage(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION sys_notifications_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sys_ai_usage_record(uuid, text, text, text, text, text, integer, integer, numeric, boolean, integer, text, text) TO workspace_api;
GRANT EXECUTE ON FUNCTION sys_ai_month_usage(uuid) TO workspace_api;
GRANT EXECUTE ON FUNCTION sys_notifications_purge() TO workspace_api;

-- ------------------------------------------------------------------------------
-- 3. Indexes (findings D7, D12, D13). Plain CREATE INDEX: tables are small today; use CONCURRENTLY outside a
--    transaction once tasks or activity_log pass ~1M rows.
-- ------------------------------------------------------------------------------
-- Deduplication looks up the nearest open tasks by cosine distance; without this it scans every vector.
CREATE INDEX IF NOT EXISTS idx_task_embeddings_hnsw ON task_embeddings USING hnsw (embedding vector_cosine_ops);
-- The outbox relay only ever reads unsent rows.
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox (created_at) WHERE sent_at IS NULL;
-- A task's, doc's or project's activity list.
CREATE INDEX IF NOT EXISTS idx_activity_log_target ON activity_log (org_id, target_type, target_id, created_at DESC);
