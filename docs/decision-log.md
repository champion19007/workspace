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

