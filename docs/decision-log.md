# Workspace v1 — Architecture Decision & Contradiction Log

This document records architectural decisions, resolved contradictions, and unverified assumptions identified in the system specification ("Workspace v1 — Engineering Design Doc", Jan 2027 Launch).

---

## ADR 01: Email Magic Link vs. Email OTP Terminology

- **Identified Contradiction**:
  - Section 0.1 (ADR 08) and Section 2.1 (Requirement W-1) state: *"Passwordless auth (Google OIDC + email magic link)"*.
  - Section 3.1 (Architecture A diagram), Table 3.1, and Section 8.2 state: *"passwordless email OTP"*.
- **Impact**:
  - Email magic links require universal link handling and browser state handoff across mobile/desktop, while 6-digit OTP codes require an input screen but avoid email client link-stripping issues.
- **Resolution**:
  - The `Auth` port interface in `packages/core` defines an abstracted passwordless login flow (`requestPasswordless(email)` and `verifyPasswordless({ email, codeOrToken })`).
  - Architecture A (Supabase Auth) supports both OTP codes and magic links via its underlying auth service.
  - Architecture B (Cognito) implements email OTP via Custom Auth Challenges or Cognito User Pool managed login.
  - The frontend shell supports entering a 6-digit code or clicking a magic link token seamlessly. Neither domain logic nor API contracts depend on whether an email delivered a tokenized link or a numeric code.

---

## ADR 02: In-Region 5-Minute RPO vs. Regional Disaster 24-Hour RPO

- **Identified Contradiction**:
  - Section 1.3 (SLO Table) lists: `RPO: 5 min` and `RTO: 4 h`.
  - Section 9.2 (Table 9.2 Backup and Recovery Targets) specifies:
    - *Aurora (in-region)*: Continuous backup, PITR 14 days $\rightarrow$ RPO ~5 min, RTO < 1 h.
    - *Aurora (regional disaster)*: AWS Backup daily copy to `ap-south-2` $\rightarrow$ RPO 24 h, RTO 4 h.
- **Impact**:
  - A regional disaster (catastrophic failure of `ap-south-1`) relying on daily snapshot replication cannot mathematically guarantee a 5-minute RPO.
- **Resolution**:
  - Clarified and formalized recovery targets:
    - **In-Region High Availability & AZ Outage**: RPO $\le$ 5 minutes, RTO < 1 hour via Aurora Multi-AZ storage replication across 3 AZs and automated Point-In-Time-Recovery (PITR).
    - **Cross-Region Catastrophic Disaster (`ap-south-1` $\rightarrow$ `ap-south-2`)**: RPO $\le$ 24 hours, RTO $\le$ 4 hours via automated daily snapshot copy through AWS Backup Vault Lock. Aurora Global Database (which would provide sub-minute cross-region RPO) is explicitly deferred past beta to stay within cost limits (< ₹150/active user/month).

---

## ADR 03: AI Model Availability and India Inference Profiles

- **Identified Assumptions**:
  - Section 8.3 references *Claude Haiku 4.5* (fast tier), *Claude Sonnet 5* (strong tier), *Titan Text Embeddings V2* (1024-dim), and Bedrock *India geographic cross-Region inference profile*.
- **Impact**:
  - Specific model versions and inference profile ARNs depend on AWS Bedrock release availability in `ap-south-1` and `ap-south-2`.
- **Resolution**:
  - Domain logic in `packages/core` must **never** reference model version strings or provider IDs directly.
  - The `LLM` port defines model tiers (`'fast'` and `'strong'`) and structured request objects:
    ```typescript
    complete<T>(req: {
      promptId: string;
      tier: 'fast' | 'strong';
      input: unknown;
      schema: ZodSchema<T>;
    }): Promise<T>;
    ```
  - The adapters (`AnthropicLLM` for Architecture A and `BedrockLLM` for Architecture B) resolve model tiers to exact provider IDs via environment configuration (`BEDROCK_FAST_MODEL_ID`, `BEDROCK_STRONG_MODEL_ID`, `BEDROCK_INDIA_INFERENCE_PROFILE_ARN`).
  - Contract and integration tests execute against configurable test stubs and verify schema parsing independently of upstream model availability.

---

## ADR 04: Database Connection Pooling Constraints

- **Identified Constraints**:
  - Section 3.2: Supabase transaction pooler (PgBouncer/Supavisor on port 6543) requires `SET LOCAL` within a transaction; session-level state is lost between queries.
  - `pg-boss` (used for Architecture A async jobs) relies on PostgreSQL session features (`LISTEN`/`NOTIFY`, advisory locks `pg_try_advisory_xact_lock` / `pg_advisory_lock`), which fail or cause pinning in transaction pooling mode.
  - Section 7.1 / 7.3: AWS RDS Proxy in Architecture B similarly pins connections if session-level `SET` commands or advisory locks are executed outside transactions.
- **Resolution**:
  - Implement two distinct database connection channels across the application:
    1. **`DATABASE_URL` (API Connection Pool)**: Configured for transaction pooler mode. Pool size capped at 10 connections per container instance. Used by `apps/api`. All tenant isolation operates via transaction-scoped `SET LOCAL app.org_id = :org_id`.
    2. **`DATABASE_DIRECT_URL` (Worker & Migration Connection Pool)**: Configured for direct session mode (port 5432). Pool size capped at 5 connections per container instance. Used by `apps/worker` for `pg-boss` job loops and outbox polling.
  - Prevents connection pool starvation and eliminates connection pinning warnings.

---

## ADR 05: DPDP Act 2023 & Rules 2025 Legal Compliance Baseline

- **Identified Claims**:
  - Section 14.4 cites the Digital Personal Data Protection (DPDP) Rules notified in November 2025 with substantive obligations applying from 13 May 2027.
- **Status & Approach**:
  - Rather than treating compliance as a future retrofit, the system establishes a privacy-by-design architecture from Day 1:
    - **Data Fiduciary / Data Processor Separation**: Explicit Data Processing Agreement (DPA) structure where the customer org is Data Fiduciary.
    - **180-day Default Retention**: Automated nightly purge job cascades across `meetings`, `transcript_segments`, `chunks`, vector embeddings, and raw VTT storage objects.
    - **Strict Data Subject Erasure**: Asynchronous erasure cascading deletes all associated chunks, embeddings, and attachments with cryptographic receipt generation.
    - **Zero Model Training**: Contractual guarantee and technical constraint—customer data is processed only in-context with temperature 0; Bedrock and Anthropic API enterprise terms prohibit model training on customer payloads.

---

## ADR 06: Multi-Tenant Row-Level Security (RLS) & Connection Pool Hygiene

- **Context & Security Goals**:
  - In a shared-schema multi-tenant architecture, data confidentiality across organizations must be strictly guaranteed. An application bug in an API endpoint must never allow tenant A to read or mutate tenant B's data.
- **Architectural Implementation**:
  1. **Restricted Runtime Role**: Applications connect using `workspace_app` (`NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS`). The table owner role is reserved solely for migrations and administrative maintenance.
  2. **Mandatory & Forced RLS**: All 22 tenant-owned tables execute `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;` and `ALTER TABLE <table> FORCE ROW LEVEL SECURITY;`.
  3. **Policy Architecture (Permissive Tenant Baseline + Restrictive Visibility Gates)**:
     - Each tenant table defines a `PERMISSIVE` tenant policy: `USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)`.
     - In PostgreSQL RLS, if no permissive policy exists on a table, default-deny blocks all rows. The tenant policy serves as the single permissive gateway scoped strictly to the session's `app.org_id`.
     - Tables with sub-organization privacy constraints (`nodes`, `tasks`, `docs`, `doc_versions`, `chunks`) layer an `AS RESTRICTIVE` policy: `(visibility = 'public' OR user is in node_members OR user is org owner/admin)`.
     - In PostgreSQL, effective access requires `(PERMISSIVE) AND (ALL RESTRICTIVE)`. This mathematically guarantees that private project data can never leak even within an organization, and no cross-org data can ever be read.
  4. **Connection Pool Hygiene**:
     - `withTenantContext` sets `set_config('app.org_id', :orgId, true)` (where `is_local = true` scopes the variable strictly to the transaction duration).
     - Upon transaction commit or rollback, the setting automatically reverts to empty string.
     - Integration tests prove that when a pooled connection is subsequently reused without setting context, queries return 0 rows (fail closed).
  5. **Immutability of `org_id`**:
     - Trigger `prevent_org_id_mutation()` runs `BEFORE UPDATE OF org_id ON tasks, nodes, docs, meetings`.
     - Any attempt to reassign existing entities across organizations is rejected with an exception.

---

## ADR 07: Entity Invariants, Subtask Depth & Compound Foreign Key Integrity

- **Context & Invariants**:
  - Entities must maintain strict relational integrity across organizations without orphan or cross-tenant references.
  - Tasks must support at most one level of subtasks, prevent self-parenting, and ensure subtasks belong to the same project as their parent.
- **Architectural Implementation**:
  1. **Application-Owned UUIDv7**:
     - Schema tables use UUIDv7 with time-ordered monotonic prefixes.
     - PL/pgSQL function `uuid_generate_v7()` provides native database defaults, while `@workspace/core` provides TypeScript generator `generateUuidV7()`.
  2. **Compound Foreign Keys for Multi-Tenancy**:
     - Instead of naive single-column foreign keys, child tables enforce compound foreign keys:
       - `tasks`: `FOREIGN KEY (org_id, project_id) REFERENCES nodes(org_id, id)`
       - `node_members`: `FOREIGN KEY (org_id, node_id) REFERENCES nodes(org_id, id)` and `FOREIGN KEY (org_id, user_id) REFERENCES memberships(org_id, user_id)`
       - `doc_versions`: `FOREIGN KEY (org_id, doc_id) REFERENCES docs(org_id, id)`
     - This makes cross-tenant foreign key relationships structurally impossible at the database engine level.
  3. **Subtask Hierarchy Guarantees**:
     - Compound foreign key `FOREIGN KEY (org_id, project_id, parent_task_id) REFERENCES tasks(org_id, project_id, id)` guarantees subtasks belong to the same organization AND project as their parent task.
     - Check constraint `chk_task_no_self_parent CHECK (parent_task_id IS NULL OR parent_task_id != id)` prevents self-parenting.
     - Trigger `check_subtask_hierarchy()` verifies that parent tasks are not themselves subtasks, and that parents with subtasks cannot be converted into subtasks, enforcing a strict 1-level tree depth.
  4. **Date vs. Timestamp Distinction**:
     - Deadlines (`due_date`, `suggested_due`) are stored as `date` (date-only) without timestamp conversion.
     - Creation, modification, and meeting start times use `timestamptz` (stored in UTC).
  5. **Hybrid Search & Vector Dimensions**:
     - `chunks` table integrates PostgreSQL `tsvector` generated column (`to_tsvector('english', content)`) with GIN index.
     - High-dimensional vector column `embedding vector(1024)` indexed with HNSW cosine distance (`vector_cosine_ops`), matching Amazon Titan Text Embeddings V2 baseline.
---

## ADR 08: Passwordless Authentication, BFF Encrypted Server Sessions & session_epoch Immediate Revocation

- **Context & Requirements**:
  - Requirement W-1 mandates passwordless authentication with Google OIDC and email magic link for Architecture A (Supabase Auth).
  - Decision: Magic link is the initial email experience required by W-1; OTP is reserved as a documented alternative. Password authentication is explicitly excluded.
  - Strict token isolation: identity provider tokens (access tokens, refresh tokens) must never touch browser `localStorage`, `sessionStorage`, client responses, or React page props.
  - Secure 30-day rolling sessions with explicit expiration, refresh rotation, and immediate revocation upon role demotion or membership termination.
  - Tenant context must never be trusted from unverified client headers (`x-org-id`), but resolved strictly from authenticated path parameters verified against PostgreSQL memberships.

- **Architectural Implementation**:
  1. **Backend-For-Frontend (BFF) Session Design**:
     - The browser holds a single `httpOnly`, `SameSite=Lax`, `Secure` (in production) cookie named `workspace_session`.
     - The cookie payload is encrypted server-side using Authenticated AES-256-GCM (`@workspace/core` crypto module). The secret never leaves the server runtime.
     - Decryption failure, ciphertext tampering, or expiration returns `null` immediately.
  2. **30-Day Rolling Window & Controllable Clock Verification**:
     - Sessions carry `createdAt` and `expiresAt` timestamps initialized to a 30-day window (`SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000`).
     - Rolling refresh is triggered automatically when the session is accessed and more than 1 hour has elapsed (`SESSION_ROLLING_REFRESH_THRESHOLD_MS = 3600000`).
     - Tests verify rolling behavior and expiration using controllable virtual clocks in `ControllableMockAuthAdapter` and `auth-bff.test.ts`.
  3. **Immediate Revocation via `session_epoch`**:
     - Each membership row in PostgreSQL carries a `session_epoch` integer (defaults to `1`).
     - When an administrator modifies a user's role (`updateOrganizationMemberRole`) or removes a member (`removeOrganizationMember`), the database atomically increments `memberships.session_epoch = memberships.session_epoch + 1`.
     - Fastify's `requireOrgContext` pre-handler compares the caller's session epoch against the active membership table row. If the session epoch is stale, it immediately rejects the request with HTTP 401 `UnauthorizedError ("Session has been revoked or permissions have changed")` within a single request, without waiting for the 30-day cookie or token TTL to expire.
  4. **BFF-to-API Cryptographic Authentication**:
     - When the Next.js BFF communicates with Fastify, it signs the internal request with an HMAC-SHA256 signature containing `userId`, `email`, and a millisecond timestamp: `x-workspace-signature`.
     - Fastify's auth hook validates the HMAC signature using constant-time comparison (`crypto.timingSafeEqual`) and enforces a 5-minute maximum clock skew window to prevent replay attacks.
  5. **Role Hierarchy & Invariant Enforcement**:
     - Enforces strict hierarchy: `Owner (4) > Admin (3) > Member (2) > Viewer (1)`.
     - Admins cannot invite or elevate users to `Owner`, nor demote or remove other Admins.
     - Atomic database checks prevent demoting or removing the final `Owner` of an organization (`ValidationError: Cannot remove/demote the final Owner`).
  6. **Secure Invitation Lifecycle**:
     - High-entropy invitation tokens generated cryptographically (`crypto.randomBytes(32)`).
     - Raw tokens are delivered in invitation links but stored in PostgreSQL only as SHA-256 hashes (`token_hash`) with a 7-day expiration.
     - Acceptance requires the signed-in user's verified email to match the invited email, preventing invite token hijacking.

---

## 4. Stage 4 — Application Shell & Shared Interface

- **Date**: 2026-10-05
- **Status**: Accepted & Implemented
- **Context**: Workspace v1 requires a unified desktop and mobile interface reflecting the dark charcoal aesthetics of reference screenshots `Screenshot (927).png` through `Screenshot (958).png`. The UI must adhere to WCAG 2.1 AA accessibility guidelines, support customizable accent colors, feature persistent navigation, and provide comprehensive views across projects, tasks, boards, teams, documents, meetings, and member management.

- **Key Architectural Decisions**:
  1. **Charcoal Surfaces & WCAG Contrast Rules**:
     - Root Canvas: `#0d0f12`, Sidebar: `#0b0d10`, Panels/Cards: `#14171e`, Inset wells: `#101319`, Subtle borders: `#222633`.
     - Default Accent: `#d86dfc` (orchid/magenta). Relative luminance $\approx 0.33$.
     - Contrast Analysis: White text (`#ffffff`) on `#d86dfc` yields only $2.78:1$ contrast (fails WCAG AA 4.5:1). Dark charcoal text (`#0d0614`) yields $7.53:1$ (exceeds WCAG AAA 7:1).
     - Decision: All solid buttons and active pill badges filled with `--accent` dynamically compute and render dark text (`#0d0614`).
  2. **Dynamic Theming with `localStorage` Persistence**:
     - `ThemeProvider` manages the `--accent`, `--accent-foreground`, and `--accent-muted` CSS variables.
     - Automatically recalculates relative luminance and selects the compliant foreground (`#0d0614` vs. `#ffffff`).
     - Stored under `workspace_accent_color`. Includes presets (`#d86dfc` Orchid, `#38bdf8` Sky, `#34d399` Emerald, `#f43f5e` Rose, `#fbbf24` Amber, `#818cf8` Indigo) and an instant "Reset to Default" action.
  3. **Shell Navigation & Responsive Layout**:
     - Desktop persistent sidebar fixed at `320px` (`w-80`) with organization switcher dropdown, `Ctrl+K` command launcher, Personal section (`Home`, `My Tasks`, `Inbox`), Workspace section (`Teams`, `Projects`, `Documents`, `Meetings`, `Members`), Daily Focus reminder card, and bottom user menu pill.
     - Responsive mobile drawer toggled via top bar hamburger menu button.
     - Horizontal project view switcher pills: `Dashboard`, `List`, `Board`, `Documents`, `Meetings` with active pill in solid accent.
  4. **Keyboard Accessibility & Focus Trapping**:
     - Registered global shortcuts: `Ctrl+K`/`Cmd+K` (Command Launcher), `Shift+?` (Shortcuts dialog), `Escape` (Dismiss modal/drawer), `Shift+D` (Dashboard), `Shift+L` (Task List), `Shift+B` (Kanban Board), `Alt+M` (My Tasks), `Alt+Shift+T` (Teams).
     - Shortcuts are automatically suppressed when user focus is in input fields, textareas, selects, or contenteditable elements.
     - Drawers and dialogs manage and restore focus and support Escape cancellation.
  5. **Feature Scope & P1 Guardrails**:
     - Preserved future Ask AI layout (Screenshot 943) behind an explicit `P1` preview badge and notification banner, avoiding premature backend complexity before Stage 21.
     - Strictly avoided introducing unapproved features (e.g. paid billing gateways, calendar integrations, dependency graphs) merely because they appeared in sample screenshots.

---

## 5. Stage 5 — Shared API Conventions, Outbox & Background Infrastructure

- **Date**: 2026-10-05
- **Status**: Accepted & Implemented
- **Context**: Workspace v1 requires a hardened, standardized REST API foundation, Architecture A adapters, transactional outbox pattern, optimistic concurrency control (OCC), PostgreSQL-backed idempotency, and background-worker infrastructure before implementing feature domains.

- **Key Architectural Decisions**:
  1. **Strict 9-Step Request Pipeline**:
     - Organization-scoped routes follow `/api/v1/orgs/{orgSlug}/...` prefix.
     - Enforces strict sequential validation: authenticate -> resolve user -> resolve org -> check membership/role -> validate input -> `withTenantContext` -> permissions -> execute domain -> return response.
     - Never trust client-supplied `org_id` or user ID as authorization.
  2. **RFC 9457 Problem Details (`application/problem+json`)**:
     - Standardized error schema (`type`, `title`, `status`, `detail`, `instance`, `code`, `invalidParams`).
     - Omits raw database error messages, credentials, and private customer transcripts from all error payloads.
     - Swagger UI and OpenAPI 3.1 schema generated at `/documentation`.
  3. **Optimistic Concurrency Control (OCC)**:
     - All mutable resources track an integer `version` incremented atomically on write.
     - Canonical strong ETags (`ETag: "v<version>"`) per RFC 9110 (amended in Stage 7 / ADR 10 to strictly require canonical strong ETags `"v<version>"` without weak `W/` prefix, enforcing RFC 9110 strong comparison).
     - Mutations require `If-Match`. If missing, returns `428 Precondition Required`; if mismatching or weak, returns `412 Precondition Failed` with current entity state in details.
  4. **PostgreSQL Idempotency Keys**:
     - Architecture A uses table `idempotency_keys` with compound unique index on `(org_id, actor_id, key)`.
     - Request fingerprinting using SHA-256 (`METHOD:URL:JSON_BODY`).
     - State handling: `in_flight` returns 409 Conflict; `fingerprint_mismatch` returns 422 Unprocessable Content.
     - Replay re-verifies caller's active organization membership and role before returning cached response.
  5. **Rate Limiting**:
     - Enforces 600 req/min per user and 6,000 req/min per org via `@fastify/rate-limit`.
     - Returns HTTP 429 with `Retry-After` header.
  6. **Architecture A Adapters**:
     - Queue: `PgBossQueueAdapter` behind `QueuePort` on direct connection (`DATABASE_DIRECT_URL`).
     - Realtime: `SupabaseRealtimeAdapter` behind `RealtimePort` broadcasting lightweight change hints.
     - BlobStore: `SupabaseBlobStoreAdapter` behind `BlobStorePort` with 5-minute signed URLs.
     - LLM: `AnthropicLlmAdapter` behind `LLMPort` (`claude-3-5-haiku-latest`, `claude-3-7-sonnet-latest`) with schema-validated structured outputs and bounded repair loops.
  7. **Transactional Outbox & Worker Relay**:
     - Domain mutations and outbox events written in same local transaction.
     - Background worker claims batches using `SELECT ... FOR UPDATE SKIP LOCKED` without inter-worker blocking.
     - Exponential backoff with lease timeout recovery.
     - Automated background retention purge deleting delivered outbox events older than 7 days and expired idempotency keys.


---

## 6. Stage 6 — Organization, Team & Project Tree Architecture, Stable Materialized ltree Paths, and Deadlock-Safe Subtree Movement

- **Date**: 2026-10-06
- **Status**: Accepted & Implemented
- **Context**: Workspace v1 organizes teams and projects into an arbitrarily nested hierarchy where organizations are the root, teams can nest under teams, and projects are leaf nodes that own tasks, documents, and meetings. Requirement W-3 mandates that moving a 500-node subtree commits in a single transaction in < 500 ms using PostgreSQL `ltree`. Private projects require zero-leakage confidentiality.

- **Key Architectural Decisions**:
  1. **Hierarchy Rules & Allowed Root Placement**:
     - `orgs` is the tenant root. `nodes` represents both teams (`kind = 'team'`) and projects (`kind = 'project'`).
     - Allowed root placement: Only teams can have `parent_id = NULL`. Projects MUST have an active parent team (`parent_id != NULL`).
     - Leaf invariant: Projects cannot have child nodes (`parent_id` cannot reference a node with `kind = 'project'`). Enforced via database checks and Zod schema validations.
     - Arbitrary depth: Teams may nest under teams to arbitrary depth without artificial level caps.
  2. **Stable Materialized `ltree` Path Labels**:
     - Path labels are derived strictly from stable UUIDs (`uuidToLtreeLabel(id) = id.replace(/-/g, '_')`), NEVER from user-mutable display names.
     - Renaming a team updates only that single node's `name` and bumps `version`—descendant paths remain completely untouched, ensuring O(1) rename performance.
  3. **Deadlock-Safe, Atomic Subtree Movement (Requirement W-3)**:
     - Cycle Prevention: Moving node A beneath destination B is rejected immediately if B is a descendant of A (`dest.path <@ source.path`), returning RFC 9457 HTTP 422 Unprocessable Content.
     - Deterministic Row Locking: In PostgreSQL, updating multiple rows across concurrent transactions can deadlock if locked in arbitrary order. Subtree moves acquire row locks in deterministic ID order:
       `SELECT id FROM nodes WHERE org_id = $1 AND path <@ $2 ORDER BY id ASC FOR UPDATE;`
     - Atomic Path Rewrite: All descendant paths are rewritten in a single vectorized SQL query using PostgreSQL's `||` and `subpath()` functions.
     - Chunks / Document Path Synchronization: Related tables carrying materialized `node_path` (such as `chunks`) are atomically synchronized in the same transaction using `ltree` ancestor `<@` matching and `subpath()` rewriting.
     - Outbox Event: Emits `node.moved` with old and new paths and affected node count in the same transaction.
     - Verified Benchmark: 500 nodes moved atomically in ~437 ms, well under the 500 ms requirement.
  4. **Private Project Zero-Leakage Confidentiality**:
     - Private projects (`visibility = 'private'`) are strictly restricted to assigned members (`node_members`), organization Owners, and organization Admins.
     - Non-member requests fail closed with HTTP 404 Not Found (rather than 403 Forbidden) to eliminate existence leakage.
     - Filtered from tree queries (`/tree`), project directories (`/projects`), and rollup counts for unauthorized users.
     - Adding/removing members in `node_members` grants or revokes project access immediately.
  5. **Safe Deletion vs. Cascade Archiving**:
     - Deleting a team that contains active child nodes is rejected with HTTP 409 Conflict to prevent accidental orphan creation.
     - Specifying query parameter `archive=true` executes a cascade archiving of the node and all its descendants (`archived_at = NOW()`) in a single atomic transaction.
  6. **Optimistic Concurrency Control (OCC)**:
     - Nodes maintain an integer `version` incremented on every mutation.
     - Mutations require matching `If-Match` header or version payload; stale requests are rejected with HTTP 412 Precondition Failed.
  7. **Screenshot-Grounded UI Architecture**:
     - **Teams Screen (`/orgs/[orgId]/teams`)**: Split directory layout matching Screenshot 942. Left panel features hierarchical collapsible tree with status indicators, search filter, and "New Team/Project" buttons. Right panel displays selected node overview, `ltree` path breadcrumb, quick actions (Create Child, Move Subtree, Rename/Edit, Delete/Archive), direct descendants list, and private project member management.
     - **Projects Screen (`/orgs/[orgId]/projects`)**: Project directory matching Screenshot 941. Grid card layout showing project cards, visibility badges, parent team tags, updated timestamps, search, and team filters.


---

## 7. Stage 7 — Task Management, Atomic Key Sequences, Strong ETag Concurrency Contract and One-Level Subtask Invariant (Requirement W-4)

- **Date**: 2026-10-06
- **Status**: Accepted & Implemented
- **Context**: Workspace v1 requirement W-4 mandates task creation, editing, assignment, date-only deadlines with Asia/Kolkata timezone awareness, labels, strictly one level of subtasks, atomic task keys without gaps or collisions (e.g., `CORE-142`), and reliable concurrent-edit protection.

- **Key Architectural Decisions & Invariant Enforcements**:
  1. **Strict Strong ETag Concurrency Contract (RFC 9110)**:
     - All canonical task representations provide a strong entity tag: `ETag: "v<version>"`.
     - In accordance with RFC 9110 Section 13.1.1, strong comparison is required for all state-changing operations (`PATCH`, `DELETE`).
     - Weak entity tags (e.g., `W/"v1"`) are rejected immediately with HTTP 412 Precondition Failed (`code: PRECONDITION_FAILED`); weak comparison prefixes are NEVER stripped.
     - Missing `If-Match` header on mutating requests is rejected with HTTP 428 Precondition Required (`code: PRECONDITION_REQUIRED`).
     - Precondition mismatch returns HTTP 412 Precondition Failed with RFC 9457 problem details containing `details: { ...currentEntity }`, only after verifying that the caller has active read permission for the project.
     - Database updates perform atomic check-and-increment (`WHERE id = :id AND version = :expectedVersion RETURNING ...`), returning 412 if 0 rows are updated.
  2. **Atomic, Gap-Free Task Key Allocation (`project_key_counters`)**:
     - Task keys follow the format `<PREFIX>-<INTEGER>` (e.g., `CORE-1`, `ENG-142`).
     - Key prefixes are configured per-project on `nodes.key_prefix` (defaults to uppercase alpha prefix derived from project name, or `TASK`).
     - Sequence allocation uses a dedicated table `project_key_counters` with row-level locking:
       `INSERT INTO project_key_counters (org_id, project_id, next_val) VALUES ($1, $2, 2) ON CONFLICT (org_id, project_id) DO UPDATE SET next_val = project_key_counters.next_val + 1 RETURNING (next_val - 1) AS allocated_val;`
     - Eliminates race conditions, gaps, and duplicate keys even under 10+ concurrent writers.
  3. **Strict One-Level Subtask Hierarchy**:
     - Subtasks point to a parent task via `parent_task_id`.
     - Subtasks cannot have subtasks of their own (arbitrary nesting is disallowed).
     - When creating a subtask, the database acquires a row lock on the parent (`SELECT id, parent_task_id FROM tasks WHERE ... FOR UPDATE`). If `parent.parent_task_id IS NOT NULL`, the operation is rejected with HTTP 422 Unprocessable Content (`Subtasks cannot have subtasks. Maximum hierarchy depth is 1.`).
     - Check constraint `chk_task_no_self_parent` and compound foreign key `(org_id, project_id, parent_task_id)` guarantee parent and subtask reside in the exact same organization and project.
  4. **Date-Only Deadlines & Asia/Kolkata Timezone Awareness**:
     - Deadlines are stored strictly as PostgreSQL `date` (`YYYY-MM-DD`), avoiding UTC timestamp conversions that shift calendar dates across timezones.
     - String inputs must strictly match calendar date regex `^\d{4}-\d{2}-\d{2}$` and pass valid calendar day checks (e.g., rejecting February 30). Timestamp strings or ISO 8601 strings with time components are rejected with HTTP 422.
     - User interface displays formatted dates and computes relative urgency badges (Today, Tomorrow, Overdue, Due in X days) grounded in India Standard Time (`Asia/Kolkata`, UTC+05:30).
  5. **Zero-Leakage Confidentiality on Private Projects**:
     - Non-members of private projects attempting to read, create, update, or delete tasks or allocate keys receive HTTP 404 Not Found (never 403 or 412).
     - Querying `/projects/:projectId/tasks` for an unauthorized user returns 404 Not Found rather than an empty 200 list, eliminating existence leakage.
  6. **Role Enforcement**:
     - Users with the `viewer` organization role cannot create, edit, or archive tasks, returning HTTP 403 Forbidden.
  7. **Provenance Integrity**:
     - Client requests cannot forge AI provenance (`ai_suggested`, `sourceRef`). Requests with client-supplied source fields are rejected with HTTP 422.
  8. **Transactional Outbox Events**:
     - Every task operation transactionally writes outbox events: `task.created`, `task.updated`, `task.assigned`, `task.archived`.
  9. **Web Interface & Conflict Resolution UX**:
     - Task table matching Screenshot 928 with search, status/priority filters, inline status toggling, and subtask counters.
     - `TaskDetailDrawer` matching Screenshot 942/Stage 4 drawer aesthetic.
     - Real-time OCC conflict handling: when a 412 is received, the drawer preserves the user's uncommitted edits, displays a side-by-side conflict banner with the server's updated values, and provides one-click options to "Overwrite (apply my changes)" or "Discard & reload server version".

---

## 8. Stage 8 — Task Views (Board, List, My Tasks), Base-62 Fractional Ordering, Atomic 1-Row Move, Collation Invariants, and My Tasks Identity Isolation (Requirement W-5)

- **Date**: 2026-10-06
- **Status**: Accepted & Implemented
- **Context**: Workspace v1 requirement W-5 mandates the complete task-view experience: Project Kanban Board matching Screenshot 929, Project Task List matching Screenshot 928, and Organisation-wide My Tasks matching Screenshot 938. Task ordering must be persisted via base-62 fractional indexing, normal moves must update exactly one row in the `tasks` table, and concurrent edits must be safeguarded with strong RFC 9110 preconditions (`If-Match`).

- **Key Architectural Decisions & Invariant Enforcements**:
  1. **Base-62 Fractional Indexing (`fractional-indexing` 4.0.0)**:
     - Ordering is persisted via variable-length base-62 strings (`0-9A-Za-z`) using the `fractional-indexing` library pinned at `4.0.0` in `@workspace/core`.
     - Initial rank is generated as `'a0'` (`generateKeyBetween(null, null)`).
     - Successive insertions at column end use `generateRankBetween(lastRank, null)` (`'a1'`, `'a2'`, etc.).
     - Interstitial drops between neighbouring cards use `generateRankBetween(prevRank, nextRank)`.
  2. **Database Collation Invariant (`COLLATE "C"`)**:
     - *Issue*: Standard PostgreSQL UTF-8 collations sort lowercase before uppercase (`'a'` < `'Z'`), while JavaScript's ASCII `<` operator and Base-62 fractional indexing require strict code-point ordering (`'0' < '9' < 'A' < 'Z' < 'a' < 'z'`).
     - *Resolution*: Migration `0005_stage8_task_views.sql` migrated `tasks.rank` to `varchar(128) COLLATE "C" NOT NULL DEFAULT 'a0'` and created indexes with `COLLATE "C"`:
       `idx_tasks_project_status_rank` on `(project_id, status, rank COLLATE "C", id)`.
     - *Verification*: Integration tests proved 100% agreement between database queries (`ORDER BY rank COLLATE "C" ASC, id ASC`) and browser JavaScript array sorting (`compareRanks`).
  3. **Atomic 1-Row Move Invariant**:
     - Every normal card move touches and updates **exactly one row in the `tasks` table** (`status`, `rank`, `version = version + 1`, `updated_at`).
     - Neighbouring tasks are locked `FOR UPDATE` within the tenant transaction to prevent race conditions, but their rows, ranks, and versions remain completely untouched.
     - Never triggers table-wide re-indexing or sequential renumbering.
     - Outbox table receives a separate `task.moved` transactional event.
  4. **Concurrent Gap Coordination**:
     - When two clients concurrently drop tasks into the exact same gap between tasks A and B, the transaction verifies the gap dynamically: if an intermediate task was already placed, the second move allocates a new rank between the intermediate task and boundary rather than colliding or aborting.
     - Strict monotonicity is guaranteed; ranks never collide.
  5. **Precondition Contract Enforcement**:
     - Moving a task requires the strong `If-Match` header.
     - Missing `If-Match` returns HTTP 428 Precondition Required (`PRECONDITION_REQUIRED`).
     - Precondition version mismatch returns HTTP 412 Precondition Failed (`PRECONDITION_FAILED`) containing the fresh task entity for client reconciliation.
  6. **Dense Rank Maintenance (`isDenseRank`)**:
     - `MAX_RANK_LENGTH = 32`. When repeated subdivisions produce a rank longer than 32 characters, the move transaction records a `tasks.dense_rank_detected` outbox event.
     - Dedicated maintenance endpoint `POST /api/v1/orgs/:orgSlug/projects/:projectId/columns/:status/rebalance` and `rebalanceColumnRanks` operation rebalances the column using `ORDER BY rank COLLATE "C" ASC, id ASC FOR UPDATE` back to clean, short base-62 ranks while strictly preserving order.
  7. **My Tasks Security & Authenticated Identity Isolation**:
     - Endpoint `GET /api/v1/orgs/:orgSlug/me/tasks` strictly resolves the assignee identity from `request.user.id` (authenticated session identity).
     - Query parameters such as `?userId=...` are strictly ignored/rejected, eliminating cross-user impersonation and surveillance.
     - Private project confidentiality: Tasks in private projects are hidden from callers who are not explicit members of that project (unless Org Owner/Admin).
     - Subtasks: Assigned subtasks appear in My Tasks alongside top-level tasks, enriched with parent task context (`parentKey`, `parentTitle`) and project context (`projectName`, `projectKeyPrefix`).
     - Category filters (`all`, `pending`, `overdue`, `dueToday`, `upcoming`) and live category counts are evaluated with date-only comparisons in `Asia/Kolkata` (UTC+05:30).
  8. **Screenshot-Grounded UI Architecture**:
     - **Kanban Board (`/orgs/[orgId]/board` and `/orgs/[orgId]/projects/[projectId]/board`)**: Matches Screenshot 929. Three columns (`To Do`, `In Progress`, `Completed`), status indicator dots with glow shadows, genuine column counters, Add Task quick actions with column preselection, HTML5 drag-and-drop with optimistic card updates and automatic rollback on 412, accessible keyboard action menus, drag guards when non-manual sorting is active, and `TaskDetailDrawer` integration.
     - **My Tasks Screen (`/orgs/[orgId]/my-tasks`)**: Matches Screenshot 938. Interactive category filter chips with live counts, search and filter bar, project badges, subtask indicators, inline status checkboxes, and drawer inspection.
     - **Project List Screen (`/orgs/[orgId]/projects/[projectId]/tasks`)**: Matches Screenshot 928. Reset filters action, responsive table shell, priority badges, and empty state.

---

## 9. Stage 9 — Health Rollups, Deterministic Status Thresholds, Generational Invalidation, Project Dashboard, and Leadership SQL-Parity Reporting (Requirements W-6 and W-7)

- **Date**: 2026-10-06
- **Status**: Accepted & Implemented
- **Context**: Workspace v1 requirements W-6 and W-7 mandate permission-safe health rollups for projects and ancestor teams, a project dashboard matching Screenshot 927, and a leadership dashboard matching Screenshots 935–937 with exact direct-SQL parity for summary counters and at-risk task drilldowns across permitted projects.

- **Key Architectural Decisions & Invariant Enforcements**:
  1. **Deterministic Counting Semantics & Clear Headline Units**:
     - Headline project completion percentage is calculated strictly using **top-level tasks**:
       `completionPercentage = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100)`.
     - Subtasks are tracked, measured, and stored in a separate counter structure (`subtasks: { total, open, completed }`).
     - Subtasks **never pollute the headline task denominator**, eliminating double-counting between parent tasks and child subtasks.
     - Archived tasks (`archived_at IS NOT NULL`) and archived projects are strictly excluded from all counters.
  2. **Overdue Subtask Propagation to Risk Calculation**:
     - Subtask overdue states propagate directly to the project's risk calculations.
     - An unfinished subtask (`status != 'done'`) whose `due_date < dateContext` marks the project as `at_risk`, even if the parent task is marked `done` or completed early.
     - Completed tasks and completed subtasks (`status = 'done'`) are never overdue, regardless of their past deadline.
  3. **Strict Deterministic Health Thresholds (No LLMs)**:
     - Health status calculation is 100% deterministic, reproducible, and verifiable via pure functions:
       - `no_tasks`: Active top-level tasks + active subtasks === 0.
       - `at_risk`: Total overdue count > 0 (top-level or subtasks).
       - `needs_attention`: Total due-soon count > 0 (due between today and today + 7 calendar days inclusive).
       - `on_track`: Active work exists with zero overdue and zero due-soon items.
  4. **Timezone Awareness & Calendar Date Boundaries (`Asia/Kolkata`)**:
     - All date arithmetic (`getKolkataTodayDateString()`, `addCalendarDays()`) uses India Standard Time (`Asia/Kolkata`, UTC+05:30).
     - Due dates are stored as PostgreSQL `date` types without timestamps, preventing date shifts across UTC boundaries.
     - Cached rollups store `dateContext: YYYY-MM-DD` in their provenance metadata. If read on a subsequent calendar day, the rollup is automatically invalidated and recomputed dynamically.
  5. **Permission-Safe Team Rollups & Zero-Leakage Private Project Confidentiality**:
     - Team nodes do not store a single static rollup that could leak private project data to unauthorized users.
     - Reading a team summary dynamically sums rollups across **only leaf projects accessible to the requesting user** (`visibility = 'public'` OR user in `node_members` OR user is Org Owner/Admin).
     - Unauthorized users querying private project dashboards directly receive HTTP 404 Not Found (zero existence leakage).
  6. **Durable Generational Invalidation (`node_rollup_dirty`) & Debounce Watermarking**:
     - Migration `0006_stage9_health_rollups.sql` established the `node_rollup_dirty` table with row-level security and `(org_id, debounce_until)` indexing.
     - Task mutations (`createTask`, `updateTask`, `moveTask`, `archiveTask`) and subtree movements (`moveSubtree`) automatically climb `ltree` ancestry and call `markNodesDirty`.
     - Monotonically increasing `dirty_generation` counter prevents race conditions: if a mutation arrives while a recomputation is calculating, the dirty record's generation is bumped past `targetGeneration`, ensuring the node remains dirty for the next pass.
     - Synchronous read-path checks `node_rollup_dirty` to guarantee immediate freshness without waiting for background debounce workers.
  7. **Direct-SQL Parity for Leadership Dashboard (Screenshots 935–937)**:
     - Endpoint `GET /api/v1/orgs/:orgSlug/leadership/summary` provides summary metrics (`totalProjects`, `totalTasks`, `overdueCount`, `unassignedCount`, `atRiskProjects`, `averageCompletionPercentage`) that exactly match direct SQL aggregation across permitted projects.
     - Filter toolbar supports filtering by ancestor `teamId`, `health` status (`at_risk`, `needs_attention`, `on_track`, `no_tasks`), and search term.
     - At-risk drilldown returns overdue and unassigned tasks with full project, team, and assignee context.
  8. **Project Dashboard Experience (Screenshot 927)**:
     - Endpoint `GET /api/v1/orgs/:orgSlug/projects/:projectId/dashboard` returns project metadata, fresh permission-safe rollup, and recent real activity from `activity_log`.
     - Frontend UI matches Screenshot 927: orchid left-border accent hero card (`#d86dfc`), health status badges, interactive SVG completion ring, 4-metric summary strip, progress/velocity distribution, and real recent activity feed with actor avatars.

---

## 10. Stage 10 — Documents, Autosave Coordination, Immutable Snapshots, and 30-Version Retention (Requirement N-3)

- **Date**: 2026-10-06
- **Status**: Accepted & Implemented
- **Context**: Workspace v1 requirement N-3 mandates an authoritative Markdown document editor and repository with 1-second autosave, concurrent edit collision protection via RFC 9110 strong ETags, an immutable snapshot revision history with atomic retention of the latest 30 versions, monotonic restore semantics, role-safe permissions, and private-project zero-leakage confidentiality matching Screenshot 934.

- **Key Architectural Decisions & Invariant Enforcements**:
  1. **Authoritative Markdown Storage & Schema Model**:
     - Persisted Markdown in PostgreSQL `docs.body_md` is the sole authoritative document format; arbitrary external storage, drive integrations, and file upload services are strictly avoided.
     - Migration `0007_stage10_docs.sql` added audit metadata (`created_by`, `updated_by`, `archived_at`), compound foreign keys, and performant indexes on `docs` and `doc_versions`.
     - Document schema adheres to modular monolith conventions, enforcing bounds: `MAX_DOC_TITLE_LENGTH = 500`, `MAX_DOC_CONTENT_LENGTH = 500_000` (~500 KB Markdown text), and `MAX_RETAINED_VERSIONS = 30`.
  2. **Hierarchy Placement & Node Ownership**:
     - Every document belongs to exactly one organization (`org_id`) and exactly one active team or project node (`node_id`).
     - Documents can be created directly under team nodes (for team-wide documentation, onboarding, policies) or project nodes (for specifications, meeting notes, requirements).
  3. **Private Project Zero-Leakage Confidentiality**:
     - Documents under private project nodes (`nodes.visibility = 'private'`) are strictly restricted to assigned project members (`node_members`), organization Owners, and organization Admins.
     - Any request by an unauthorized user to retrieve, update, restore, or archive a private document returns **HTTP 404 Not Found** (never 403 or 412), guaranteeing complete elimination of existence leakage.
     - Document listings (`/docs` and `/nodes/:nodeId/docs`) automatically filter out inaccessible private project documents for the requesting user.
  4. **Role Authorization Matrix**:
     - Organization Owners, Admins, and Members have read/write access to permitted documents.
     - Users with the `viewer` organization role have read-only access. Any attempt by a viewer to create, update, restore, or archive a document is rejected with **HTTP 403 Forbidden**.
  5. **1-Second Autosave Coordinator & Generation Watermarking**:
     - The frontend editor (`DocEditor.tsx`) coordinates background autosaving using an inactivity timer of 1000 ms.
     - Rapid keystrokes debounce without triggering redundant network requests.
     - *Generation Tracking*: Uses incrementing draft counters (`draftGenRef` and `submittedGenRef`). If the user continues typing while a network save is in flight, the editor does not overwrite the in-flight response or drop keystrokes; upon completion, it buffers the new edits in memory and schedules a follow-up save after the 1000 ms debounce.
     - Accurate status indicators: `Saved` (green check), `Saving...` (spinner), `Unsaved` (amber pulse), `Conflict` (warning), and `Save failed` (retry action).
     - *Unload Protection*: Listens for `beforeunload` events when unsaved edits remain in memory, warning the user against accidental tab closures. Drafts remain in-memory only (unencrypted `localStorage` caching is avoided for confidential document security).
  6. **Strong OCC Concurrency Contract (RFC 9110 Strong ETags & If-Match)**:
     - All canonical document representations provide a strong entity tag: `ETag: "v<version>"`.
     - In accordance with RFC 9110 Section 13.1.1, strong comparison is required for all state-changing operations (`PATCH`, `DELETE`, and restore `POST`).
     - Missing `If-Match` header returns **HTTP 428 Precondition Required**.
     - Weak entity tags (e.g., `W/"v1"`) return **HTTP 412 Precondition Failed**.
     - Version mismatch returns **HTTP 412 Precondition Failed** with RFC 9457 problem details containing `currentEntity` and the server's fresh `ETag` header.
     - When receiving a 412, the frontend preserves the user's uncommitted in-memory draft, displays an interactive conflict banner, and provides clear resolution paths: "Overwrite (keep my changes)" or "Discard my edits & load server".
  7. **No-Op Save Protection**:
     - If a save request is submitted with identical title and content to the current database record, the transaction recognizes the no-op, returns the current document without bumping the integer `version`, and writes zero new snapshots to `doc_versions` or the outbox.
  8. **Immutable Snapshots & 30-Version Retention Limit**:
     - Version 1 is automatically created in `doc_versions` upon document creation.
     - Every state change that modifies title or body writes an immutable snapshot to `doc_versions` with the new monotonic integer version.
     - Snapshots are strictly append-only and cannot be updated.
     - *Atomic Pruning*: The system strictly retains the latest 30 versions (`MAX_RETAINED_VERSIONS = 30`). When version 31 is committed, the oldest snapshot (version 1) is automatically pruned in the same transaction using PostgreSQL windowing (`OFFSET 30`). Pruning is completely idempotent and guarantees that version history never exceeds 30 snapshots per document.
     - Listing versions returns up to 30 retained snapshots ordered descending by version. Requests for pruned versions return **HTTP 404 Not Found**.
  9. **Monotonic Version Restore Semantics**:
     - Restoring a retained historical snapshot copies its title and Markdown content into a **NEW monotonic version** (e.g., restoring Version 1 when the document is at Version 3 produces Version 4 containing Version 1's content).
     - Restoring never overwrites, decrements, or deletes existing historical snapshots.
     - Outbox table receives a transactional `doc.restored` event.
  10. **Markdown Rendering Security (XSS Immunity & Zero dangerouslySetInnerHTML)**:
      - Raw HTML execution is strictly barred: rendering avoids `dangerouslySetInnerHTML`.
      - Built a pure React element AST renderer (`SafeMarkdownView.tsx`) that renders headings, paragraphs, lists, task checklists, blockquotes, inline formatting, code blocks, and links safely.
      - Input is sanitized using `sanitizeMarkdown`, which strips `<script>`, `<style>`, `<iframe>`, `<object>`, inline event handlers (`onload`, `onerror`), and dangerous URI schemes (`javascript:`, `vbscript:`, `data:`).
  11. **Privacy & Redaction Contract**:
      - Markdown document bodies (`body_md`) are strictly excluded from structured request logs, activity log payloads, and outbox event payloads.
      - Outbox events emit lightweight change notifications containing only `{ docId, version, title, nodeId }`.
  12. **Screenshot 934 Grounded UI Architecture**:
      - **Documents Library (`/orgs/[orgId]/docs` and `/orgs/[orgId]/projects/[projectId]/docs`)**: Matches Screenshot 934. Card grid showing document titles, excerpts, version chips (`v1`), team/project node tags, timestamps, creator/updater avatars, search bar, team/project filter dropdown, New Document modal, and soft-delete archive confirmation.
      - **Document Editor (`/orgs/[orgId]/docs/[docId]` and `/orgs/[orgId]/projects/[projectId]/docs/[docId]`)**: Header with live title editing, version tag, autosave status indicator, view mode toggle (`Editor`, `Preview`, `Split`), formatting toolbar, full-height markdown editor, live safe preview, and status footer.
      - **Version History Drawer (`DocHistoryDrawer.tsx`)**: Slide-out right drawer listing retained snapshots with timestamps and authors, read-only preview mode, and one-click restore confirmation dialog.

---

## 11. Stage 11 — Zoom Account Connection, Credential Lifecycle, and Host Opt-In (Requirement M-1)

- **Date**: 2026-10-06
- **Status**: Accepted & Implemented
- **Context**: Workspace v1 requirement M-1 establishes the foundation for the transcript-only meeting intelligence engine: an admin-managed Zoom General App with account-level OAuth authorization for customer accounts, credential lifecycle management, multi-tenant isolation, managed secret store security, near-expiry refresh coordination with generation fencing, host opt-in consent controls, and an administrative interface matching Screenshots 944 and 946–948.

- **Key Architectural Decisions & Invariant Enforcements**:
  1. **Integration Model & Least-Privilege Granular Scope Inventory**:
     - Customer connection uses an admin-managed Zoom General App with account-level OAuth authorization (`/oauth/authorize` and `/oauth/token`).
     - Scopes strictly confined to read-only metadata required for transcript-only ingestion:
       - `recording:read:admin`: Reading cloud recording and transcript download URLs.
       - `meeting:read:admin`: Reading meeting metadata (topics, start times, durations, recurrence).
       - `user:read:admin`: Resolving authorized Zoom account details, host identities, and email mappings.
     - Out of scope: meeting bots, audio streaming (RTMS), Zoom Webhook ingestion, transcript text downloading, and task generation (deferred to later stages).
  2. **Multi-Tenant Single Active Organization Invariant**:
     - At most ONE active Workspace organization per Zoom account (`provider = 'zoom'`, partial unique index `uq_integrations_active_provider_account` on `(provider, account_id) WHERE (status != 'disconnected')`).
     - If an administrator attempts to connect a Zoom account already connected to another Workspace organization, the API immediately rejects the request with **HTTP 409 Conflict** (`ConflictError`).
  3. **Role Authorization Matrix**:
     - Only organization Owners and Admins can initiate (`POST /authorize`), complete OAuth callback (`POST /callback`), disconnect (`DELETE /`), or toggle host processing overrides (`PATCH /hosts/:zoomUserId`).
     - Organization Members and Viewers have read-only visibility into connection status and host consent listings, and receive **HTTP 403 Forbidden** on any mutation attempts.
  4. **Cryptographic Single-Use State & PKCE Handshake**:
     - Authorize requests generate a cryptographically random, 64-character hex state token and PKCE SHA-256 code challenge (`S256`), persisted in `zoom_oauth_states` with a 10-minute expiry (`expires_at`), tenant organization ID, initiating user ID, and callback redirect URI.
     - Callback execution atomically consumes and deletes the state record (`DELETE ... RETURNING *`). Replay attempts or expired states fail with **HTTP 400 Bad Request** / **HTTP 422**.
  5. **Managed Secret Store Token Isolation (Zero Plaintext Tokens in DB)**:
     - Plaintext access tokens and refresh tokens are **never** stored in database tables or application logs.
     - Access tokens, refresh tokens, token types, expiry timestamps, and granted scopes reside strictly in the managed Secret Store (`SecretStorePort` / AWS Secrets Manager / Encrypted Store), referenced in PostgreSQL only by an opaque `secret_arn` string (`zoom:<orgId>`).
     - Redaction filters (`redactor.ts`) strip OAuth codes, PKCE `code_verifier`, and `client_secret` from structured logs.
  6. **Near-Expiry Automated Refresh Coordinator & Distributed Locking**:
     - Tokens are refreshed whenever validity is within the final 5 minutes (`expires_at - 300s`).
     - PostgreSQL transactional advisory locks (`pg_try_advisory_xact_lock(hashtext('zoom_refresh:' || orgId))`) serialize refresh attempts across distributed workers.
     - Double-checked locking prevents redundant upstream Zoom refresh calls.
     - *Connection Generation Fencing*: `integrations.connection_generation` increments on every connect/reconnect/disconnect. Background refresh workers guard their updates with `WHERE connection_generation = ${expectedGen}`, preventing stale workers from overwriting fresher credentials.
     - *Revocation / Invalid Grant Handling*: If Zoom returns `invalid_grant` or token revocation, the integration automatically transitions to `needs_reauthorization`, clears error state, and emits an `integration.zoom.degraded` transactional outbox event.
  7. **Clean Disconnect & Secret Purge Lifecycle**:
     - Disconnecting an integration best-effort revokes the token with Zoom, purges the stored secret payload from the Secret Store immediately, bumps `connection_generation`, updates status to `disconnected`, and writes an `integration.zoom.disconnected` event to the outbox.
  8. **Host Discovery & Explicit Host Opt-In Consent Model**:
     - During initial connection, active Zoom account hosts are automatically discovered and populated into `zoom_host_consents` with status `'unknown'`.
     - Explicit host-level consent (`'opted_in' | 'opted_out' | 'unknown'`) tracks consent policy version and timestamp.
     - Administrators have an emergency kill-switch (`admin_disabled: boolean`) per host.
     - Shared domain evaluator (`evaluateMeetingEligibility`): Meeting processing is strictly gated: connection must be active, host must be `opted_in`, `admin_disabled` must be `false`, and meetings with external participants require explicit guest consent.
  9. **Visual Design Grounding (Screenshots 944, 946–948)**:
     - **Integration Card (`ZoomIntegrationCard.tsx`)**: Matches Screenshot 944. Displays Zoom badge, account name/email, connection status chip (`Connected`, `Needs Reconnect`, `Not Connected`), last refreshed timestamp, and Disconnect/Configure actions.
     - **Host Settings Drawer (`ZoomHostDrawer.tsx`)**: Matches Screenshots 946–948. Slide-out drawer with host search bar, status filter tabs (`All`, `Opted In`, `Opted Out`, `Pending`), host rows with email/name, consent status badges, admin disable toggle switches, and opt-in guidance banner.

---

## 12. Stage 12 — Secure Zoom Webhook Intake, Deauthorization Handling, and the Thirty-Minute Polling Fallback (Requirements M-2 & M-4)

- **Date**: 2026-10-06
- **Status**: Accepted & Implemented
- **Context**: Requirements M-2 and M-4 establish reliable, cryptographically secure event intake and durable meeting metadata persistence for Zoom recordings. This foundation precedes Stage 13 transcript retrieval and normalization, and Stage 14 AI project routing and extraction.

- **Key Architectural Decisions & Invariant Enforcements**:
  1. **Public Webhook Boundary & Cryptographic Verification**:
     - Dedicated public endpoint `POST /webhooks/zoom` authenticated independently of browser sessions.
     - Authenticates exclusively via `x-zm-signature` HMAC-SHA256 (`v0:{timestamp}:{raw request body}`) using the configured `ZOOM_WEBHOOK_SECRET_TOKEN`.
     - Raw body captured before JSON parsing via Fastify raw body parser plugin.
     - Timestamp skew strictly enforced within ±300 seconds (5 minutes) using `x-zm-request-timestamp`. Request timestamps (in seconds) are strictly disambiguated from milliseconds `event_ts`.
     - Timing-safe signature comparison (`crypto.timingSafeEqual`) after validating signature prefix (`v0=`) and 64-character hex length to prevent timing oracle attacks.
  2. **Endpoint URL Validation Challenge (`endpoint.url_validation`)**:
     - Responds synchronously with `{ plainToken, encryptedToken }` in under 3 seconds.
     - Encrypted token computed via HMAC-SHA256 hex digest of `plainToken` using the webhook secret.
     - Supports recurring validation checks without disrupting background ingestion.
  3. **Event Schema & Transactional Receipt Deduplication**:
     - Supported events: `endpoint.url_validation`, `recording.completed`, `recording.transcript_completed`, `app_deauthorized`.
     - Idempotent intake receipts stored in `zoom_webhook_events` with unique constraint on `(account_id, event_type, event_id)`.
     - Duplicate webhook deliveries return HTTP 200 `{ received: true, status: 'already_processed' }` without duplicating meeting records or flooding the outbox.
  4. **Strict Zero Credential & Temporary URL Leakage Invariant**:
     - Temporary download tokens, `download_url`, and `play_url` are strictly stripped and **never** persisted in `meetings`, `zoom_webhook_events`, transactional outbox payloads, or application logs.
     - Sensitive fields registered in `PINO_REDACT_PATHS` (`download_url`, `play_url`, `download_token`, `plainToken`, `encryptedToken`, `signature`, `x-zm-signature`).
  5. **Meeting Identity & Monotonic State Transitions**:
     - Meetings uniquely keyed on `(org_id, provider, provider_meeting_uuid)`. Reused numeric meeting IDs across recurring instances remain strictly distinct rows.
     - Monotonic state transition guard (`canTransitionMeetingStatus`): Delayed out-of-order `recording.completed` events cannot regress advanced states (`ready_for_transcript_retrieval`).
     - Tombstones for opted-out hosts remain in `skipped` state and never emit downstream extraction outbox events.
  6. **Durable Deauthorization Handling (`app_deauthorized`)**:
     - When Zoom sends `app_deauthorized`, the integration is immediately marked `disconnected`.
     - Connection credentials in the managed secret store are purged.
     - `connection_generation` is incremented to invalidate stale background workers.
     - Meetings awaiting transcripts under that connection generation transition to `connection_requires_reconnection`.
  7. **Thirty-Minute Fallback Poller (`ZoomRecordingPoller`)**:
     - Standalone background runner in `apps/worker` querying active Zoom integrations every 30 minutes.
     - Serialized per-organization via PostgreSQL transactional advisory locks (`pg_try_advisory_xact_lock(hashtext('zoom_poll:' || orgId))`).
     - Computes incremental scan window with safe 2-hour overlap and persists forward timestamps in `zoom_poll_checkpoints`.
     - Rechecks pending meetings (`waiting_for_transcript`) to discover newly processed transcript files.
     - Emits `meeting.transcript_ready` outbox event upon transitioning to `ready_for_transcript_retrieval`.
  8. **Truthful UI Exposure & RBAC**:
     - Meetings page (`/orgs/[orgId]/meetings`) displays authentic database records with filter toolbar (`Ready for Retrieval`, `Waiting for Transcript`, `Pending Consent`, `Skipped`, `Failed`) and search.
     - `MeetingDetailDrawer.tsx` presents verified metadata, UUID copy action, intake reason alerts, and a manual "Re-evaluate Meeting Intake" retry button.
     - Role-based authorization: Owners and Admins view all organization meetings; Members view only meetings they verified as host.
     - Explicit UI boundary: Truthfully communicates that transcript text retrieval and speaker normalization begin in Stage 13; zero fabricated AI notes or extractions are rendered.

---

## 13. Stage 13 — Authenticated Transcript Retrieval, Normalization, Stable Evidence Anchors, and Meeting Skip Cleanup (Requirements M-2 & M-4)

- **Date**: 2026-10-07
- **Status**: Accepted & Implemented
- **Context**: Completes the transcript-ingestion portion of Requirement M-2 and establishes the artifact-cleanup portion of Requirement M-4. Connects intake events to a durable background worker consumer, performs authenticated transcript retrieval, deterministic WebVTT parsing and normalization into canonical segments with immutable evidence anchors, strict consent gating, and atomic meeting skip with comprehensive data purge and generation fencing.

- **Key Architectural Decisions & Invariant Enforcements**:
  1. **Durable Worker Consumer & Generation Fencing**:
     - Dedicated background handler `handleTranscriptReadyJob` in `apps/worker` subscribing to `meeting.transcript_ready` via `QueuePort` and `OutboxRelay`.
     - Generation fencing on both `connection_generation` and `processing_generation`: an attempt whose generation does not match the active integration connection or current meeting record aborts immediately without committing results.
     - Worker startup recovery sweep (`recoverReadyMeetings`): Scans pending meetings in `ready_for_transcript_retrieval` state that were delivered prior to worker startup or interrupted during execution, ensuring zero dropped meetings.
  2. **Comprehensive Consent Gating Prior to Download**:
     - Pre-flight eligibility evaluation via `evaluateMeetingEligibility` prior to downloading or consuming provider resources.
     - Enforces that the integration is connected, connection generation matches, host is verified and explicitly opted in, workspace admin override is not active, meeting is not marked as excluded/skipped, transcript retention deadline has not expired, and guest-consent requirements are strictly verified (`absent`, `consented`, `unknown`, `pending`).
     - Invariant: A default `false` on `guests_present` cannot be treated as verified absence if guest status is `unknown` or external guests were detected.
  3. **Authenticated Download & Ephemeral Token Handling**:
     - HTTPS-only download enforcement with manual redirect handling in `HttpZoomClientAdapter`.
     - Strips `Authorization: Bearer` header on cross-origin redirects (e.g. from `api.zoom.us` to S3 presigned storage URLs) to prevent credential leakage.
     - 50MB maximum file size guard.
     - WebVTT header/content verification rejecting HTML login pages.
     - Max 3 retries with exponential backoff on 429/5xx errors.
     - Ephemeral token invariant: Download tokens and URLs are strictly ephemeral in memory and never stored in PostgreSQL, outbox messages, queue payloads, or logs.
  4. **Private Source Preservation & Blob Storage**:
     - Uploads raw WebVTT content to `BlobStorePort` at `raw-transcripts/{orgId}/{meetingId}/{attemptId}.vtt`.
     - Calculates SHA-256 checksum and exact byte count.
     - Calculates 180-day retention deadline (`now() + 180 days`).
     - Compensation logic: On transactional commit failure, newly uploaded blob is immediately deleted from blob store.
  5. **Deterministic WebVTT Normalization & Stable Evidence Anchors**:
     - Deterministic parser in `packages/core/src/zoom/vtt-normalizer.ts`: strips voice tags (`<v Name>`), cleans multiline whitespace, normalizes timestamps to milliseconds.
     - Merges adjacent runs by same speaker when timestamp gap $\le 2000$ms while preserving exact wording.
     - Multi-file chronological offset alignment based on `recordingStart`.
     - Immutable 1-based sequential integers `seq` assigned to each segment as stable evidence anchors for Stage 15 AI extraction.
     - SHA-256 checksum per segment (`sha256(text)`).
  6. **Atomic Commit & Outbox Event**:
     - Short transaction verifies meeting generation and eligibility, deletes existing segments for idempotency, inserts normalized segments, updates meeting status to `transcript_ready`, sets `version = version + 1`, and emits `meeting.transcript_ingested` into outbox.
  7. **Strong If-Match OCC Meeting Skip & Purge (`POST .../meetings/:meetingId/skip`)**:
     - Fastify API and Next.js BFF require strong ETag in `If-Match: "v<version>"`. Missing -> 428 Precondition Required; weak/mismatch -> 412 Precondition Failed.
     - Increments `processing_generation` to immediately fence in-flight worker attempts.
     - Purges database `transcript_segments`, `meeting_notes`, and `action_items`.
     - Deletes raw transcript blob from `BlobStorePort`.
     - Sets `cleanup_status = 'completed'`, `cleaned_up_at = now()`, `raw_transcript_object_key = NULL`.
     - Emits `meeting.skipped` event to transactional outbox.
  8. **Truthful UI & Drawer**:
     - Extended `MeetingDetailDrawer.tsx` displays live normalized transcript segments with evidence anchor pills (`[#seq]`), speaker labels, formatted timestamps (`00:01:23`), copy anchor links, and client search filter.
     - Skip & Purge confirmation modal with warning and reason input.
     - Status badges: `Transcript Ready`, `Ready for Retrieval`, `Waiting for Transcript`, `Pending Host Consent`, `Skipped & Purged`.
     - Strict boundary: Speaker user identity resolution and project routing are strictly deferred to Stage 14.

---

## 14. Stage 14 — Speaker Resolution, Permission-Safe Project Routing, and Host Decision Controls (Requirements M-3 & M-4)

- **Date**: 2026-10-07
- **Status**: Accepted & Implemented
- **Context**: Completes requirement M-3 (Speaker identification and Permission-safe Project Routing) and the user decision controls of requirement M-4. Resolves speaker identities without altering immutable evidence anchors, fences routing behind duration/speaker cost gates, enforces strict permission boundary on candidate projects, runs prompt-injection-defended fast-tier LLM routing with a non-negotiable 0.70 confidence threshold for automated routing, provides non-blocking AskHost fallback and OCC-guarded manual routing, and establishes host self-service consent controls.

- **Key Architectural Decisions & Invariant Enforcements**:
  1. **Evidence Source Immutability**:
     - Stable 1-based sequential integers `seq`, timestamps, and original speaker labels produced in Stage 13 are strictly preserved.
     - Identity resolution only populates `user_id`, `resolution_method`, and `resolution_confidence` columns in `transcript_segments` and separate `speaker_resolution_metadata` on the meeting record.
     - Transcript text and original utterances are never rewritten or mutated.
  2. **Multi-Phase Speaker Resolution**:
     - Zoom past-meeting participant adapter queries `GET /v2/past_meetings/{meetingUUID}/participants` with pagination and double-encoded UUID support (`encodeZoomMeetingUuid`).
     - Phase 1: Matches verified participant emails to active Workspace users in the same organization (`email_verified`, confidence 1.0).
     - Phase 2: For unresolved display names, queries fast LLM tier (`resolve.speakers`, temperature 0) providing only a finite candidate set of existing permitted Workspace users in the organization and sample transcript segments. Any returned ID is validated against this candidate set.
     - Unmatched speakers (external guests, contractors, missing emails) are explicitly marked `unresolved` (confidence 0, `user_id = null`).
     - Invariant: Zero speculative user creation. Workspace user accounts, memberships, or email invitations are never automatically created from participant data.
     - Manual override: Authorized host or admin can manually map speaker labels via `POST /api/v1/orgs/:orgSlug/meetings/:meetingId/speakers` (`resolution_method = 'manual'`).
  3. **Cost and Processing Gates Prior to LLM Execution**:
     - Pre-LLM cost gate evaluator (`checkRoutingCostGates`) inspects meeting metrics before calling model:
       - Meeting duration < 3 minutes (180 seconds), OR
       - Fewer than 2 distinct speakers detected.
     - Failing meetings are immediately transitioned to `skipped`, with explicit recorded reason (`Meeting duration < 3 minutes`, `Meeting has fewer than 2 distinct speakers`), activity logged, and background artifact cleanup initiated.
  4. **Strict Permission-Filtered Project Candidate Set**:
     - Routing principal (verified host user or org admin) permissions strictly determine the project candidate set (`getRoutingCandidatesForUser`).
     - Only active leaf projects (`kind = 'project'`, not folders, not teams, `archived_at IS NULL`) are included.
     - Private projects to which the routing principal does not have explicit membership are excluded *before* prompt generation. The LLM never sees or hallucinates projects the host cannot access.
  5. **Structured Fast-Tier Prompting & Injection Defense**:
     - Fast LLM tier (`route.project`, temperature 0) receives meeting topic, attendee list, org glossary, permitted candidate projects, and the first 3 minutes of transcript.
     - Transcript text is wrapped in `<untrusted_transcript>` delimiters with strict system prompt instruction to ignore any commands, overrides, or markdown instructions contained within the transcript.
     - Output is parsed and validated against `ProjectRoutingResultSchema` (`selectedProjectId`, `confidence`, `explanation`, `alternatives`).
  6. **AskHost Non-Blocking Fallback (< 0.70 Confidence)**:
     - If routing confidence is strictly below 0.70, or selected project is null or not in the submitted candidate set:
       - Meeting transitions to `awaiting_project_choice`.
       - Persists `suggested_node_id`, `routing_confidence`, `routing_reason`, and `routing_alternatives`.
       - Worker terminates execution cleanly without sleeping or holding queue threads.
     - If confidence $\ge 0.70$ and selected project is valid, meeting transitions to `routed`, commits `node_id`, and emits `meeting.routed` into outbox.
  7. **Manual Routing API with Strong OCC (`POST .../meetings/:meetingId/route`)**:
     - Fastify API and Next.js BFF require strong ETag `If-Match: "v<version>"`. Missing -> 428 Precondition Required; mismatch -> 412 Precondition Failed.
     - Validates target node is an active project leaf accessible to the caller.
     - Atomic commit: Updates `node_id`, sets `status = 'routed'`, increments `version`, logs activity, and emits `meeting.routed` to transactional outbox.
     - Re-routing guard: Re-routing is rejected with `ConflictError (409)` if downstream AI notes or action items have already been generated for the meeting.
  8. **Host Self-Service Consent Preferences & Fencing (`GET/PATCH .../zoom/my-consent`)**:
     - Separate from admin-managed organization settings, individual hosts can view and update their personal opt-in preference.
     - When host opts out (`consentStatus = 'opted_out'`), any in-flight meetings hosted by this user (`waiting_for_transcript`, `ready_for_transcript_retrieval`, `ingesting`, `routing`, `awaiting_project_choice`) have their `processing_generation` incremented to fence active workers and are marked `skipped` for automated cleanup.
  9. **Truthful UI Exposure**:
     - `MeetingDetailDrawer.tsx` features:
       - Lifecycle badges: `Routed to Project`, `Awaiting Project Choice`, `Routing...`.
       - Suggested Project Recommendation banner with confidence percentage, AI reasoning, and alternatives.
       - Project selection dropdown with accessible candidate leaves and "Confirm Project Route" action.
       - Speaker review and reassignment interface with method badges (`Verified Email`, `AI Disambiguated`, `Manual Override`, `Unresolved`).
       - External guest consent attestation form.
     - Settings page features dedicated `MyConsentCard` for self-service host opt-in / opt-out with fencing warning.
     - Strict boundary: AI notes and action items extraction is deferred to Stage 15. Zero mock summaries or fabricated action items are shown.

---

## 15. Stage 15 — Evidence-Grounded Meeting Notes and Action-Suggestion Extraction (Requirement N-1)

- **Date**: 2026-10-07
- **Status**: Accepted & Implemented
- **Context**: Completes requirement N-1 (AI-generated meeting notes, structured key decisions, open questions, and staged action items grounded by immutable transcript evidence anchors). Enforces zero ungrounded actions (strict N-1 gate: any item without at least one verified evidence segment is discarded), fences extraction by processing generation, enforces prompt injection defense via untrusted transcript tagging, supports token-aware windowing with overlap deduplication, guarantees atomic persistence with document synchronization in `docs` table (retaining 30 versions without overwriting user edits), records honest AI accounting in `ai_usage_ledger`, ensures zero rows created in the `tasks` table, and exposes complete notes and clickable evidence jump interactions in `MeetingDetailDrawer.tsx`.

- **Key Architectural Decisions & Invariant Enforcements**:
  1. **Strict Evidence-Grounding Gate (Requirement N-1)**:
     - Extraction produces structured items with evidence segments: `{ seq: number, quote: string }`.
     - Quote verification (`validateEvidenceSegments`) verifies each quote against normalized transcript segments in database, tolerating minor punctuation/whitespace variances (`normalizeEvidenceQuote`).
     - **Strict N-1 Invariant**: If after verification an action item has zero valid evidence segments, it is immediately discarded. Hallucinated, speculative, or unquoted action items never enter the database.
  2. **Zero `tasks` Table Mutation Guarantee**:
     - The extraction pipeline stages suggestions strictly into `action_items` table with `state = 'suggested'`, `proposal_type = 'create_task'`, `task_id = NULL`, and `decided_by = NULL`.
     - No rows are created, updated, or linked in the `tasks` table during Stage 15. Open-task deduplication and owner/date resolution belong to Stage 16; human decision and task creation belong to Stage 17.
  3. **Idempotent Extraction Run Identity (`extraction_runs`)**:
     - `run_key` computed deterministically as `sha256(meeting_id : transcript_checksum : node_id : generation : prompt_version)`.
     - Fences duplicate queue deliveries (`meeting.routed`) from executing duplicate LLM calls or persisting duplicate notes and action items.
  4. **Token-Aware Windowing & Overlap Deduplication**:
     - Transcripts exceeding 30,000 estimated tokens (> 120,000 chars) are partitioned into 20-minute windows with 2-minute chronological overlaps.
     - Densely packed windows (> 25k tokens) are sub-partitioned.
     - Windows are extracted with bounded concurrency (<= 3).
     - Overlap merging (`mergeWindowOutputs`) collapses duplicate action items appearing in overlapping segments, unions their verified evidence arrays, and preserves ambiguity (`owner_name = null`, `due_phrase = null`) when contradictory.
  5. **LLM Adapter Alignment & Strict Config**:
     - Temperature fixed at 0.0 for deterministic extraction.
     - Single repair retry attempt (max 2 attempts) on JSON parsing or schema failure.
     - Model refusal, truncation (`max_tokens`), and empty content detection with typed error propagation.
     - Anthropic `embed()` throws `AdapterUnavailableError` to prevent placeholder vectors or fake semantic operations.
     - Exact pricing table with 6-decimal-place INR precision (0.258000 / 1.290000 INR per 1k tokens for strong tier at ₹86/USD).
  6. **Document Synchronization & Retention Integration**:
     - Persists notes summary and formatted Markdown into `docs` under `meeting.node_id` with system attribution (`created_by = NULL`).
     - Preserves user edits: If user modifies document (`version > 1` or `created_by IS NOT NULL`), background extraction does not overwrite user edits.
     - Strict 30-version retention limit (`doc_versions`).
     - Extended Stage 13 skip cleanup (`skipMeetingAndCleanup`): Skipping a meeting atomically cascades to purge `meeting_notes`, `action_items`, `extraction_runs`, and linked meeting documents.
  7. **Honest AI Accounting & Budget Gating**:
     - `ai_usage_ledger` records every extraction attempt (operation `extract.notes_and_actions`, model, prompt version, input/output tokens, duration, cost in INR, status `succeeded`/`failed`).
     - Pre-flight budget capacity check enforces `org.ai_budget_inr` reservation cap.
  8. **Truthful Interactive UI**:
     - `MeetingDetailDrawer.tsx` displays:
       - Status badge `Completed` when extraction finishes.
       - Executive Summary formatted Markdown.
       - Key Decisions list with evidence badges.
       - Open Questions list.
       - Staged Action Items with assignee suggestions, due phrases, and clickable `[#seq]` evidence jump chips.
       - Clicking any evidence chip smooth-scrolls and highlights the exact spoken cue in the transcript viewer.

---

## 16. Stage 16 — Open-Task Deduplication, Owner Resolution, and Evidence-Supported Due Dates (Requirement N-2 Pre-Commit Preparation)

- **Date**: 2026-10-07
- **Status**: Accepted & Implemented
- **Context**: Prepares extracted action items for human review (Requirement N-2) by enriching staged suggestions with proposal classifications (`create_task` vs `update_task`), semantic open-task deduplication, conservative owner resolution, and evidence-grounded due dates in the Asia/Kolkata timezone. Strictly enforces zero task-table mutations prior to human decision in Stage 17, eliminates loose quote matching loopholes, centralizes meeting-content authorization under project privacy, and integrates real 1024-dimensional Voyage embeddings.

- **Key Architectural Decisions & Invariant Enforcements**:
  1. **Strict Contiguous Token Evidence Matching**:
     - Removed vulnerable substring inversion check (`normalizedQuote.includes(normalizedSegment)`) and loose token bag-of-words checks.
     - Enforced strict contiguous token/character-span matching (`findQuoteSpanInSegment`, `validateEvidenceSegments`), requiring the supported quote to occur contiguously within the canonical segment under documented normalization.
     - Emits canonical excerpts and character offsets (`charStart`, `charEnd`, `canonicalExcerpt`).
     - Revalidation operation (`revalidateMeetingActionItems`) flags invalid quotes with `validation_status = 'invalid_evidence'` while leaving them staged in `state = 'suggested'`, cleanly partitioned from the active review queue.
  2. **Unified Meeting Permissions Matrix & 404 Confidentiality Guarantee**:
     - Centralized authorization via `authorizeMeetingAccess` across notes, transcripts, speakers, and suggestions:
       - Owners and Admins retain established organization-wide access.
       - Routed meetings are strictly governed by project privacy (`nodes.visibility = 'public'` OR membership in `node_members`). Hosting a meeting **never** bypasses private-project access.
       - Inaccessible private resources return **404 Not Found** (zero metadata leakage).
       - Unrouted meetings follow the verified host boundary (`hostId === user.id`, with email fallback for unlinked fixtures).
       - Viewers may read permitted content (`action: 'read'`), but receive **403 Forbidden** on mutation or proposal decision (`action: 'mutate'`).
  3. **Production Embedding Adapter (Voyage AI)**:
     - Implemented real Voyage AI embedding client (`voyage-3-lite` / `voyage-3`) in `AnthropicLlmAdapter.embed()`.
     - Validates exactly 1024 finite floating-point dimensions, non-zero vectors, bounded batches ($\le 128$), exponential backoff, and 6-decimal-place INR usage tracking.
     - Mock adapter updated with deterministic 1024-dimensional unit vectors for reproducible offline test execution.
  4. **Tenant-Safe Task Embedding Storage & Cosine Deduplication**:
     - Migration `0013_stage16_dedup_and_enrichment.sql` created `task_embeddings` table with `vector(1024)` and compound unique key `(org_id, task_id)`.
     - PII masking (`maskPiiForEmbedding` v1.0.0: email, phone, IP, bearer/API secrets, URLs).
     - Content hashing (`computeTaskContentHash`: SHA-256 of masked title + "\n" + description).
     - Scoped cosine similarity search over open tasks (`status != 'done' AND status != 'cancelled'`) within target project (`tasks.project_id = meeting.node_id`).
     - Deduplication policy: Cosine similarity $\ge 0.85 \implies$ `proposal_type = 'update_task'` with `target_task_id`, `similarity_score`, and ranked alternatives; $< 0.85 \implies$ `proposal_type = 'create_task'`.
  5. **Conservative Owner Resolution**:
     - Matches first-person speaker commitments ("I will...", "I'll...", "My action item...") directly to the segment's resolved speaker identity.
     - Falls back to unique project member display name matching, followed by fast LLM disambiguation (`resolve.owner`, temperature 0) using a finite candidate set of active project members.
     - Ambiguous, unmentioned, or external speaker references strictly remain unresolved (`suggested_owner_id = null`, `owner_resolution_method = 'unresolved'`).
  6. **Evidence-Supported Due Dates in Asia/Kolkata (+05:30)**:
     - Evaluated strictly relative to meeting start timestamp in `Asia/Kolkata` (never worker runtime or server system clock).
     - Resolves relative count expressions ("in 3 days", "in 2 weeks"), weekday expressions ("by Friday"), and calendar date expressions ("by October 15th").
     - Vague expressions ("soon", "asap", "when possible") remain unresolved (`suggested_due_date = null`).
  7. **Atomic Suggestion Enrichment Pipeline & Absolute Zero Task Mutation Invariant**:
     - Background enrichment handler (`enrichMeetingSuggestions`) processes `meeting.suggestions_created`, enriches staged `action_items` atomically, and emits `meeting.suggestions_enriched`.
     - **Absolute Zero Task Mutation Invariant**: Under no circumstances are rows in the `tasks` table inserted, updated, or deleted. All enriched suggestions remain strictly in `state = 'suggested'`, `task_id = null`, `decided_by = null` awaiting explicit human review in Stage 17.
  8. **Truthful Interactive Proposal UI**:
     - `MeetingDetailDrawer.tsx` displays enriched proposal cards:
       - `Create Task` vs `Update Task` proposal badges.
       - Similarity score badge and matched open task key/title.
       - Suggested owner badge with resolution method indicator (`Speaker Match`, `Name Match`, `AI Match`, `Unassigned`).
       - Asia/Kolkata grounded due date pill (`Oct 15, 2026`).
       - Canonical quote excerpt and verified evidence anchor pills.
       - Excluded invalid evidence card clearly separating ungrounded proposals from the active human review queue.



---

## 17. Stage 17 — Human Approval of AI Suggestions (Requirement N-2)

- **Date**: 2026-10-12
- **Status**: Accepted & Implemented
- **Context**: Stage 16 left enriched `action_items` (`create_task` / `update_task` proposals with owner, due date and dedup data) and zero task mutations. Stage 17 adds the human decision, which is the only way AI output becomes or changes a task (spec §2.1 N-2, ADR 09 "every AI write needs human approval … approval data becomes the eval set", §11.3 online signals, §13.2 decision endpoint).

- **Decisions**:
  1. **Decision rights (single authorisation point)**: `authorizeActionItemAccess` (`packages/db/src/approval-operations.ts`) delegates to `authorizeMeetingAccess(read)`. Owners/Admins: every item in the org. Members and Viewers: items whose meeting they can read (routed → active project that is public or that they belong to; unrouted → only the verified host, `meetings.host_id`). Anything unreadable, unknown or cross-org → **404**, so a 403 never confirms existence. The only 403 is a Viewer deciding an item they can read. 404/403 are evaluated before `If-Match`, so private items never leak through 428/412.
  2. **State machine**: `suggested → approved | edited | rejected`; all three are terminal. Only `state = 'suggested'` and `validation_status = 'valid'` items can be decided. `action_items.version` increments on every decision **and** on enrichment/evidence revalidation (which now touch only `suggested` rows), so a human who loaded a proposal before it was re-enriched gets 412 instead of approving something they never saw. Re-extraction deletes only `suggested` items; meeting skip/purge still deletes everything (decision rows cascade).
  3. **Eligibility guards (409 + stable `code`)**: `ALREADY_DECIDED` (with the fresh item), `INVALID_EVIDENCE`, `MEETING_SKIPPED`, `MEETING_NOT_ROUTED`, `CONSENT_WITHDRAWN` (host consent not `opted_in`, admin-disabled, or guests present without `consented`), `STALE_GENERATION` (item's extraction run generation ≠ meeting `processing_generation`), `DEDUP_INCOMPLETE` (create mode when `dedup_status` is not `matched`/`no_match` and `acknowledgeIncompleteDedup` is not set — incomplete or unavailable embeddings are never silently treated as "no duplicate"), `TARGET_CHANGED`.
  4. **Same task path as a human**: create/update go through `createTaskInTransaction` / `updateTaskInTransaction` (split out of `createTask` / `updateTask`), so keys, rank, `task.created` / `task.updated` / `task.assigned` outbox events, rollup invalidation and embedding invalidation behave exactly as for manual tasks. Approved tasks use the existing `TaskSourceEnum` value `source = 'zoom_meeting'` with `source_ref = {meetingId, actionItemId, evidenceSeqs}` (`tasks.source_ref` widened to varchar(1024)); the description gets one provenance line linking `/orgs/<orgId>/meetings?meeting=<id>` and never a transcript dump.
  5. **Assignment rule**: the suggested owner is applied only if `verifyAssigneeAccess` accepts them for the target project; otherwise the task is created (or updated) without that assignment and the response reports `assignment.suggestedOwnerDropped = true`. An explicitly chosen ineligible assignee is a 422. A suggestion is never assigned to a non-member.
  6. **Update-proposal conflict policy — never overwrite silently**: an `update_task` approval locks the target and requires it to be open, not archived, still in the meeting's project and at the version captured on the proposal (`target_task_version`). Otherwise 409 `TARGET_CHANGED` with `details.currentTask` and the fresh item; nothing is written. The human can then re-review and send `decision: 'edit'` with `targetTaskVersion` equal to the version shown in the before → after preview, switch to `mode: 'create'`, or reject.
  7. **Concurrency and idempotency**: one `withTenantContext` transaction; meeting row `FOR SHARE` then item `FOR UPDATE` (same lock order as skip/re-extraction); strong `If-Match: "v{version}"` re-checked under the lock; concurrent double-approve yields one task and a 409/412 for the loser. `Idempotency-Key` uses the existing `idempotency_keys` storage: the Fastify plugin for `/api/v1`, and the same `checkOrCreate/complete/failIdempotencyKey` operations in the web BFF (which also stores the ETag and the error payload so replays are faithful).
  8. **Eval log (`action_item_decisions`, append-only)**: one row per decision (UNIQUE `(org_id, action_item_id)`) with decision, reason (`wrong | duplicate | not_a_task | other`), note, `proposal_snapshot` as shown to the human (text, owner, due, proposal type, target id/version, similarity, dedup status, confidence, evidence `{seq, quote}`, model, prompt version, extraction run), `applied_values`, `edit_summary {changedFields[], suggestedOwnerDropped}`, `title_edit_distance` (normalised Levenshtein, `normalizedEditDistance` in `@workspace/core`), `time_to_decision_ms` (from `deduped_at`, else `created_at`), task id/operation, decided_by/at. The runtime role has SELECT/INSERT only. No transcript text beyond the evidence quotes already on the item. The web edit dialog (`buildEditDecision`) always sends the assignee and due date exactly as shown (so the server never substitutes a default the human did not see) and other fields only when changed; the server records `assigneeId`/`dueDate` in `changedFields` only when the applied value differs from the default it would have applied itself (eligible suggested owner/due for the chosen project; for updates, else the target's current value).
  9. **RLS**: `can_access_meeting_content(org_id, meeting_id)` backs RESTRICTIVE private-project policies on `action_items` and `action_item_decisions` (tenant policy + forced RLS, compound FKs on `(org_id, …)`); partial inbox index `idx_action_items_inbox_open (org_id, suggested_owner_id, created_at, id) WHERE state = 'suggested'` (spec §10.4).
  10. **Safe metadata**: `action_item.decided` outbox payload `{orgId, meetingId, actionItemId, decision, taskId}`; the `activity_log` payload carries decision, reason, ids, task key, operation and changed field names only. The API error handler and the web problem helper log only the error code/name for client errors, because problem `details` can contain task text.
  11. **Email fallback removed**: `authorizeMeetingAccess`, `listOrgMeetings` and the web meeting routes no longer compare host email. `meetings.host_id` is set at webhook ingest from the verified mapping `zoom_host_consents.user_id`; unrouted meetings without that binding are visible only to Owners/Admins.
  12. **Web**: BFF routes `GET /api/orgs/:orgId/action-items`, `GET …/action-items/:id` (ETag) and `POST …/action-items/:id/decision` follow the existing BFF pattern (session cookie → server-side `@workspace/db` operations, not an HTTP proxy to Fastify), mirror the Fastify contract and return RFC 9457 problem+json. `ActionItemCard` is shared by the meeting drawer and the inbox: Approve, Edit… (prefilled dialog: title, description, assignee limited to eligible members, date input, accessible-project picker, create-vs-update choice with target picker) and Reject… (reason radio group + note); update proposals show a before → after table of the target; decided items show the outcome and link to the task (`/orgs/:orgId/projects/:projectId/tasks?task=…`). On 409/412 the card re-fetches the item and re-presents it with an explanation. The inbox defaults to "Suggested for me" (`assignee=me`) with an "All I can review" toggle and cursor "Load more"; its "N awaiting decision" count covers loaded rows only and shows "N+" while more pages exist (the list API returns no total); the Notifications section is an explicit "not available yet (Stage 19)" state. `?meeting=` and `?task=` deep links open the drawers; a `?meeting=` id outside the loaded meetings page (older than the newest 50 or filtered out) is fetched through `GET /api/orgs/:orgId/meetings/:meetingId` (`authorizeMeetingAccess(read)`), so provenance links resolve.
  13. **Accessibility**: `Dialog` and `Drawer` now trap Tab/Shift+Tab, Escape closes only the topmost modal (capture-phase handler in `Dialog`), focus is restored to the trigger, and the open effect no longer re-runs on every parent render (it previously stole focus from inputs on each keystroke). Decision results are announced in a per-card `role="status"` live region that receives focus after the decision (the buttons may have disappeared). All controls are native buttons/inputs with visible labels and the global accent `:focus-visible` outline; states are written as text ("Awaiting decision", "Approved with edits", "Rejected: Not a task"), never colour alone; decision buttons reference the suggestion text via `aria-describedby`; the scope toggle uses `aria-pressed`.
  14. **Review round 1 corrections** (each with a regression test in `approvals.test.ts` / `approvals-journey.test.ts`):
      - The web BFF meeting routes `notes`, `transcript`, `speakers` (GET/POST) and `routing-candidates` had hand-rolled checks that let a verified host read a meeting routed to a private project they are not a member of; with Stage 17 the notes response also carried that project's task details. They now call `authorizeMeetingAccess` first (404 for inaccessible private content); the notes route matches the Fastify route exactly, so Viewers may read notes and suggestions (`canDecide = false`). The shared read model no longer treats "task is in the meeting's project" as visible: linked/target task details require public visibility or membership on their own.
      - `DEDUP_INCOMPLETE` also applies when an edit creates the task in a project other than the meeting's routed project (dedup ran only against that project); the dialog shows the acknowledgement checkbox in that case.
      - Suggestions whose extraction run generation differs from the meeting's `processing_generation` (e.g. after a host opt-out fenced the meeting) can never be decided, so they are excluded from the `state=suggested` queue and returned with `superseded = true`, `canDecide = false`; the card explains why.
      - Update decisions validate the resulting change with `UpdateTaskSchema` (422 if the appended note would exceed the 50,000-character description limit).
      - Re-extraction in the same generation (e.g. Owner retry after a prompt change) does not re-stage a suggestion that matches an already decided item, using the same matching rule as the cross-window merge (`isSameActionItem`: equal normalised text, or a shared evidence cue with ≥ 50% token overlap).
      - The rollup-invalidation assertion now clears `node_rollup_dirty` for the project before the decision, so it can fail.

- **Deviations from the brief**:
  - The brief suggested `source = 'meeting'`; the existing enum value `zoom_meeting` is used instead of inventing one.
  - "dedup_status not completed": the schema has no `completed`; `matched` and `no_match` count as complete, `pending` / `incomplete` / `skipped` require acknowledgement.
  - "BFF proxy patterns (session cookie → bearer)": the repository's BFF calls `@workspace/db` directly; the new routes follow that actual pattern rather than introducing an HTTP proxy.
  - Migration `0014_stage17_approvals.sql` was edited after it had been applied locally and re-applied with psql (every statement is idempotent) instead of adding a `0015`. Only the shared local database had the earlier draft.
  - The optional sidebar pending-count badge was not built (the list API has no count; computing one would need an extra query per page view).
  - Two pre-existing defects that made the approval UI unusable in a browser were fixed: the org layout read a non-existent `session` key from `/api/auth/session` and redirected every `/orgs/…` page to login; `MeetingDetailDrawer` called `useMemo` after an early `return null`, so opening any meeting threw "Rendered more hooks than during the previous render".

- **Unverified assumptions and limits**:
  - The API and worker connect as `workspace_user` (superuser) without `SET ROLE`; restricted-role RLS behaviour is verified only by `approvals-rls.test.ts`, which connects as `workspace_app` (same pattern as `tenant-isolation.test.ts`).
  - All tests use real local PostgreSQL with mock/in-memory adapters; approvals against real Zoom, LLM or embedding providers were not exercised.
  - Full monorepo suite after review round 1: 477/478 tests (51 files); the single failure was the cold-start timing assertion in `zoom-webhooks.test.ts` (9.6 s vs < 3 s under machine load), which passes 15/15 when re-run alone. Targeted suites: API approvals 20, db RLS 4, web approvals journey 10, meetings, notes, transcript and routing journeys.
  - The web BFF `route`, `skip` and `guest-consent` mutation routes still use their own host-only check rather than `authorizeMeetingAccess(mutate)` (the Fastify equivalents do); they expose no meeting content, but a verified host can still act on a meeting routed to a private project they are not a member of through the BFF.
  - Re-extraction matching is heuristic: a re-worded suggestion with no shared evidence cue and different normalised text is staged again (dedup against open tasks still runs during enrichment).
  - Accessibility was checked by a manual keyboard walk-through in a local dev browser, not by an automated axe audit or a screen reader; contrast of the new amber/emerald/rose status text on panel tokens was not measured.
  - The edit dialog mirrors `verifyAssigneeAccess` client-side to filter assignees; the server remains authoritative (422). The project picker lists the first 100 accessible projects.
  - Meetings ingested before a host claims their Zoom identity keep `host_id` NULL until another webhook arrives (no backfill on claim). Email lookups remain in `routing-operations.ts` (routing principal when `host_id` is NULL) and `zoom-operations.ts` (opt-out fencing); neither grants read access.
  - Idempotency records keep failed outcomes (including 5xx) for 24 hours, matching the existing plugin; the UI sends a fresh key per click.
