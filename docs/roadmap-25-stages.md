# Workspace v1 — 25-Stage Build Roadmap

This document outlines the complete 25-stage engineering implementation roadmap for **Workspace v1**, transitioning from initial foundation through Architecture A (managed PaaS beta) to Architecture B (AWS production in `ap-south-1`).

---

### Stage 1: Foundation (Completed)
- Monorepo structure (`apps/web`, `apps/api`, `apps/worker`, `apps/lambdas`, `packages/core`, `packages/adapters`, `packages/db`, `packages/prompts`, `packages/evals`, `infra`, `docs`).
- Strict TypeScript configuration, root scripts for dev/build/test/lint/typecheck.
- Port contracts (`Queue`, `Realtime`, `LLM`, `BlobStore`, `Auth`) with typed job names, events, and structured LLM schemas.
- Strict architecture lint enforcement preventing `packages/core` from importing apps, adapters, or cloud SDKs.
- Environment validation, structured logging with PII/secret redaction, health (`/healthz`) and readiness (`/readyz`) endpoints, graceful shutdown.
- Local Docker setup with PostgreSQL extensions (`ltree`, `citext`, `uuid-ossp`, `pgvector`).
- Status web page in Next.js displaying foundation health without mock data.
- Initial CI pipeline and container build specifications.

---

### Stage 2: Database Isolation & Multi-Tenancy (Completed)
- Typed Drizzle definitions and versioned SQL migration (`0001_initial_schema.sql`) for all 22 entities: `orgs`, `users`, `memberships`, `nodes`, `node_members`, `tasks`, `labels`, `task_labels`, `project_key_counters`, `meetings`, `transcript_segments`, `meeting_notes`, `action_items`, `docs`, `doc_versions`, `comments`, `notifications`, `chunks`, `integrations`, `outbox`, `activity_log`, `invitations`.
- Application-owned UUIDv7 timestamp-ordered IDs (`uuid_generate_v7()` in SQL and `generateUuidV7()` in `@workspace/core`).
- PostgreSQL Row-Level Security (RLS) enabled and forced on all tenant tables (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`).
- Restricted runtime database role (`workspace_app`, non-superuser, no `BYPASSRLS`).
- Dual-tier policy architecture: Permissive tenant baseline (`org_id = current_setting('app.org_id')`) + Restrictive sub-org gates (`AS RESTRICTIVE` for private nodes, tasks, docs, doc_versions, chunks).
- Compound foreign keys (`(org_id, parent_id)`) enforcing cross-tenant foreign relationship boundaries at the engine level.
- Subtask hierarchy invariants: max 1 level of subtasks enforced via PL/pgSQL trigger, self-parenting check constraint, and same-project compound FK.
- Immutability of tenant ownership enforced via `prevent_org_id_mutation()` audit trigger.
- Transaction-scoped tenant context helper `withTenantContext` utilizing `set_config(..., is_local=true)` for zero state leakage across pooled connections.
- Automated real-Postgres test suite (`packages/db/src/__tests__/tenant-isolation.test.ts`, 26 tests) with deterministic fixtures validating all security invariants.

---

### Stage 3: Authentication & Sessions (Completed)
- Passwordless authentication flows: Google OIDC federated login + email OTP/magic-link.
- Session cookie management: `httpOnly`, `Secure`, `SameSite=Lax`, 30-day rolling refresh.
- Token resolution in BFF (`apps/web`) and bearer token validation in Fastify API (`apps/api`).
- Organization membership resolution, `session_epoch` revocation enforcement, and RBAC authorization matrix (Owner, Admin, Member, Viewer).

---

### Stage 4: Application Shell & UI Foundations (Ready for Implementation)
- Next.js application shell using Tailwind CSS and accessible component patterns (`shadcn/ui`).
- Global layout with responsive sidebar, organization switcher, breadcrumb navigation, and user menu.
- Dark/light mode theme support, standard loading skeletons, and accessible modal dialogs.
- Real API client wiring with session cookie forwarding and error boundaries.

---

### Stage 5: API Contracts & Async Foundations
- Fastify OpenAPI 3.1 documentation generation from Zod contracts.
- RFC 9457 `problem+json` error envelope handler for all 4xx/5xx responses.
- Idempotency middleware for mutating POST requests (`Idempotency-Key` stored with 24-hour TTL).
- Transactional outbox pattern: transactional write to `outbox` table and worker relay loop (`SELECT FOR UPDATE SKIP LOCKED`).

---

### Stage 6: Tree Management
- Hierarchical organizational tree (`nodes` table) using PostgreSQL `ltree` and GiST index.
- Node CRUD operations supporting arbitrary team depth and project leaves.
- Atomic subtree relocation in a single transaction committing in < 500 ms for 500 nodes.
- Node-level access control for private projects via `node_members`.

---

### Stage 7: Tasks & Subtasks
- Task entity management: keys (e.g., `ENG-142`), titles, descriptions, assignees, priorities, due dates, statuses.
- Single-level subtasks hierarchy and task labels.
- Optimistic concurrency control via integer `version` and HTTP `If-Match` / `ETag: "v{version}"` header (`412 Precondition Failed` on conflict).
- Fractional index ordering strings (base-62 midpoint) for task positioning without full-column reindexing.

---

### Stage 8: Task Views
- Kanban Board view grouped by status, supporting drag-and-drop ordering (1 row written per move).
- Structured List view with filtering (assignee, priority, status, date) and column sorting.
- "My Tasks" view aggregating tasks assigned to current user across all projects.
- Keyboard navigation and WCAG 2.1 AA accessibility support for task lists and board cards.

---

### Stage 9: Health & Dashboard
- Cached rollup counters in `nodes.rollup` (task completion rates, blocked items, overdue counts).
- Asynchronous, debounced bottom-up rollup computation job in `apps/worker`.
- Leadership dashboard reading aggregated counters from tree nodes in O(nodes) instead of O(tasks).
- Parity verification testing direct SQL aggregation versus cached rollup figures.

---

### Stage 10: Documents & Versions
- Markdown documents associated with tree nodes (`docs` table).
- Document versioning keeping the last 30 versions in `doc_versions`.
- Version restoration endpoint (`POST /orgs/{org}/docs/{id}/versions`).
- Autosave with 1-second debounce and diff inspection.

---

### Stage 11: Zoom Connection
- Zoom Marketplace General App (account-level OAuth) integration.
- Secure token lifecycle: store refresh tokens in AWS Secrets Manager (or encrypted vault), cache access tokens until 5 minutes before expiry.
- Automatic deauthorization handling: purge tokens and disconnect integration within 1 hour of receiving deauthorization webhook.
- Host opt-in preferences and guest consent tracking flags per meeting.

---

### Stage 12: Webhook Intake
- Public Zoom webhook endpoint (`POST /webhooks/zoom`) in `apps/api`.
- Zoom URL-validation challenge response handler.
- HMAC-SHA256 signature verification with 5-minute replay window prevention.
- Rapid intake (< 3 s response) and enqueueing into `meeting-events` queue.

---

### Stage 13: Transcript Processing
- Raw VTT transcript ingestion and parsing from Zoom Cloud Recordings API.
- Transcript normalization: merging consecutive same-speaker runs, stripping speech fillers, preserving timestamps.
- Storage in `transcript_segments` table with stable `(meeting_id, seq)` composite anchors.
- Scheduled poller fallback (every 30 minutes) to catch missed webhooks.

---

### Stage 14: Project Routing
- Fast-tier LLM routing prompt (`Claude Haiku 4.5`) predicting target tree node from meeting topic, attendees, and first 3 minutes of transcript.
- Confidence scoring: if confidence < 0.7, initiate `AskHost` branch to record pending choice and prompt meeting host.
- Meeting skip flow: if marked skip or consent missing, execute cascade purge leaving no transcript, chunks, or embeddings.

---

### Stage 15: Extraction Pipeline
- Windowing logic for long transcripts (> 30k tokens split into 20-minute windows with 2-minute overlap).
- Strong-tier LLM extraction (`Claude Sonnet 5`) with prompt caching on system prompt and per-org glossary.
- Schema-validated structured outputs: summary, decisions, action items, and open questions.
- Evidence grounding: discard any proposed action item lacking direct segment quote and sequence reference.
- Self-repair retry loop on JSON/Zod validation failure before marking meeting failed.

---

### Stage 16: Resolution & Deduplication
- Multi-window extraction merging and duplicate item collapse while preserving evidence quotes.
- Semantic deduplication against open tasks in project node using vector similarity (cosine ≥ 0.85).
- Proposal classification: "new task suggestion" vs. "update existing task suggestion".
- Rule-based and fast LLM resolution for task owners (email matching) and explicit due dates.

---

### Stage 17: Approvals System (Completed)
- Human-in-the-loop suggestion inbox: approve, edit, or reject action items.
- Strict write guard: zero tasks written to database without explicit human approval.
- Conversion of approved action items into tasks inside project tree.
- Logging approval choices for downstream evaluation dataset curation.
- Delivered: `decideActionItem` decision API (Fastify + web BFF) with strong `If-Match`, `Idempotency-Key`, row locks and 409 eligibility guards; tasks created/updated only through the shared task-operations path; update proposals refuse changed targets (`TARGET_CHANGED`) instead of overwriting; append-only `action_item_decisions` eval log (migration `0014_stage17_approvals.sql`) with RESTRICTIVE private-project RLS; permission-filtered approval inbox API; real Approvals inbox page and functional drawer controls; email-based meeting access fallback removed. See ADR 17 in `docs/decision-log.md`.

---

### Stage 18: AI Evaluation & Cost Tracking
- Golden-set evaluation framework in `packages/evals` (40 to 100 benchmark meetings).
- Evaluation metrics: action-item precision (≥ 0.80), recall (≥ 0.70), owner accuracy (≥ 0.85), hallucinated due dates (0), evidence validity (≥ 0.98).
- Cost logging per LLM call (`cost_inr`) based on live token pricing.
- Per-org monthly AI budget tracking with alerts at 80% and hard execution cap.

---

### Stage 19: Collaboration & Notifications
- Threaded polymorphic discussions (`comments` table) on tasks, nodes, docs, and meetings.
- `@mention` parsing and fan-out notification engine with deduplicated delivery.
- In-app notification inbox (`notifications` table).
- Outbox relay email worker delivering batched mention notifications (15 min) and daily 09:00 IST digests.

---

### Stage 20: Realtime Updates
- Realtime event publication via outbox relay (`task.upserted`, `node.rollup`, `comment.created`, `meeting.status`).
- Architecture A: Supabase Realtime broadcast channels with JWT authentication.
- Architecture B: AWS AppSync Events WebSocket endpoints with Cognito JWT authorizer.
- Client refetch reconciliation pattern: lightweight notification hints with `?updatedSince=` client sync.

---

### Stage 21: Optional P1 Features (Flagged)
- **Ask AI (P1)**: Query rewrite (fast tier), permission-filtered hybrid search (`pgvector` cosine + `tsvector` GIN fused via Reciprocal Rank Fusion), strong-tier answer generation with strictly verified citations (`[chunk:id]`).
- **Manual Upload (P1)**: S3 upload with Amazon Transcribe batch job (`en-IN`, speaker diarization) feeding into identical extraction pipeline.

---

### Stage 22: Privacy & Security
- DPDP Act 2023 & Rules 2025 compliance engine: customer as Data Fiduciary, platform as Data Processor.
- Data subject rights workflows: automated export (JSON + Markdown) and asynchronous erasure cascade.
- Nightly data retention purge job enforcing org-configured transcript retention (default 180 days).
- PII masking on transcript chunks before vector embedding generation.
- Strict Content Security Policy (CSP) with nonces and DOMPurify sanitization.

---

### Stage 23: AWS Infrastructure (Architecture B)
- AWS CDK TypeScript stacks (`infra/`):
  1. `NetworkStack`: VPC across 2 AZs, public/private-app/private-data subnets, NAT gateways, VPC interface & gateway endpoints, flow logs.
  2. `DataStack`: Aurora Serverless v2 PostgreSQL 16, RDS Proxy, Valkey ElastiCache, S3 buckets with KMS CMK, AWS Backup.
  3. `EdgeStack`: Route 53 ALIAS records, ACM certificates, CloudFront distribution, AWS WAF rules, Shield Standard.
  4. `ComputeStack`: ECS Fargate cluster (Graviton/ARM64), task definitions, ALB listener rules, target groups, autoscaling.
  5. `AsyncStack`: SQS queues + DLQs, Step Functions state machine, EventBridge schedules.
  6. `RealtimeStack`: AppSync Events API, custom domain, channel namespaces.
  7. `IdentityStack`: Cognito User Pool with Google IdP and email OTP, pre-token generation trigger.
  8. `ObservabilityStack`: CloudWatch dashboards, EMF metrics, X-Ray tracing, alarms, budget notifications.

---

### Stage 24: Migration Architecture (A → B)
- Data export scripts (`pg_dump` excluding auth schema) and restore procedures into Aurora.
- User identity migration: mapping verified email addresses to `cognito_sub` and preserving `users.id`.
- S3 object sync preserving exact key paths from Supabase Storage.
- OAuth token migration from database/local storage to AWS Secrets Manager.
- Zero-downtime cutover runbook: write freeze (≤ 30 min), delta sync, DNS TTL cutover (60 s), unfreeze.

---

### Stage 25: Launch Verification
- End-to-end synthetic testing of the 6 core user journeys with Playwright.
- Load testing at 10× beta volume (600 RPS, 50,000 meeting-hours/month) using k6.
- Disaster recovery drill: PITR in-region restore (< 1 h) and regional disaster restore in `ap-south-2` (< 4 h).
- Security audit: Security Hub high findings = 0, external penetration test review.
- Final launch checklist sign-off for public beta.
