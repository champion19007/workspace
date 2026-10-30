# 13 — Appendix

## 13.1 Vocabulary map (Atlassian → Workspace)

| Atlassian | Workspace PM view | Workspace Dev view | Stored as |
|---|---|---|---|
| Site / organization | Organization | Organization | `orgs` |
| Space (Jira project) | Project | Project | `nodes` (`kind='project'`) |
| Space category | Team | Team | `nodes` (`kind='team'`) |
| Work item / issue | Task | Issue | `tasks` |
| Epic | Milestone | Epic | `tasks` with `work_types.level = 1` |
| Sub-task | Subtask | Subtask | `tasks` with level −1 |
| Status | Step, in plain words (ch. 01 §1.6) | Status (its own name) | `workflow_statuses` (+ `stage`) |
| Status category | (hidden) To do / Doing / Done | Category | `workflow_statuses.category` |
| (none) | Stage, shown as Later / To do / Doing / Almost done / Waiting on … / Done / Dropped | Stage | `workflow_statuses.stage` |
| Workflow | Steps template | Workflow | `workflows` |
| Field / custom field | Extra field | Custom field | `field_definitions`, `tasks.custom` |
| Screen / screen scheme | — | Field layout | `field_layouts` |
| JQL | View / filter chips / Ask in words | WQL | `saved_filters` |
| Filter | Saved view | Filter | `saved_filters` |
| Dashboard + gadget | Dashboard + card | Dashboard + gadget | `dashboards`, `dashboard_gadgets` |
| Automation flow / rule | Automation | Rule | `automation_rules` |
| Work item collector / JSM portal | Request form | Request form | `request_forms`, `requests` |
| Confluence page | Doc | Doc | `docs` |
| Space role | Project role | Project role | `project_roles` |
| Global permission | Organization level | Organization role | `memberships.role` |
| Administrator | Owner / Manager | Owner / Manager | `owner` / `admin` |
| Member | Developer | Developer | `member` |
| Viewer | Executive | Executive | `viewer` |
| (none) | Client | Client | `client` |
| Goal / key result | Goal / key result | Goal / key result | `goals` |
| Kudos, voting, labs | — | — | skipped |

## 13.2 Glossary

| Term | Meaning |
|---|---|
| **BFF** | Backend-for-frontend: the Next.js route handlers that serve the browser |
| **RLS** | Postgres row-level security: policies that filter rows per tenant/user inside the database |
| **Tenant context** | `app.org_id`, `app.user_id` set with `SET LOCAL` at the start of each transaction |
| **Outbox** | Table written in the same transaction as a change; a relay publishes its rows to queues later |
| **Rollup** | Cached counters on a tree node (tasks by category, overdue, health) |
| **Rank** | Base-62 fractional string ordering cards in a column |
| **WQL** | Workspace Query Language, a safe subset of JQL compiled to parameterised SQL |
| **Category** | One of `todo`, `in_progress`, `done`; what every progress calculation reads |
| **View** | Dev, PM, Founder or Client: a per-person presentation of the same data (`memberships.view`); never a permission boundary |
| **Stage** | What a workflow status means (`backlog … cancelled`); each view translates it into its own words (chapter 01 §1.6) |
| **Evidence** | Transcript quotes `{seq, quote}` attached to each AI-suggested action item |
| **Ledger** | `ai_usage_ledger`, one row per AI call with tokens and INR cost |
| **Architecture A / B** | Vercel + Supabase + Anthropic (now) / AWS ap-south-1 + Bedrock (later) |

## 13.3 Checklists

### Adding a table

- [ ] `id uuid DEFAULT uuid_generate_v7()`, `org_id NOT NULL`, `UNIQUE (org_id, id)`
- [ ] compound FKs to parents
- [ ] `created_at`, and `updated_at` + `version` if editable
- [ ] RLS enabled + forced; baseline + RESTRICTIVE project policy (§4.18); grants to `workspace_app`, `workspace_system`
- [ ] `prevent_org_id_mutation` trigger
- [ ] Drizzle definition in `schema/index.ts` and Zod schema in core
- [ ] RLS test in `runtime-rls.test.ts`; role-matrix entries for new routes
- [ ] index for every foreign key used in a join and every list query's `ORDER BY`

### Adding an endpoint

- [ ] Zod request schema in core; DTO type in core
- [ ] session/token auth; tenant resolution; role check
- [ ] `If-Match` on update/delete; `Idempotency-Key` on create
- [ ] rate-limit rule if public, AI, upload or bulk
- [ ] side effects only via outbox
- [ ] RFC 9457 errors with stable `code`
- [ ] journey test (web) or route test (Fastify)

### Adding an AI feature

- [ ] prompt in `packages/prompts` with version and Zod output schema
- [ ] tier chosen by the table in chapter 08 §8.2; effort set
- [ ] input contains only what the caller may see
- [ ] output is a suggestion a person confirms (or the feature is read-only, like summaries)
- [ ] budget check + per-person limit + ledger row (also on failure/refusal)
- [ ] cost line added to chapter 08 §8.3
- [ ] eval cases in `packages/evals` if the output becomes data

### Release

- [ ] migrations backward compatible with the running app version
- [ ] CI green incl. Playwright smoke
- [ ] staging soak 24 h for migrations touching `tasks`
- [ ] changelog entry in Help → What's new

## 13.4 Screenshot index

| Range | Product area |
|---|---|
| 4–20 | Jira onboarding: kind of work, name, work types, statuses, welcome carousel |
| 21–26 | Space views (List, Board, Calendar, Timeline, Docs, Forms), For you home, starred |
| 27–33 | Apps marketplace |
| 34–43 | Spaces directory, templates panel, dashboards list, customise sidebar, app switcher, settings menu |
| 44–49 | Personal settings: general, labs, email and notifications, digests |
| 50–68 | Admin: general configuration, options, beta features, audit log, access, space roles, global permissions, work item collectors |
| 69–197 | Automation: templates by category, filters by app and trigger, usage, audit log with ~500 actions and ~60 triggers, status legend (188), flows, AI-created flows |
| 198–211 | User defaults, default dashboard and gadget gallery, look and feel, announcement banner, backup manager |
| 212–223 | Import (CSV and apps), mail settings (outgoing, incoming handlers, DMARC) |
| 224–246 | Permission helper, admin email audit, admin search, manage filters/dashboards, attachments, events, LexoRank |
| 247–262 | Webhooks, space configuration, storage, custom onboarding, application links, DVCS |
| 263–323 | Manage spaces, space template gallery by category, space categories, trash, archive |
| 324–360 | Work types, hierarchy, schemes, workflows, screens, fields (87), field schemes, priorities, time tracking, linking, statuses, resolutions, security, notification and permission schemes, apps, OAuth credentials |
| 361–373 | Quick create modal, feedback, full create form, help panel |
| 374–398 | Teams: profiles, kudos, teams directory; Goals: directory, status updates, create goal, goal detail tabs |
| 399–409 | Atlassian account: profile and visibility, email, security, privacy, preferences, connected apps, link preferences |
| 410–454 | Loom: library, meetings, watch later, settings, notifications, integrations, shortcuts, users and groups, workspace settings |
| 455–459 | Loom meeting settings, Atlassian home, Bitbucket |

## 13.5 Source files referenced

| Topic | File |
|---|---|
| Schema | `packages/db/src/schema/index.ts`, `packages/db/src/migrations/0001…0021` |
| Ports | `packages/core/src/ports/*.ts` |
| LLM adapter, models, prices | `packages/adapters/src/llm/index.ts` |
| AI routes | `apps/web/src/app/api/orgs/[orgId]/ai/{ask,meeting-notes,progress-summary}/route.ts`, `apps/web/src/lib/ai.ts` |
| Rate limiting | `apps/web/src/lib/rate-limit.ts`, `apps/api/src/plugins/rate-limit.ts`, migration `0021` |
| Comments rule | `packages/core/src/comments/index.ts` (`commentRecipients`) |
| Roles | `packages/core/src/auth/roles.ts`, migration `0016_client_role.sql` |
| API conventions | `docs/api-conventions.md` |
| Product review | `docs/product-architecture-review.md` |
| Deploy | `docs/deploy-vercel.md` |
| Decisions | `docs/decision-log.md` |

## 13.6 Review register (revision C, 2026-10-29)

An external review of revision B listed 33 flaws. Each was checked against the code before changing the doc.
**Accepted** = the doc changed as suggested. **Accepted, changed** = the problem is real but the fix differs.
**Already handled** = the code or doc already did it. **Partly accepted** = some of it holds.

| # | Review severity | Flaw (short) | Verdict | Where it's answered |
|---|---|---|---|---|
| 1 | High | No Dockerfiles | **Accepted, changed**: Dockerfiles exist (`infra/docker`) but are stale (web image builds only core and web, no `standalone`) — finding D24 | §11.2 |
| 2 | Medium | No full-stack compose | Accepted | §11.2 |
| 3 | High | Single worker | Accepted | §11.3 |
| 4 | High | One worker for all queues | Accepted | §11.3 |
| 5 | Medium | Relay has no single-active guarantee | **Already handled**: `sys_outbox_claim` uses `FOR UPDATE SKIP LOCKED` with a lease, so replicas can't double-send | §11.3 |
| 6 | Medium | A→B isn't an env-var switch | Accepted | §3.8 |
| 7 | Medium | SQS breaks transactional enqueue | **Already handled** in code (only the relay enqueues); rule made explicit | §3.6 |
| 8 | Low | Kubernetes skipped | Agreed, not a flaw | §11.2 |
| 9 | High | Postgres does everything | **Partly accepted**: deliberate for cost; an ordered move-out plan with measured triggers added | §11.4 |
| 10 | High | Rate-limit writes on every request | **Partly accepted**: edge rules for IP limits and Redis/KV for high-volume limits; low-volume limits stay in Postgres (they aren't load) | §6.8, §11.4 |
| 11 | High | Rollup dirty-mark hot row | **Accepted, and worse than stated**: the code also marks every ancestor team, extends the debounce on each write and clears a running rollup's lock — finding D21. Medium today, High at scale | §2.9, §12 Phase 0 |
| 12 | High | Pool of 10 per serverless instance | Accepted (code uses 5; still too many) — D22 | §11.5 |
| 13 | Medium | No vacuum plan | Accepted | §11.4 |
| 14 | Medium | Replica read-after-write | Accepted | §11.7 |
| 15 | Medium | Vertical scaling downtime | Accepted | §11.11 |
| 16 | Medium | `statement_timeout` only on WQL | **Accepted, changed**: set on the *login* roles (`workspace_api`, `workspace_worker`), because role settings don't apply on `SET ROLE workspace_app` — D23 | §11.5 |
| 17 | Low | Sharding blockers | Accepted | §11.12 |
| 18 | High | Polling ignored in capacity | **Accepted**: polling would be ~31 % of DB work; a 60 s version poll in Phase 0, Realtime hints in Phase 2 (revision C change list) | §10.6, §11.6 |
| 19 | Medium | One read per page | Accepted (3 queries per page assumed until measured) | §11.6 |
| 20 | Medium | No per-org quotas | Accepted | §6.8, §11.6 |
| 21 | Medium | HNSW must fit in RAM | Accepted | §4.17 |
| 22 | Medium | RLS filtering hurts vector recall | Accepted | §4.17 |
| 23 | Low | 60 s function limit | Accepted | §8.4 |
| 24 | High | RPO 24 h until PITR | Accepted (PITR from first paying customer; 6-hourly off-site dumps meanwhile and as a second copy) | §11.11, §8.8 |
| 25 | Medium | Weekly file sync | Accepted (daily) | §11.11 |
| 26 | Medium | No regional plan | Accepted | §11.11 |
| 27 | Medium | Composite SLO | Accepted (99.5 % external until measured) | §11.10 |
| 28 | Low | Per-minute Vercel Cron overlap | Accepted (pg-boss schedules once the worker runs) | §11.3 |
| 29 | Medium | No tracing | Accepted (Sentry tracing from Phase 0) | §11.8 |
| 30 | Medium | Ops dashboard on primary | Accepted | §11.8 |
| 31 | Low | Uptime checks ≠ latency SLOs | Accepted | §11.8 |
| 32 | Low | Rule cache inconsistency | Accepted (`LISTEN/NOTIFY` invalidation + 5 min TTL) | §7.6 |
| 33 | Low | Rebalance 412s every board | Accepted (no version bump for rank-only changes) | §5.4 |

Net effect on the plan: Phase 0 grows from 1 to 2 weeks (backups, pool and timeouts, hot-row fix, tracing,
edge limits), Realtime moves from Phase 3 to Phase 2 (with a 60 s poll in Phase 0), and the paid-launch infrastructure estimate rises from
$50–60 to $85–110 a month plus PITR.
