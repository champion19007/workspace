# Workspace v1 — Architecture Overview

## 1. System Vision & Core Workflow

Workspace v1 is a solo-operator platform that transforms meeting interactions into structured, evidence-backed workspace tasks:
```
Zoom Meeting ──> Audio/Transcript ──> AI Notes & Suggestions ──> Human Decision ──> Tasks in Project Tree
```

### Invariants:
1. **Multi-Tenant Isolation**: PostgreSQL Row-Level Security (RLS) on all tenant tables keyed by `org_id`.
2. **Explicit Human Approvals**: AI suggests actions with evidence quotations; tasks are **never** created automatically.
3. **Dual Architectures Behind Fixed Ports**:
   - **Architecture A (Weeks 1–8)**: Fast validation with design partners using Supabase (Postgres/Auth/Storage/Realtime), pg-boss, Anthropic API, and Vercel.
   - **Architecture B (Weeks 9–14+)**: Production beta in AWS `ap-south-1` using Aurora PostgreSQL Serverless v2, Cognito, S3, AppSync Events, SQS + Step Functions, and Claude on Amazon Bedrock.

---

## 2. Monorepo Structure & Module Boundaries

The project is structured as a modular monolith:

| Directory | Role | Boundary Rules |
|---|---|---|
| `packages/core` | Pure domain logic, domain errors, ports, and configuration schemas | **Zero dependencies** on apps, adapters, or external cloud SDKs. Enforced by ESLint and Vitest. |
| `packages/adapters` | Concrete port implementations for Queue, Realtime, LLM, BlobStore, and Auth | Implements port contracts. Never called directly by domain logic—composed at bootstrap. |
| `packages/db` | Drizzle ORM schema, dual connection pooling, migrations, and tenant RLS helpers | Houses all 18 database entity tables. |
| `packages/prompts` | Versioned prompts and Zod structured output schemas | Provides deterministic, validated outputs. |
| `packages/evals` | Golden-set benchmark runner, graders, and metric gates | Evaluates action item precision, recall, and evidence validity. |
| `apps/api` | Fastify REST API, webhooks, and future `/mcp` server | Serves `/healthz` (liveness), `/readyz` (readiness), and `/api/v1/*`. |
| `apps/worker` | Background worker process | Processes outbox relay, index jobs, health rollup, and notifications. |
| `apps/lambdas` | Edge handlers | Scheduled pollers, Step Functions pipeline steps, and retention purges. |
| `apps/web` | Next.js 15 App Router web application and BFF | Accessible UI with Tailwind CSS and shadcn conventions. |
| `infra` | AWS CDK infrastructure stacks | Network, Data, Edge, Compute, Async, Realtime, Identity, Observability. |
| `docs` | Requirements tracker, decision log, 25-stage roadmap | Comprehensive architecture documentation. |

---

## 3. The Five Architectural Ports

1. **`QueuePort`**:
   - Methods: `enqueue<T extends JobName>(job, data, options)`
   - Jobs: `meeting.pipeline`, `notify`, `index`, `rollup`, `export.erasure`
   - Providers: `pg-boss` (Architecture A) & `SQS` (Architecture B)
2. **`RealtimePort`**:
   - Methods: `publish(channel, event)`, `mintToken(userId, orgId, channels)`
   - Events: `task.upserted`, `task.deleted`, `node.rollup`, `comment.created`, `meeting.status`, `notification.created`
   - Providers: `Supabase Realtime Broadcast` (Architecture A) & `AWS AppSync Events` (Architecture B)
3. **`LLMPort`**:
   - Methods: `complete<T>(req: { promptId, tier, input, schema })`, `embed(req)`
   - Tiers: `fast` (Haiku) & `strong` (Sonnet)
   - Providers: `Anthropic API` (Architecture A) & `Amazon Bedrock with India profile` (Architecture B)
4. **`BlobStorePort`**:
   - Methods: `getUploadUrl`, `getDownloadUrl`, `putObject`, `getObject`, `deleteObject`, `deletePrefix`
   - Providers: `Supabase Storage` (Architecture A) & `Amazon S3` (Architecture B)
5. **`AuthPort`**:
   - Methods: `requestPasswordless`, `verifyPasswordless`, `verifySessionToken`, `revokeSession`
   - Providers: `Supabase Auth` (Architecture A) & `Amazon Cognito` (Architecture B)

---

## 4. Connection Pooling Strategy

- **API Pool (`DATABASE_URL`)**: Transaction pooler mode (max 10 connections per instance). All operations execute with `SET LOCAL app.org_id`.
- **Worker Pool (`DATABASE_DIRECT_URL`)**: Direct session mode (max 5 connections per instance). Required for `pg-boss` advisory locks (`LISTEN`/`NOTIFY`) and migrations.
