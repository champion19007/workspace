-- Stage 17: Human approval of AI suggestions (Requirement N-2)

-- 1. action_items: optimistic concurrency + decision reason/note + compound key for tenant-safe FKs
ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS decision_reason varchar(32),
  ADD COLUMN IF NOT EXISTS decision_note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_action_item_decision_reason') THEN
    ALTER TABLE action_items ADD CONSTRAINT chk_action_item_decision_reason
      CHECK (decision_reason IS NULL OR decision_reason IN ('wrong', 'duplicate', 'not_a_task', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_action_items_org_id') THEN
    ALTER TABLE action_items ADD CONSTRAINT uq_action_items_org_id UNIQUE (org_id, id);
  END IF;
END $$;

-- Approval inbox listing: stable (created_at, id) order per org and state
CREATE INDEX IF NOT EXISTS idx_action_items_org_state_created ON action_items (org_id, state, created_at, id);
-- Spec §10.4 approval inbox ("suggestions for me"): partial on open suggestions only
CREATE INDEX IF NOT EXISTS idx_action_items_inbox_open ON action_items (org_id, suggested_owner_id, created_at, id)
  WHERE state = 'suggested';

-- 2. Approved tasks carry {meetingId, actionItemId, evidenceSeqs} provenance, which exceeds 128 chars
ALTER TABLE tasks ALTER COLUMN source_ref TYPE varchar(1024);

-- 3. Meeting-content visibility predicate (mirrors authorizeMeetingAccess read rules):
--    Owners/Admins: all; routed meetings: active project that is public or has the user as node member;
--    unrouted meetings: the verified host (meetings.host_id) only.
CREATE OR REPLACE FUNCTION can_access_meeting_content(p_org_id uuid, p_meeting_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM meetings m
    WHERE m.org_id = p_org_id
      AND m.id = p_meeting_id
      AND (
        EXISTS (
          SELECT 1 FROM memberships mb
          WHERE mb.org_id = m.org_id
            AND mb.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
            AND mb.role IN ('owner', 'admin')
        )
        OR (m.node_id IS NULL AND m.host_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
        OR EXISTS (
          SELECT 1 FROM nodes n
          WHERE n.org_id = m.org_id
            AND n.id = m.node_id
            AND n.archived_at IS NULL
            AND (
              n.visibility = 'public'
              OR EXISTS (
                SELECT 1 FROM node_members nm
                WHERE nm.node_id = n.id
                  AND nm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
              )
            )
        )
      )
  );
$$;

-- 4. action_items private-project RLS (RESTRICTIVE on top of the existing tenant policy)
DROP POLICY IF EXISTS action_items_private_project_policy ON action_items;
CREATE POLICY action_items_private_project_policy ON action_items
AS RESTRICTIVE
USING (can_access_meeting_content(org_id, meeting_id));

-- 5. Append-only decision log (eval curation; spec §0.1 ADR 09, §11.3 online signals)
CREATE TABLE IF NOT EXISTS action_item_decisions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  action_item_id uuid NOT NULL,
  meeting_id uuid NOT NULL,
  decision varchar(16) NOT NULL,
  reason varchar(32),
  note text,
  proposal_snapshot jsonb NOT NULL,
  applied_values jsonb,
  edit_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  title_edit_distance numeric(5, 4),
  time_to_decision_ms bigint NOT NULL,
  task_id uuid,
  task_operation varchar(16),
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_action_item_decisions_decision CHECK (decision IN ('approve', 'edit', 'reject')),
  CONSTRAINT chk_action_item_decisions_reason CHECK (reason IS NULL OR reason IN ('wrong', 'duplicate', 'not_a_task', 'other')),
  CONSTRAINT chk_action_item_decisions_task_operation CHECK (task_operation IS NULL OR task_operation IN ('created', 'updated')),
  -- One human decision per suggestion (backstop for the row lock + version check)
  CONSTRAINT uq_action_item_decisions_item UNIQUE (org_id, action_item_id),
  FOREIGN KEY (org_id, action_item_id) REFERENCES action_items(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, meeting_id) REFERENCES meetings(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, task_id) REFERENCES tasks(org_id, id) ON DELETE SET NULL (task_id)
);

CREATE INDEX IF NOT EXISTS idx_action_item_decisions_org_decided ON action_item_decisions (org_id, decided_at);
CREATE INDEX IF NOT EXISTS idx_action_item_decisions_meeting ON action_item_decisions (org_id, meeting_id);

ALTER TABLE action_item_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_item_decisions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS action_item_decisions_tenant_policy ON action_item_decisions;
CREATE POLICY action_item_decisions_tenant_policy ON action_item_decisions
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

DROP POLICY IF EXISTS action_item_decisions_private_project_policy ON action_item_decisions;
CREATE POLICY action_item_decisions_private_project_policy ON action_item_decisions
AS RESTRICTIVE
USING (can_access_meeting_content(org_id, meeting_id));

-- Append-only for the runtime role (cascading deletes from meetings/action_items still apply)
GRANT SELECT, INSERT ON action_item_decisions TO workspace_app;
REVOKE UPDATE, DELETE ON action_item_decisions FROM workspace_app;
