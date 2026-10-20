# Workspace v1 — Engineering Platform

> Stage 1 of 25: Platform Foundation (Modular Monolith)

Workspace v1 helps companies organise teams, projects, tasks, documents, and meeting discussions.
Central workflow: **Zoom meeting &rarr; transcript &rarr; evidence-backed AI notes & action-item suggestions &rarr; human approval &rarr; tasks in project tree**.

---

## 1. Prerequisites

- **Node.js**: v22.0.0+ (Tested on v24.18.0)
- **pnpm**: v12.9.1+
- **Docker & Docker Compose**: v29+ / Compose v5+ (for local PostgreSQL 16 with extensions)
- **Git**: v2.40+

---

## 2. Architecture & Monorepo Structure

```
├── apps/
│   ├── web/        # Next.js 15 (BFF & UI, Tailwind CSS, shadcn conventions)
│   ├── api/        # Fastify REST API, webhooks (/healthz, /readyz, RFC 9457)
│   ├── worker/     # Background worker (outbox relay, async tasks)
│   └── lambdas/    # Edge handlers (Step Functions, EventBridge schedules)
├── packages/
│   ├── core/       # Pure business rules & 5 ports (NO cloud SDK or app imports)
│   ├── adapters/   # Concrete port implementations (pg-boss/SQS, Supabase/AppSync, Claude/Bedrock)
│   ├── db/         # Drizzle schema (18 core tables), dual connection pools, RLS helpers
│   ├── prompts/    # Versioned prompts & Zod structured output contracts
│   └── evals/      # Golden-set evaluation runner & metric gates
├── infra/          # AWS CDK TypeScript infrastructure stacks
└── docs/           # Requirements tracker, 25-stage roadmap, decision log
```

### The Five Main Ports (`packages/core/src/ports/`)

1. **`QueuePort`**: Typed job names (`meeting.pipeline`, `notify`, `index`, `rollup`, `export.erasure`) with Zod validated payloads.
2. **`RealtimePort`**: Server-side broadcast hints (`task.upserted`, `node.rollup`, `comment.created`, `meeting.status`, `notification.created`).
3. **`LLMPort`**: Schema-validated structured completions (`fast` vs `strong` tier) and 1024-dim embeddings.
4. **`BlobStorePort`**: Presigned upload/download URLs and object lifecycle storage.
5. **`AuthPort`**: Passwordless authentication abstraction (Google OIDC + email OTP / magic-link) and session verification.

---

## 3. Local Development Quickstart

### Step 1: Clone & Configure Environment
```bash
cp .env.example .env
```
*(The defaults in `.env.example` run local development with in-memory test ports or local Postgres).*

### Step 2: Start Local PostgreSQL (with extensions)
```bash
docker compose up -d
```
This provisions PostgreSQL 16 with required extensions: `ltree`, `citext`, `uuid-ossp`, `pgcrypto`, and `pgvector`, plus the local runtime login roles `workspace_api` and `workspace_worker` (dev passwords only). For a volume created before Stage 17b, add those roles by re-running the init script:
```bash
docker exec -i workspace-v1-postgres psql -U workspace_user -d workspace_dev -f /docker-entrypoint-initdb.d/01-init.sql
```

### Step 3: Install Dependencies & Apply Migrations
```bash
pnpm install
pnpm --filter "@workspace/db..." build   # db plus the workspace packages it imports
```
Migrations run as the database owner. Set `DATABASE_MIGRATION_URL` from `.env`, then:
```bash
pnpm --filter @workspace/db migrate
```
The API/BFF and worker never connect as the owner: they use `workspace_api` (`DATABASE_URL`) and `workspace_worker` (`DATABASE_DIRECT_URL`), which are not superusers and cannot bypass row-level security (see ADR 17b in `docs/decision-log.md`).

### Step 4: Run Health, Lint & Tests
```bash
# Verify architecture boundary rules & unit tests
pnpm test

# Verify strict typecheck across all workspaces
pnpm run typecheck

# Run ESLint to verify packages/core import isolation
pnpm run lint
```

### Step 5: Start Development Services
```bash
# Start all services concurrently
pnpm dev

# Or start specific applications:
pnpm dev:api     # Fastify API on http://localhost:8080
pnpm dev:worker  # Background worker on http://localhost:8081
pnpm dev:web     # Next.js web application on http://localhost:3000
```

---

## 4. Health & Readiness Verification

- **API Liveness**: `GET http://localhost:8080/healthz` (Process uptime, memory; 200 OK)
- **API Readiness**: `GET http://localhost:8080/readyz` (Verifies database pool & ports; 200 OK or 503 if DB offline)
- **Status Endpoint**: `GET http://localhost:8080/api/v1/status` (Current environment & active providers)
- **Worker Liveness**: `GET http://localhost:8081/healthz` (Worker background process status)
- **Worker Readiness**: `GET http://localhost:8081/readyz` (Direct DB session & queue readiness)

---

## 5. Architectural Invariants

1. **Zero Mocked Data in UI**: No fake analytics, meetings, or synthetic task numbers.
2. **Explicit Human Decisions**: AI extracts suggestions, but tasks are never auto-created without human approval.
3. **Isolation of Domain Core**: `packages/core` strictly enforces zero dependencies on cloud SDKs, apps, or adapters via automated ESLint rules and Vitest AST scanning.
4. **Row-Level Security at Runtime**: every tenant query runs inside a transaction that assumes `workspace_app` (acting user) or `workspace_system` (worker, one org) with `SET LOCAL`; database operations bind this through `tenantSql` / `withTenantContext`. Cross-organization work goes only through the `sys_*` SECURITY DEFINER functions of migration 0015.
