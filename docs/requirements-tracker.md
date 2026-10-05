# Workspace v1 — Requirements Tracker

This tracker maps every requirement ID from the system design document ("Workspace v1 — Engineering Design Doc", Jan 2027 Launch) to its implementation stage (across the 25-stage roadmap), acceptance criteria, and verification evidence.

## Status Legend
- **Planned**: Scheduled in roadmap
- **In Progress**: Active development
- **Implemented**: Code and tests in place
- **Verified**: Acceptance criteria validated by automated test suite

---

## 1. Functional Requirements (P0 Gates Beta)

| ID | Requirement | Priority | Target Stage | Acceptance Criteria | Verification Evidence | Status |
|---|---|---|---|---|---|---|
| **W-1** | Passwordless auth: Google OIDC + email magic link / OTP | P0 | Stage 3 (Authentication) | Session cookie `httpOnly`, `Secure`, `SameSite=Lax`; 30-day rolling refresh. | Integration test verifying cookie attributes and token refresh. | Planned |
| **W-2** | Org roles (Owner / Admin / Member / Viewer); private projects | P0 | Stage 2 (Tenancy & Isolation) & Stage 3 | Authorization matrix test passes for every route × role; private project access blocked for non-members. | Cross-role test suite in Vitest validating 403 on disallowed routes. | Planned |
| **W-3** | Tree CRUD + move subtree | P0 | Stage 6 (Tree Management) | Move of a 500-node subtree commits in one transaction < 500 ms using PostgreSQL `ltree`. | Micro-benchmark test asserting single transaction commit < 500 ms on 500 nodes. | Planned |
| **W-4** | Tasks: fields, subtasks (1 level), labels, keys like `ENG-142` | P0 | Stage 7 (Tasks & Subtasks) | Concurrent edits resolved by `If-Match` header; loser gets `412 Precondition Failed` + fresh entity. | Concurrency integration test with two simulated parallel writers. | Planned |
| **W-5** | Board ordering by drag | P0 | Stage 8 (Task Views) | One-row write per move (fractional rank in base-62); no full-column reindex. | Database query trace verifying exactly 1 row updated per drag event. | Planned |
| **W-6** | Health roll-up per node | P0 | Stage 9 (Health & Dashboard) | Roll-up visible ≤ 60 s after any task change in subtree; debounced bottom-up rollup job. | Async rollup test verifying cached counters updated after task modification. | Planned |
| **W-7** | Leadership dashboard | P0 | Stage 9 (Health & Dashboard) | Counters equal a direct SQL count for the same filter; reads from cached node rollup. | Parity test asserting cached rollup numbers match direct aggregation query. | Planned |
| **M-1** | Zoom OAuth (account-level) + deauthorize handling | P0 | Stage 11 (Zoom Connection) | Tokens purged ≤ 1 h after deauthorization event; tokens kept in Secrets Manager. | Integration test verifying deauthorize webhook marks disconnected and deletes secrets. | Planned |
| **M-2** | Transcript ingest on webhook, poller fallback | P0 | Stage 12 & Stage 13 | Duplicate deliveries produce exactly one meeting row (idempotency key on `org_id` + `provider_meeting_uuid`). | Duplicate webhook delivery test asserting exactly one database row. | Planned |
| **M-3** | Meeting → project routing | P0 | Stage 14 (Project Routing) | Confidence < 0.7 triggers `AskHost` branch to prompt host; never silent misroute. | Unit test with mocked low-confidence prediction ensuring host prompt generated. | Planned |
| **M-4** | Per-host opt-in, per-meeting skip, guest consent flag | P0 | Stage 14 (Project Routing) | Skipped meeting leaves no transcript, chunks, or embeddings in database or object store. | Purge verification test asserting zero rows and zero objects for skipped meetings. | Planned |
| **N-1** | AI notes: summary, decisions, action items, open questions | P0 | Stage 15 (Extraction Pipeline) | Every action item carries ≥ 1 evidence segment; items without evidence discarded. | Golden-set eval testing evidence quotation and segment validation. | Planned |
| **N-2** | Approve / edit / reject suggestions; dedupe against open tasks | P0 | Stage 16 & Stage 17 | No task row created without a human decision; dedupe matching open tasks (cosine ≥ 0.85). | Assertion that suggested action items cannot directly insert into `tasks` table. | Planned |
| **N-3** | Docs with version history (30 versions) | P0 | Stage 10 (Documents & Versions) | Restore any version; autosave debounced to 1 s; keep last 30 versions. | Version retention test verifying version 31 drops oldest, restore updates content. | Planned |
| **C-1** | Threads on task / node / doc / meeting; @mentions; inbox | P0 | Stage 19 (Collaboration) | Fan-out p95 < 2 s; mention notification sent exactly once; in-app + email digests. | Notification test confirming deduplicated delivery for mentions. | Planned |

---

## 2. Optional P1 & P2 Requirements (Flagged / Post-Beta)

| ID | Requirement | Priority | Target Stage | Acceptance Criteria | Status |
|---|---|---|---|---|---|
| **A-1** | Ask AI with citations, permission-filtered retrieval | P1 (Flagged) | Stage 21 (Optional P1) | Zero results returned from nodes the requesting user cannot read (strictly tested). | Planned |
| **M-5** | Manual transcript / audio upload | P1 (Flagged) | Stage 21 (Optional P1) | Same pipeline output and schema as Zoom path; uses Amazon Transcribe batch job. | Planned |
| **M-6** | Zoom RTMS live transcripts | P2 (Non-goal in beta) | Post-beta | Feature-flagged; emits same `transcript_segments` contract. | Non-Goal |
| **X-1** | MCP connectors (GitHub, Slack, Jira...) & MCP server | P2 (Non-goal in beta) | Post-beta | Outbound MCP client (worker only, 20s budget); Inbound Streamable HTTP at `/mcp`. | Non-Goal |

---

## 3. Non-Functional & Architecture Requirements

| Requirement Area | Specification | Target Stage | Acceptance Criteria & Verification | Status |
|---|---|---|---|---|
| **Foundation & Boundaries** | Modular monolith with strict module boundaries; 5 ports (`Queue`, `Realtime`, `LLM`, `BlobStore`, `Auth`). | Stage 1 (Current) | `packages/core` has 0 imports of apps, adapters, or cloud SDKs. Verified by ESLint and Vitest arch test. | **Implemented & Verified** |
| **Reproducible Local Dev** | Root scripts, local Postgres with extensions, separate API/worker db connections, health & readiness endpoints. | Stage 1 (Current) | Docker-compose with extensions (`ltree`, `citext`, `uuid-ossp`, `pgvector`); `/healthz` and `/readyz` functional; graceful shutdown implemented. | **Implemented & Verified** |
| **Tenancy & Isolation** | Shared schema multi-tenancy, `org_id` on every tenant row, Postgres RLS enforced in both A and B. | Stage 2 | Automated cross-org test suite asserts no user can query or modify rows from another org. | Planned |
| **Idempotency** | Webhooks & async jobs idempotent on natural keys; `Idempotency-Key` on API POSTs. | Stage 5 | Duplicate requests return identical cached response within 24h without re-executing. | Planned |
| **Consistency** | Strong consistency for writes via API; realtime is an invalidation hint triggering refetch. | Stage 5 & 20 | Writes commit synchronously; clients reconcile via `?updatedSince=` on reconnect. | Planned |
| **Privacy & DPDP** | No training on customer data; default 180-day transcript retention; export and erasure cascade. | Stage 22 | Erasure cascades to chunks, embeddings, S3 files; retention purge job deletes expired data. | Planned |
| **Observability** | Pino structured JSON logs with sensitive content redaction (tokens, transcripts, comments). | Stage 1 | Unit tests verify redaction of auth headers, passwords, and transcript bodies. | **Implemented & Verified** |
| **Deployability** | Container images for `web`, `api`, `worker` with Node 22, distroless / non-root user. | Stage 1 | Valid Dockerfiles tested for container build compliance. | **Implemented & Verified** |
