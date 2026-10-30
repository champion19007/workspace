# 11 — Infrastructure, operations and scaling

Revision C rewrote this chapter after an external review of revision B (register in chapter 13 §13.6). The
review found the earlier capacity table too optimistic, the worker topology fragile, and the recovery targets
too loose for a paid product.

## 11.1 Environments

| Env | Web | DB | Worker | Data | Who |
|---|---|---|---|---|---|
| Local | `docker compose up` (full stack, §11.2) or `pnpm dev:*` | `pgvector/pgvector:pg16` container | `worker-light` + `worker-heavy` containers | fixtures | developers |
| Preview | Vercel preview per PR | Supabase branch or shared staging project (never production) | none (features degrade) | seeded demo org | reviewers |
| Staging | Vercel `staging` | Supabase staging project | Railway/Fly staging, same images as production | seed + synthetic load | release checks |
| Production | Vercel production | Supabase production (Mumbai for India) | Railway/Fly production, 2 × light + 1–2 × heavy | customer | — |

## 11.2 Containers: one image per service, used everywhere (review #1, #2)

**What exists:** `infra/docker/Dockerfile.{api,web,worker}` (stage 1, 2026-10-05) and a compose file that runs
only Postgres. The web image is stale: it builds `@workspace/core` and `@workspace/web` only, while
`next.config.ts` lists `@workspace/db`, `@workspace/adapters` and `@workspace/prompts` as
`serverExternalPackages`, so the image can't start; it also copies the whole `node_modules` instead of using
Next.js `standalone` output.

**Target:**

| Image | Base | Build | Runtime size goal | Runs on |
|---|---|---|---|---|
| `workspace-web` | `node:22-bookworm-slim` multi-stage | `pnpm --filter "@workspace/web..." build` with `output: 'standalone'`, copy `.next/standalone`, `.next/static`, `public` | < 250 MB | Vercel builds from source today; the image is for Architecture B, self-hosting and local compose |
| `workspace-api` | same | `pnpm --filter "@workspace/api..." build`, `pnpm deploy --prod` to prune | < 200 MB | Railway/Fly (webhooks, public API, MCP) |
| `workspace-worker` | same | `pnpm --filter "@workspace/worker..." build`, `pnpm deploy --prod` | < 200 MB | Railway/Fly, started twice with different `WORKER_QUEUES` (§11.3) |

All three run as the `node` user, read config only from env, expose `/healthz` and `/readyz`, and handle
`SIGTERM` (graceful shutdown already exists in api and worker).

**Full-stack compose** (`docker-compose.yml`, replacing today's Postgres-only file; `docker compose up postgres` still starts just the database): `postgres` (existing init script), `mailpit` (catches
outgoing email and shows it at `http://localhost:8025`; the apps reach it through a small SMTP email adapter,
`EMAIL_PROVIDER=smtp`, next to the existing Resend and console adapters), `web`, `api`, `worker-light`,
`worker-heavy`, with a one-shot
`migrate` service that the others wait for (`depends_on: condition: service_completed_successfully`). CI builds
these images on every PR so a broken Dockerfile can't sit unnoticed again.

Kubernetes stays out. Revisit only when one of these is true: a **self-hosted / on-prem edition** is sold (ship
a Helm chart for it), there are **more than ~5 independently scaled services**, or we need **queue-depth
autoscaling** beyond what ECS or Fly offer.

## 11.3 Worker topology (review #3, #4)

Revision B had one 512 MB worker for every job type. That is a single point of failure, and a large import
could hold the CPU while meeting notes wait.

| Deployment | `WORKER_QUEUES` | Replicas | Size | Why separate |
|---|---|---|---|---|
| `worker-light` | `outbox.relay`, `notify`, `webhook.deliver`, `automation.run`, `rollup`, schedules | **2** (active-active) | 512 MB each | latency-sensitive, small jobs; one replica can die without anyone noticing |
| `worker-heavy` | `meeting.pipeline`, `meeting.routed`, `index` (embeddings), `import.run`, `export.run`, `export.erasure` | 1, scale to 2 when meetings > 200/day | 1 GB | long, memory-hungry jobs never block notifications |

Safety of running replicas side by side is already in the code: the outbox relay claims batches with
`SELECT … FOR UPDATE SKIP LOCKED` plus a lease inside `sys_outbox_claim` (so review #5 was already handled),
pg-boss uses `SKIP LOCKED` for jobs, and the Zoom poller holds a lease row (`zoom_poll_checkpoints.lease_*`).
Health checks: `/readyz` fails if the DB session or the queue subscription is down; the platform restarts the
container after 3 failed checks.

Scheduling (review #28): once the worker runs, recurring jobs (instant-email drain every minute, digests hourly,
purges nightly) move from Vercel Cron to pg-boss schedules, which run exactly once per tick across replicas.
Vercel Cron stays only as a fallback for deployments without a worker.

Cost: +$5–10/month over revision B for the second light replica and the separate heavy worker.

## 11.4 Database: what Postgres is doing, and when each job moves out (review #9, #10, #13)

Postgres is the system of record, the job queue (pg-boss), the outbox, the rate-limit store, the full-text
search engine and the vector store. That keeps the bill and the moving parts small, and it also means a
Postgres incident stops everything. The plan is to move work out in a fixed order, each step triggered by a
measured number, not by date:

| Order | Function | Moves to | Trigger |
|---|---|---|---|
| 1 | IP-based rate limits (sign-in, public form, public dashboard) | Vercel Firewall rate-limit rules (edge, no function invoked) | at launch |
| 2 | Per-user limits on hot paths (mutations, API tokens) | Upstash Redis / Vercel KV (`@upstash/ratelimit`, sliding window) | when limited requests > ~50/s, or rate-limit writes > 5 % of DB writes |
| — | Low-volume limits (sign-in email per address, codes, invitations, AI, uploads) | stay in Postgres | they fire a few times a minute; one row write each is negligible |
| 3 | Queue (pg-boss) | SQS (Architecture B) or a managed Redis queue | pg-boss tables > 5 % of DB CPU, or > 100 jobs/s |
| 4 | Vector search | per-tenant partial indexes (§4.17), then a dedicated store | HNSW index > 50 % of RAM |
| 5 | Full-text search | OpenSearch / Typesense | p95 search > 500 ms on the replica |

The review's suggestion to move *all* rate limits to Redis now is declined for the low-volume limits: they are
not a load problem, and keeping them in Postgres keeps one fewer service to run. The browser-mutation limit
(600/min per person) in chapter 06 §6.8 is moved to step 2 and is **not** built on Postgres.

**Vacuum and churn.** pg-boss job tables, `outbox`, `rate_limit_counters`, `notifications` and
`idempotency_keys` are insert-then-delete tables. Set per-table autovacuum so dead rows are cleared quickly:

```sql
ALTER TABLE outbox SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_cost_limit = 2000);
ALTER TABLE rate_limit_counters SET (autovacuum_vacuum_scale_factor = 0.02);
ALTER TABLE idempotency_keys SET (autovacuum_vacuum_scale_factor = 0.05);
-- pg-boss: keep its archive short (archiveCompletedAfterSeconds: 3600, deleteAfterDays: 7)
```

Delete sent outbox rows after 7 days in the nightly job. Partition `activity_log`, `notifications`,
`ai_usage_ledger` and `automation_runs` by month once any passes 20 M rows, and drop old partitions instead of
deleting rows.

## 11.5 Connections and timeouts (review #12, #16)

| Setting | Revision B | Revision C | Why |
|---|---|---|---|
| Web pool per serverless instance | 5 in code (`server-context.ts`), 10 in `.env.example` | **1–2** on Vercel (`DB_API_POOL_SIZE=2`; set `.env.example` to 2 as well) | every warm Vercel instance holds its own pool; 100 instances × 5 = 500 client connections to the pooler. Supabase's pooler caps client connections per compute size. **Our tier's limit: TBD — record it from Supabase's compute-size table when the production tier is chosen**, and keep `max warm instances × pool size` under 70 % of it |
| Worker pool | 5 | 5 per replica (session mode) | pg-boss needs a few; 3 replicas × 5 = 15 direct connections |
| Statement timeout | WQL only (3 s) | for `workspace_app` and `workspace_system`: `SET LOCAL statement_timeout = '15s'` (app) / `'120s'` (system) inside `withTenantContext` / `systemSql`, in the same statement that does `SET LOCAL ROLE`; plus `ALTER ROLE workspace_api SET statement_timeout = '15s'`, `ALTER ROLE workspace_worker SET statement_timeout = '120s'` and `idle_in_transaction_session_timeout = '30s'` on both login roles as a backstop | a runaway query or a hung transaction can't hold locks or a pooled connection |
| Lock timeout | none | `lock_timeout = '5s'` on `workspace_api` | a blocked row (see D21) fails fast instead of piling up requests |

Why two places: Postgres applies `ALTER ROLE … SET` settings when a session **logs in**, not on `SET ROLE`, so a
setting on `workspace_app` or `workspace_system` alone would never take effect (they are `NOLOGIN` roles the
login roles switch into). Setting `SET LOCAL statement_timeout` in the same transaction that assumes
`workspace_app` / `workspace_system` gives each role its own limit; the login-role settings catch anything
outside a tenant transaction. Statements that need longer (exports, imports) run in the worker as
`workspace_system` with its 120 s limit, or raise it locally for that statement.

## 11.6 Capacity planning (review #18, #19, #20)

Revision B counted one read per page load and ignored the board's 15-second polling. Corrected model per
active org (25 people), working day of 8 hours. **Every number in these two tables is an assumption — measure
after launch** (queries per page from `pg_stat_statements` and Sentry spans, polling share from Realtime
connection counts).

| Source | Assumption | Requests per org per day |
|---|---|---|
| Page loads | 300 per person, **3 queries each** (layout + page data + counts) — measure and replace | 22,500 queries |
| Mutations | 30 per person, 4 statements each (write, activity, outbox, rollup dirty) | 3,000 statements |
| Board/list polling (revision B design) | 1/3 of people keep a board or list open 6 h, poll every 15 s | 12,000 requests |
| Bell/notifications | refresh on focus, ~40 per person | 1,000 |

| Orgs | Queries/s (avg over 8 h) with 15 s polling | With Realtime hints instead (Phase 2; the Phase 0 60 s poll sits between the two) | Peak (≈3×) with Realtime | Postgres |
|---|---|---|---|---|
| 50 | ~67 | ~48 | ~145 | Supabase Small |
| 300 | ~400 | ~290 | ~860 | Medium/Large + tuning |
| 1,500 | ~2,000 | ~1,430 | ~4,300 | 8 vCPU + read replica |

Arithmetic: 22,500 + 3,000 + 12,000 + 1,000 = 38,500 queries per org per day ÷ 28,800 s ≈ 1.34/s per org.
Realtime removes the 12,000 polls and adds about 1,000 targeted refetches: 27,500 ÷ 28,800 ≈ 0.95/s per org.

So polling every 15 s would cost about a third of all database work. Decision: **Phase 0 replaces the 15 s poll with
a 60 s poll** of a small per-project version endpoint (one indexed lookup, `304` when unchanged), which cuts the
polling share by 4×; **Supabase Realtime broadcast hints come in Phase 2**, with the 60 s poll kept as the
fallback when the socket is closed. Hints carry ids only and come from the outbox relay, so they add no database reads; the client refetches
only the changed task. Realtime is metered by concurrent connections and messages (check the plan's included
amounts); at 50 orgs with ~400 open boards it fits a Pro plan.

**Per-org fairness** (review #20): a per-org request budget for the browser API (e.g. 3,000 requests/min per
org), counted in the same Redis as step 2 of §11.4, and per-org concurrency caps in the worker (pg-boss
`singletonKey`/group concurrency per org for imports and automation). Until Redis is added, the existing
per-person limits plus the edge rules cover abuse; a legitimately huge org is handled by talking to it.

## 11.7 Read replica rules (review #14)

The replica serves only reads where a few seconds of lag is invisible: dashboards and gadgets, Insights and
Progress, Ask AI retrieval, global search, exports, the ops dashboard. Everything a person just changed (task
drawer, list, board, docs, comments) reads from the primary. In addition, the BFF sets a `ws_rw` cookie for 10 s
after any mutation, and requests carrying it go to the primary even for replica-eligible pages. Replication lag
above 5 s is an alert.

## 11.8 Observability (review #29, #30, #31)

| Signal | Tool | What |
|---|---|---|
| Errors **and traces** | Sentry for web (Next.js SDK) and worker, from Phase 0; traces sampled at 10 % plus 100 % of errors | one trace from browser → route handler → Postgres span → outbox → worker job, linked by `x-request-id` and the outbox id |
| Logs | Vercel + Railway logs, drained to Axiom or Better Stack | JSON, redacted |
| Latency SLOs | Vercel function metrics (p50/p95 per route) and Sentry transaction p95 | the numbers the SLOs in §11.10 are measured with |
| Queue health | pg-boss queue sizes and oldest job age, exported every minute as metrics | alert when oldest `notify` job > 5 min |
| DB | `pg_stat_statements` top 20 weekly, Supabase advisors, replication lag | |
| Ops dashboard | reads the replica (or Postgres views refreshed every 5 min), never the primary on page load | |
| Uptime | external checks on `/api/health`, sign-in page, public form | availability only, not latency |

## 11.9 Known risks and fixes

Risks found in review of revision B (full register with verdicts in chapter 13 §13.6). Severity: **High** hurts
before ~300 orgs, **Medium** before ~1,500, **Low** minor or later.

| # | Risk | Severity | Fix | Where | Phase |
|---|---|---|---|---|---|
| R1 | Polling every 15 s is ~31 % of database work; the old capacity table ignored it | High | 60 s poll of a small per-project version endpoint now; Realtime hints later; capacity table redone with polling and 3 queries per page | §11.6, ch. 10 §10.6 | 0 (poll), 2 (Realtime) |
| R2 | Rate-limit counters in Postgres on hot paths | High | IP limits at the edge (Vercel Firewall); per-user limits in Upstash / Vercel KV when traffic grows; Postgres counters only for low-volume limits | §11.4, ch. 06 §6.8 | 0 |
| R3 | Hot row in `node_rollup_dirty` (project and every ancestor team) | High | `ON CONFLICT DO NOTHING` when already dirty; bump only when a rollup is running; cap the debounce — finding D21 | ch. 02 §2.9 | 0 |
| R4 | Serverless connection pool too large | High | 1–2 per instance; record the pooler's client limit for our tier | §11.5 | 0 |
| R5 | No statement timeout outside WQL | High | Per-role `SET LOCAL` limits plus login-role backstops | §11.5 | 0 |
| R6 | Single worker, all queues | High | 2 light replicas with health checks; heavy queues (meetings, imports, embeddings) in their own deployment | §11.3 | 0 |
| R7 | Outbox relay double-processing | Medium | Already safe: `FOR UPDATE SKIP LOCKED` + lease in `sys_outbox_claim`; keep it that way | §11.3 | — |
| R8 | Table bloat on churn tables | Medium | Per-table autovacuum; monthly partitions past 20 M rows | §11.4 | 1–2 |
| R9 | Stale reads from a replica | Medium | Primary for 10 s after a person's write; replica only for lag-tolerant pages | §11.7 | when a replica is added |
| R10 | HNSW index outgrows RAM; RLS filtering lowers recall | Medium | Embed less; per-org partial indexes for large tenants before ~5 M chunks; exact scans for small orgs | ch. 04 §4.17 | 2+ |
| R11 | Noisy neighbour | Medium | Per-org request budget; per-org worker concurrency for imports and automation | §11.6 | 1–2 |
| R12 | A → B treated as a config switch | Medium | Planned as a 6–8 week migration project; every job enqueued through the outbox | ch. 03 §3.6, §3.8 | later |
| R13 | Sharding blockers unknown | Low | Listed: users in many orgs, `sys_*` cross-org functions, global unique keys (task keys are per org, but emails, tokens and provider account ids are global) | §11.12 | — |
| R14 | AI route timeout at 60 s | Low | Stream long responses; raise the limit on Vercel Pro; long work to the worker | ch. 08 §8.4 | 1 |
| R15 | Automation rule cache differs between relay replicas | Low | `LISTEN/NOTIFY` invalidation on `config.changed` + 5 min TTL | ch. 07 §7.6 | 3 |
| R16 | Rank rebalance makes every open board get 412 | Low | No `version` bump for rank-only changes; run off-hours | ch. 05 §5.4 | 1 |

## 11.10 SLOs, stated honestly (review #27)

The request path depends on Vercel, Supabase (Postgres, Auth, Storage) and, for meetings and automation, the
worker host. Availability multiplies along a chain:

| Path | Components | Composite (if each meets its target) |
|---|---|---|
| Sign in and use the app | Vercel 99.99 % × Supabase DB 99.9 % × Supabase Auth 99.9 % | ≈ **99.79 %** (≈ 1.5 h/month) |
| Background (email, automation, meetings) | the above × worker host on Railway/Fly 99.9 % | ≈ 99.7 % |

Supabase publishes uptime but its SLA comes with higher-tier plans; on Pro, treat 99.9 % as an expectation, not
a contract. So the external promise is **99.5 % monthly** for the app until the stack has a measured record,
and the internal target stays 99.9 %.

| SLO | Target | Measured by |
|---|---|---|
| Availability (app) | 99.5 % external / 99.9 % internal | uptime checks |
| Read latency | p95 ≤ 300 ms | Vercel function metrics |
| Write latency | p95 ≤ 400 ms | same |
| Mention/request email | 95 % within 5 min | `email_deliveries` |
| Automation start | 95 % within 60 s of the event | `automation_runs` vs outbox time |
| Meeting notes | 95 % within 30 min of transcript | meeting timestamps |
| Webhooks | 99 % within 5 min to healthy endpoints | `webhook_deliveries` |

## 11.11 Backup and disaster recovery (review #24, #25, #26)

| Item | Revision B | Revision C |
|---|---|---|
| Database | daily backups (RPO 24 h); PITR deferred to a later date | **From the first paying customer: PITR add-on** (RPO ≈ minutes; Supabase prices it per retention window — check, it is roughly the cost of the rest of the launch stack). **Before that, and as a second copy after:** a worker job takes a `pg_dump --format=custom` every 6 h to a bucket in another provider/region (Cloudflare R2 or S3), kept 14 days. RPO 6 h without PITR |
| Files | weekly sync to a second region (RPO 7 days) | **daily** incremental sync of `workspace-attachments` to the same off-site bucket (only new objects; a few cents a month at launch volume) |
| Restore drill | quarterly | quarterly, plus after every Postgres major upgrade |
| Regional outage | not covered | written plan below |

**Regional outage plan (Mumbai unavailable for hours).** Accept downtime; no hot standby at this size.
1. Status page and in-app banner (served from Vercel's edge, which is multi-region).
2. If the outage is expected to exceed 4 h: create a Supabase project in Singapore, restore the latest off-site
   dump, point `DATABASE_URL` at it, copy files from the off-site bucket, redeploy. Target RTO 4 h, RPO = age of
   the last dump (≤ 6 h) or PITR point if the region's backups are reachable.
3. Afterwards, reconcile writes made in the new region if the old one returns with newer data (rare; manual).

**Vertical scaling** (review #15): changing Supabase compute restarts Postgres (minutes of downtime). Schedule it
in the lowest-traffic window (Sunday 02:00 IST), announce it 48 h ahead in the app banner and by email to Owners.

## 11.12 Scaling path (revised order)

1. Indexes and query shape (top 20 from `pg_stat_statements`).
2. A 60 s version poll (Phase 0), then Realtime hints instead of polling (Phase 2).
3. Connection hygiene and timeouts (§11.5).
4. Caches of computed views (rollups, gadgets 60 s, progress summary 1 h).
5. Move work out of Postgres in the §11.4 order.
6. Bigger Postgres compute (scheduled), then a read replica with the §11.7 rules.
7. Partition churn tables.
8. More worker replicas per queue group.
9. Architecture B as a **project**, not a switch (chapter 03 §3.8).

**Sharding blockers** (review #17), written down so nothing makes them worse: `users` and `memberships` span
orgs (one person, many orgs); `sys_*` functions look up rows across orgs (public forms by token, email claims,
rate limits, Zoom account → org); `zoom_webhook_events` and `integrations` are keyed by provider account. A future
split by org would need a global directory (users, memberships, tokens → org → shard) in front of the shards.
New tables must keep `org_id` on every row and avoid new cross-org queries outside `sys_*` functions.

## 11.13 CI/CD

Existing: install → lint (core boundary) → architecture AST test → DB roles → build db → migrate → tests → build.

| Add | Trigger | Purpose |
|---|---|---|
| Build the three Docker images | every PR | Dockerfiles can't go stale again |
| Role-matrix route test | every PR | permission regressions |
| Playwright smoke (6 journeys) | every PR against the preview URL | real browser |
| Migration safety lint | PR touching `migrations/` | no `NOT NULL` without default on big tables; `CONCURRENTLY` for indexes on tables > 1 M rows |
| Bundle size check | PR touching `apps/web` | 150 KB per route |
| DAST baseline | nightly on staging | headers, XSS, auth |
| Deploy | merge to `master` | migrations first (backward compatible: expand → migrate → contract), then Vercel and worker images |

## 11.14 Operating costs (revised)

| Item | Revision B | Revision C |
|---|---|---|
| Worker | $5–10 | $10–20 (2 × light + 1 × heavy) |
| PITR | later | from first paying customer (largest new line; check current Supabase price) |
| Off-site dumps and file sync | — | < $2 at launch volume |
| Sentry with tracing | free → $26 | $26 from Phase 0 |
| Realtime | — | within Supabase Pro included usage at launch |
| Redis (rate limits, per-org budgets) | — | $0 (free tier) until step 2 of §11.4 triggers |

The paid-launch total in chapter 08 §8.8 rises accordingly; the per-org cost stays a small fraction of the
price.
