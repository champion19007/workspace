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
