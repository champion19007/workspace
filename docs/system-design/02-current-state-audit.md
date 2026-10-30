# 02 — Current-state audit

This chapter records what exists on 2026-10-29 (PR #2 at `752e2a4`), where it lives, how good it is, and what
is wrong with it. §2.8 lists what changed since revision A.

## 2.1 Branches and where the real product is

| Branch | Head | Contents | Verdict |
|---|---|---|---|
| `master` (local) | `b0c3192` | Stages 1–17b: foundation, RLS, auth, shell, API, tree, tasks, views, rollups, docs, Zoom intake, transcripts, routing, extraction, dedup, approvals, runtime RLS roles | Behind `origin/master` by PR #1 (CI fix, monotonic UUIDv7). Pull before branching |
| `claude/festive-jackson-e054a2` | `5b9884b` | PR #1 (merged): CI against pgvector, monotonic `generateUuidV7` | Merged |
| `claude/ecstatic-noyce-8113f6` | `f9afd03` | One design system across the app; restyled sign-in and onboarding; portals for dialogs | Contained in PR #2 |
| `claude/xenodochial-moser-457001` | `87a834d` | Vercel + Supabase deploy; invitations and member management | Contained in PR #2 |
| **`claude/upbeat-jemison-2f0f25`** | `752e2a4` (pushed) | **PR #2**: everything above, plus access levels (Executive/Client), comments, @mentions, notification bell, files, Calendar, Timeline, start dates, request forms + Inbox, AI helpers (notes from pasted transcript, Progress summary, Ask AI), and since `752e2a4` **emailed invitations, mention/request emails, daily digest, one-click unsubscribe, 6-digit sign-in codes and shared rate limits** (`0021`) | **The product.** This guide audits this branch |
| `claude/wonderful-mayer-70280c` | `7da8dcf` | Dev-server start fixes; LTD screen-by-screen research report | Not in PR #2; merge the dev fixes |
| `claude/eloquent-*` | `b0c3192` | Empty (same as master) | Delete |

**Action:** land PR #2 (the `0021` work is now committed), then rebase `wonderful-mayer` on it. Local `master`
is 3 commits behind `origin/master`; pull before branching. Until then,
every new branch should start from `claude/upbeat-jemison-2f0f25`, not `master`.

## 2.2 Repository shape

```
apps/
  web/        Next.js 15 App Router: UI + BFF route handlers (the API the browser uses on Vercel)
  api/        Fastify 5: REST /api/v1, Zoom webhooks, OpenAPI, rate limit, idempotency, If-Match
  worker/     Node process: outbox relay, Zoom poller, transcript, routing, extraction, enrichment handlers
  lambdas/    Placeholder for Architecture B edge handlers
packages/
  core/       Pure domain: Zod schemas, ports, roles, ETag, pagination, comments, files, requests, AI, Zoom VTT
  adapters/   Port implementations: queue (pg-boss/SQS), realtime, LLM (Anthropic/Bedrock + Voyage), blob store,
              auth (Supabase/Cognito), secret store, Zoom, email (in progress)
  db/         Drizzle schema, 21 SQL migrations, *-operations.ts data access, RLS helpers, fixtures
  prompts/    Versioned prompts and Zod output contracts
  evals/      Golden-set evaluation runner
infra/        AWS CDK (only network-stack.ts exists)
docs/         Requirements tracker, roadmap, decision log (117 KB), API conventions, UI reference,
              product review, Vercel deploy guide, research reports
```

Size: 69 test files, 21 migrations, 35 web pages, 66 web API route files, 13 Fastify route modules.

## 2.3 Stage-by-stage status

| Stage | Name | Status | Evidence | Comment |
|---|---|---|---|---|
| 1 | Foundation | Built | 5 ports, ESLint + AST boundary test, health endpoints | Strong |
| 2 | Database and multi-tenancy | Built | `0001`, 26 isolation tests, compound FKs, `prevent_org_id_mutation()` | Strong |
| 3 | Auth and sessions | Built | Google OIDC + magic link, `session_epoch`, RBAC | Strong |
| 4 | App shell | Built and restyled | `components/shell/*`, design tokens | Good |
| 5 | API contracts and async | Built | RFC 9457, `Idempotency-Key`, outbox with `SKIP LOCKED` | Strong, but only in Fastify; web routes don't all honour `Idempotency-Key` |
| 6 | Tree | Built | `nodes.path` ltree, subtree moves | Good |
| 7 | Tasks | Built | keys `ENG-142`, `If-Match`, fractional `rank` | Good; statuses fixed |
| 8 | Views | Built | Board, List, My Tasks | List lacks grouping/column picker |
| 9 | Health rollups | Built + repaired on read | `node_rollup_dirty`, `ensureFreshProjectRollup` | Repair logic duplicated three times |
| 10 | Docs and versions | Built | `docs`, `doc_versions` (30 kept), restore | Docs are flat per project (no page tree) |
| 11–13 | Zoom connect, webhooks, transcripts | Built (API + worker) | HMAC checks, poller, VTT normaliser | Not runnable on Vercel |
| 14 | Routing | Built | `routing_*` on meetings, AskHost branch | Needs worker |
| 15 | Extraction | Built | windows, evidence check, `ai_usage_ledger` | Needs worker |
| 16 | Dedup and enrichment | Built | `task_embeddings` vector(1024), cosine ≥ 0.85 | No ANN index (see 2.6) |
| 17 / 17b | Approvals, runtime RLS | Built | `action_item_decisions`, `workspace_api` / `workspace_worker` roles | Strong |
| PR #2 | Access levels, comments, files, calendar, timeline, request forms, AI helpers | Built | `0016`–`0020` | Good, see faults below |
| Phase 0 | Email, sign-in codes, rate limits | Built (`752e2a4`) | `0021`, `lib/email.ts`, `lib/rate-limit.ts`, `lib/sign-in.ts`, `api/auth/verify-code`, `api/cron/daily`, `api/email/unsubscribe`, `EmailPort` + Resend adapter; tests `email.test.ts` (db, web), `sign-in-code.test.ts`, `comments.test.ts` | Good. See E1–E4 below |
| 18 | AI eval and cost tracking | Partial | ledger exists; no budget cap | Budget cap is P0 before launch |
| 19 | Collaboration and notifications | Built in PR #2 | `commentRecipients()`: mentioned people, assignee, creator, latest 10 commenters | Email digest built |
| 20 | Realtime | Not built | ports exist, no client subscription | Polling is enough for now (chapter 10 §10.6) |
| 21 | Ask AI / manual upload | Ask AI built (keyword search); upload not built | `ai/ask/route.ts` | Ask AI feeds the model numbered sources from `getLeadershipSummary` (≤ 25 projects, ≤ 10 at-risk tasks) plus `searchWorkspace` keyword matches, and keeps only cited sources. No vector search yet (D8). Limited to 30 AI calls per person per hour (`aiRateLimited`, built) |
| 22 | Privacy | Partial | retention days column, redacting logger | Export/erasure not built |
| 23–25 | AWS, migration, launch | Not built | only `network-stack.ts` | Stay on Architecture A (chapter 11) |

## 2.4 What is good (keep it)

1. **Security model.** RLS forced on every tenant table, a non-superuser runtime role with no `BYPASSRLS`,
   `SET LOCAL` per transaction, RESTRICTIVE policies for private projects and clients, compound foreign keys
   `(org_id, id)` so rows can't point across tenants, `SECURITY DEFINER` `sys_*` functions as the only way across
   orgs. This is better than most commercial SaaS. Do not weaken it for convenience.
2. **Ports and adapters with an enforced boundary.** `packages/core` cannot import cloud SDKs (ESLint + AST test
   in CI). Swapping Supabase for Cognito or pg-boss for SQS is a config change.
3. **Concurrency and idempotency.** Integer `version` columns with `If-Match`/`ETag`, `412` on conflict, and a
   "keep mine / use theirs" prompt in the UI. Postgres-backed idempotency keys with 24 h TTL.
4. **AI is evidence-bound and human-approved,** with a usage ledger recording tokens and INR cost per call.
5. **Docs culture.** The decision log (ADRs) and requirements tracker make intent recoverable.
6. **Plain-language UI work** in PR #2 (access levels named Owner/Manager/Developer/Executive/Client; Get
   started checklist; honest empty states).

## 2.5 Defects and risks found

Severity: **H** = can lose data, leak data or block launch; **M** = wrong behaviour or cost; **L** = polish.

| # | Sev | Finding | Where | Fix |
|---|---|---|---|---|
| D1 | H | Two backends implement orgs, members and tasks (Next.js routes and Fastify) and have drifted once | `apps/web/src/app/api/*`, `apps/api/src/routes/*` | Chapter 03 §3.5: web routes own browser traffic; Fastify owns webhooks, public API, MCP |
| D2 | H | No per-org AI spending cap; `orgs.ai_budget_inr` exists but nothing enforces it. The per-person limit (30/h) caps one person, not an org of 200 | AI routes | Check month-to-date `ai_usage_ledger` sum before each call; refuse at 100 %, warn at 80 % (chapter 08 §8.6). **Still open at `752e2a4`** |
| D2b | H | The LLM adapter sends `temperature` only to `claude-haiku-4-5` (`SAMPLING_MODELS`), and the AI routes pass `temperature: 0`. On API version `2026-10-21` any `temperature`/`top_p`/`top_k` is a 400 on every model, and Claude Haiku 5.5 already rejects non-default values | `packages/adapters/src/llm/index.ts`, `ai/*/route.ts` | Stop passing `temperature` from routes; delete the field from the adapter when moving to Haiku 5.5 or upgrading the SDK (chapter 08 §8.4). **Still open at `752e2a4`**: models are still `claude-haiku-4-5` / `claude-sonnet-5` |
| ~~D3~~ | — | ~~`0021` and `commentRecipients()` uncommitted~~ | — | **Fixed in `752e2a4`** |
| D4 | M | Uploads limited to 4 MB (Vercel request body) | files route | Signed direct-to-storage uploads (chapter 06 §6.6) |
| D5 | M | Fixed status set `todo/in_progress/done/blocked`; "blocked" is a status rather than a relation | `chk_task_status` | Workflows + `task_links` (chapter 04 §4.5, §4.8) |
| D6 | M | `rank` strings never rebalanced; repeated inserts between the same two cards grow the string (max 128 chars → insert failure) | `tasks.rank varchar(128)` | Rebalance job when length > 64 (chapter 05 §5.4) |
| D7 | M | No ANN index on `task_embeddings.embedding`; dedup does a sequential scan per org | `0013` | `CREATE INDEX … USING hnsw (embedding vector_cosine_ops)`; filter by `org_id` first (chapter 04 §4.17) |
| D8 | M | `chunks` table has no `embedding` column, so Ask AI can't do semantic search over docs/tasks yet | schema §18 | Add `embedding vector(1024)` + `tsv tsvector` (chapter 04 §4.13) |
| D9 | M | One time zone per deployment (`NEXT_PUBLIC_APP_TIME_ZONE`) | config | `users.time_zone` + `orgs.time_zone`; compute "today" per viewer |
| D10 | M | Rollup repair logic exists three times | `getPermissionSafeRollup`, `getLeadershipSummary`, `ensureFreshProjectRollup` | One helper |
| D11 | M | `comments.target_type` check allows `meeting` in `0001` but core schema allows only `task/node/doc` | `chk_comments_target_type` vs `CommentTargetTypeSchema` | Align; keep `meeting` in DB for meeting comments later |
| D12 | M | `outbox` index `idx_outbox_unprocessed` is on `(id, created_at)` without a `WHERE sent_at IS NULL` predicate | `0001` | Partial index `WHERE sent_at IS NULL` |
| D13 | M | `activity_log` has one index `(org_id, created_at)`; the task activity tab will need `(org_id, target_type, target_id, created_at)` | `0001` | Add index |
| D14 | M | Notifications have no retention; table grows forever | `notifications` | Nightly delete read notifications > 90 days |
| D15 | L | Doc list previews show raw Markdown | doc excerpt | Strip Markdown server-side |
| D16 | L | `labels` are org-wide with unique name; fine, but no per-project label sets | `labels` | Keep org-wide (simpler); add `archived_at` |
| D17 | L | `priority` list fixed; Atlassian has 5 levels | `chk_task_priority` | Keep 4 levels; allow renaming display only |
| ~~D18~~ | — | ~~Public request form's IP rate limit was per server instance~~ | `r/[token]` | **Fixed in `752e2a4`** (shared `rate_limit_counters`) |
| D19 | M | Health endpoints and `/api/v1/status` in Fastify expose active providers; fine internally, should not be public on the internet | `apps/api` | Restrict to internal network or require a header |
| D20 | L | `infra/` CDK has only the network stack; roadmap promises 8 stacks | `infra/src/stacks` | Defer until revenue (chapter 11) |

## 2.6 Technical debt register

| Debt | Cost of leaving it | Cost of fixing | When |
|---|---|---|---|
| Two backends (D1) | Every feature built twice or drifts | 2–3 days to move remaining overlapping routes | Before Phase 1 |
| Fixed statuses (D5) | Blocks templates, the #1 onboarding feature | 4–6 days (migration + UI) | Phase 1 |
| No ANN index (D7) | Dedup slows past ~50k tasks per org | 1 hour | Now |
| No semantic chunks (D8) | Ask AI answers only from what fits in a prompt | 2 days | Phase 2 |
| Per-deployment time zone (D9) | Wrong "overdue" for distributed teams | 1–2 days | Phase 1 |
| No realtime | Two people on one board see stale cards until reload | Polling: 0.5 day; Supabase Realtime: 2 days | Phase 2 |
| Worker can't run on Vercel | Zoom pipeline unusable on the cheap stack | Host worker on Railway/Fly/Render: 1 day + ~$5–10/month | Phase 2 |

## 2.7 Test coverage

- **Database:** strong — isolation, runtime RLS, approvals RLS, dedup, extraction, routing, comments, email
  (new), auth operations.
- **API (Fastify):** strong for conventions, approvals, tasks, docs, Zoom, routing.
- **Web:** journey tests per feature (`*-journey.test.ts`) hit route handlers with a real database.
- **Email (new in `752e2a4`):** claim functions, preferences, rate-limit counter, RLS for the new tables, email
  rendering, sign-in code flow.
- **Missing:** browser end-to-end tests (Playwright) for the six core journeys, load tests, and tests that each
  role (Owner/Manager/Developer/Executive/Client) gets exactly the right answer from every route. Add a
  **role-matrix test** that loops over routes × roles and checks status codes; it is the cheapest way to keep
  the permission model honest as routes grow.

## 2.8 Changes since revision A (commit `752e2a4`, 2026-10-28 23:07 IST)

| Area | What landed | Effect on this guide |
|---|---|---|
| Email | `EmailPort` (`packages/core/src/ports/email.ts`) with two streams, `transactional` (sign-in, invitations) and `notifications` (mentions, requests, digests); Resend adapter, plus a `console` adapter for development (`EMAIL_PROVIDER`) | Chapter 03 port list: `EmailPort` is built |
| Invitations | Emailed through Resend; the inviter still sees the link | Gap "no emails" in the product review is closed |
| Instant email | Mentions and new requests emailed right after the response (`after()` → `sys_email_claim_instant`) | §5.9 rules updated |
| Daily digest | Vercel cron `30 3 * * *` (03:30 UTC = 09:00 IST) calls `/api/cron/daily` with `CRON_SECRET`; batches of 25 people for up to 45 s | §5.9, §6.2 |
| Unsubscribe | HMAC-signed one-click links (RFC 8058) + confirmation page; switches on Profile | §6.2 |
| Sign-in codes | 6-digit code from the sign-in email, `POST /api/auth/verify-code`; session start shared in `lib/sign-in.ts` | §6.2, §9.4 |
| Rate limits | Postgres counters shared by all instances: sign-in email 5/h per address and 20/h per IP, codes 5 per 15 min per address, invitations 100/day per org, request form 5 per 10 min, AI 30/h per person, uploads 60/h per person | §6.8 marks these built |
| Comment recipients | `commentRecipients()`: people mentioned, task assignee, creator, latest 10 earlier commenters, minus the author | §5.9 |
| Deploy guide | Resend domain (SPF, DKIM, DMARC), Supabase SMTP and code template, `CRON_SECRET`, backups, Sentry, and hosting the Zoom worker on Railway/Render/Fly | Chapter 11 |

Unchanged and still open: **D2** (per-org AI budget), **D2b** (`temperature`, models still Haiku 4.5 / Sonnet 5),
D1, D4–D17, D19–D20.

### New findings in the email work

| # | Sev | Finding | Where | Fix |
|---|---|---|---|---|
| E1 | L | Email is **at most once** by design: a notification is marked `emailed_at` when claimed, so a failed send is logged and never retried (the in-app notification still shows) | `sys_email_claim_*`, `deliver()` | Acceptable now. When delivery matters more, record sends in `email_deliveries` (chapter 04 §4.15) and retry `failed` rows once from the cron |
| E2 | M | The digest goes out at 03:30 UTC for everyone, so people outside India get it at the wrong local hour | `vercel.json` cron | With per-person time zones (D9), run the cron hourly and pick people whose local time is 09:00 |
| E3 | M | One daily run sends at most what fits in ~45 s (batches of 25). Past a few thousand recipients, the rest wait a day, and the 2-day lookback in `sys_email_claim_digests` can then drop items from the email (they stay in the app) | `/api/cron/daily`, `0021` | Hourly runs (E2) spread the load; at scale move digests to the worker queue (`notify` job) |
| E4 | L | Instant emails ride on `after()` of the request that created the notification. If that function is cut short, the mention waits for the next mention/request in any org, or for the digest | `emailNotificationsSoon` | A per-minute cron (`/api/cron/minute`, Vercel Pro) that drains `sys_email_claim_instant` closes the gap |

## 2.9 Findings added in revision C (from the external review, checked against the code)

| # | Sev | Finding | Where | Fix |
|---|---|---|---|---|
| D21 | M (H at scale) | Marking a rollup dirty runs `INSERT … ON CONFLICT (node_id) DO UPDATE` **for the project and every ancestor team**, so every task write in an org updates (and row-locks until commit) the same root-team row. Each write also pushes `debounce_until` forward and clears `locked_at`, so a busy project can postpone its own rollup indefinitely and reset a rollup that is running | `packages/db/src/rollup-operations.ts` (~line 157) | `INSERT … ON CONFLICT DO NOTHING` (takes no row lock on conflict); only when the existing row is `locked_at IS NOT NULL` (a rollup is running) bump `dirty_generation` with a separate `UPDATE … WHERE locked_at IS NOT NULL`. Never move `debounce_until` later than first-request + 30 s. Severity is Medium today (few concurrent writers per org), High once orgs have dozens of concurrent editors |
| D22 | H | Database pool is 5 connections per web instance (`server-context.ts`), 10 in `.env.example`. On Vercel every warm instance holds its own pool, so the pooler's client-connection limit can be reached by instance count alone | `apps/web/src/lib/server-context.ts`, `.env.example` | Read `DB_API_POOL_SIZE` and set it to 2 on Vercel (chapter 11 §11.5) |
| D23 | M | No `statement_timeout`, `idle_in_transaction_session_timeout` or `lock_timeout` anywhere | login roles | Set them on `workspace_api` and `workspace_worker` in a migration (chapter 11 §11.5) |
| D24 | M | The Docker images are stale: `Dockerfile.web` builds only core and web while Next.js loads db/adapters/prompts as external packages; no `standalone` output; compose runs only Postgres | `infra/docker/*`, `docker-compose.yml` | Chapter 11 §11.2; build images in CI |
| D25 | M | Rank rebalancing as designed in revision B bumped every card's `version`, which would 412 every open board | chapter 05 §5.4 design | Don't bump `version` for rank-only changes; moves are sent as neighbour ids, so a stale rank never matters (§5.4 revised) |

Two review points were already handled in the code: the outbox relay claims with `FOR UPDATE SKIP LOCKED`
and a lease (`sys_outbox_claim`), and request code doesn't enqueue jobs directly. See chapter 13 §13.6 for the
full register.
