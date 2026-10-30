-- ==============================================================================
-- Comments and notifications
--
-- A comment is visible exactly when what it is about is: a task, project or doc the reader can already see under
-- the private-project and client policies. Clients take part in project discussions and doc comments (the one
-- thing they can write), but never see a task's comments, which are the team's working notes.
-- A notification is read only by the person it is for (notifications_tenant_policy, 0001). The person commenting
-- creates notifications for other members, which the send policy below allows; fan-out inserts must not use
-- RETURNING, since the sender can't read the row back.
-- ==============================================================================

DROP POLICY IF EXISTS comments_client_deny_policy ON comments;

CREATE POLICY comments_target_visible_policy ON comments
AS RESTRICTIVE FOR ALL TO workspace_app
USING (
  CASE target_type
    WHEN 'task' THEN NOT (SELECT acting_user_is_client())
      AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = comments.target_id)
    WHEN 'node' THEN EXISTS (SELECT 1 FROM nodes n WHERE n.id = comments.target_id)
    WHEN 'doc' THEN EXISTS (SELECT 1 FROM docs d WHERE d.id = comments.target_id)
    WHEN 'meeting' THEN EXISTS (SELECT 1 FROM meetings m WHERE m.id = comments.target_id)
    ELSE false
  END
);

CREATE POLICY notifications_send_policy ON notifications
FOR INSERT TO workspace_app
WITH CHECK (
  org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = notifications.org_id AND m.user_id = notifications.user_id
  )
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, org_id, created_at DESC);
