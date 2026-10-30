# 12 — Gap analysis and phased roadmap

> **Principle: don't chase full Atlassian parity before teams are using the product; build what the first
> startup teams ask for.**

The first target group is **startup teams of 2–15 people with both developers and non-developers** (chapter 01
§1.3). Phases 0–2 make the product worth using for them; everything else in the Atlassian catalogue waits for
real requests.

## 12.1 Parity matrix (revision C)

Legend: ✅ built · 🟡 partial · ⬜ missing · ✂️ out of scope for now (reason given).
Phase "3+" means: built only when customers ask for it, in the order they ask.

| Area | Feature | Status | Priority | Phase |
|---|---|---|---|---|
| Views | Role-based views: Dev and PM | ⬜ | P0 | 1 |
| Views | Status translation (stages on workflow statuses) | ⬜ | P0 | 1 |
| Views | Founder view | 🟡 (Progress page, Insights) | P1 | 1 |
| Views | Freelancer / client view (shared progress page, milestones, decisions, *shared* items only) | 🟡 (Client role + Progress lock) | P1 | 2 |
| Onboarding | AI project setup from a description | ⬜ | P0 | 1 |
| Onboarding | Project templates by job (~20) | ⬜ | P2 | 3+ (AI setup covers the first need) |
| Dev | GitHub integration (branches/PRs by key, status from PR events) | ⬜ | P0 | 1 |
| Dev | MCP server (Claude Code, Cursor, VS Code) | ⬜ | P0 | 1 |
| Dev | Keyboard-first command palette and shortcuts | 🟡 (launcher, basic shortcuts) | P0 | 1 |
| Dev | GitLab / Bitbucket | ⬜ | P3 | 3+ |
| Dev | Sprints + backlog | ⬜ | P1 | 3+ |
| Work | Configurable workflows (statuses, categories, stages) | ⬜ | P0 | 1 (minimum needed for translation) |
| Work | Transition rules (conditions/validators/post-functions) | ⬜ | P2 | 3+ |
| Work | Work types + hierarchy (milestone/task/subtask) | 🟡 (subtasks) | P1 | 3+ |
| Work | Custom fields + field layout | ⬜ | P2 | 3+ |
| Work | Task links (blocks/relates/duplicates/clones) | ⬜ | P1 | 1 (`blocks` needed for "Waiting on …") |
| Work | Watchers, reactions, flagged | ⬜ | P2 | 3+ |
| Work | Time tracking (estimates, worklogs, timer, report) | ⬜ | P1 | 3+ (freelancer requests) |
| Work | Bulk edit | ⬜ | P2 | 3+ |
| Search | Global search (key jump + full text) | 🟡 | P1 | 1 |
| Search | WQL + saved filters; "Ask in words" | ⬜ | P1 | 3+ |
| Docs | Docs with versions, restore | ✅ | — | — |
| Docs | Page tree, templates, restrictions, inline comments | ⬜ | P2 | 3+ |
| Collaboration | Comments, @mentions, bell, email, digest, unsubscribe | ✅ | — | — |
| Collaboration | Internal vs client-visible comments | ⬜ | P1 | 2 (client view) |
| Files | Uploads (≤ 4 MB) | 🟡 | P1 | 3+ (direct uploads when files grow) |
| Requests | Public forms → Inbox → task | ✅ | — | — |
| Meetings | Zoom → AI notes → approved tasks | ✅ (needs worker) | P0 | 1 (polish) |
| Meetings | Google Meet | ⬜ | P1 | 2 |
| Meetings | Microsoft Teams | ⬜ | P1 | 2 |
| Meetings | Webex | ⬜ | P3 | on customer demand |
| Meetings | Upload recording + speech-to-text fallback | ⬜ | P2 | 3+ |
| Insight | Configurable dashboards with gadgets | 🟡 (fixed Insights) | P2 | 3+ |
| Insight | Goals with updates and links | ⬜ | P2 | 3+ |
| Automation | Rules, recipes, audit log, usage | ⬜ | P2 | 3+ |
| Platform | Outbound webhooks, public REST API, API tokens | ⬜ | P1 | 1 (tokens, for MCP) / 3+ (webhooks, REST) |
| Platform | Realtime hints | ⬜ | P1 | 2 (60 s version poll in Phase 0) |
| Platform | Worker split, current Docker images, full-stack compose | ⬜ | P0 | 0 |
| Platform | PITR + off-site dumps + daily file sync | ⬜ | P0 | 0 |
| Platform | Per-org AI budget + free-tier meeting-minute cap | 🟡 (wired, rule pending) | P0 | 0 |
| Admin | Project roles, permission helper, audit log page, branding | ⬜ | P2 | 3+ |
| Admin | Import (CSV, Trello, Asana, Jira CSV) | ⬜ | P2 | 3+ |
| Admin | Export incl. Jira-compatible CSV | ⬜ | P1 | 1 ("easy to leave", ch. 01 §1.7) |
| Account | Sign-in codes; per-person time zone | ✅ / ⬜ | — / P1 | — / 1 |
| AI | Ask AI, Progress summary, notes from paste | ✅ | — | — |
| AI | Haiku 5.5 / Sonnet 5.5 switch, `temperature` removed | 🟡 (working tree) | P0 | 0 |
| ✂️ | App marketplace and its ~500 connector actions | ✂️ | — | Webhooks, API and MCP cover the long tail |
| ✂️ | Work item security levels, screens per transition, field contexts | ✂️ | — | Private projects, client role and one field layout are enough |
| ✂️ | Voting, kudos, labs, application links | ✂️ | — | No demand from the target group |
| ✂️ | Rebuilding Loom | ✂️ | — | Meetings pipeline + video files cover it |
| ✂️ | Custom priority schemes | ✂️ | — | Four fixed levels are enough |

## 12.2 What to improve in what exists

1. ~~Commit and test `0021`~~ — done in `752e2a4`. Email follow-ups E2–E4 (chapter 02 §2.8) when digests grow.
2. **Per-org AI budget** — launch blocker (chapter 08 §8.6).
3. **One backend** (D1): delete overlapping Fastify routes once the MCP server and token API land.
4. **Hot row, pool size, timeouts** (D21–D23) — Phase 0.
5. **Docker images and compose** (D24) — Phase 0.
6. **Per-person time zone** (D9) — Phase 1.
7. **Indexes** (D7, D12, D13) and notification retention (D14) — in migration `0022` (working tree).
8. **Single rollup helper** (D10) and `healthOf()` in core — with the D21 fix.
9. **Rank rebalance without version bumps** (D6, D25).
10. **Doc excerpts without Markdown** (D15).
11. **Role-matrix test** and Playwright smoke tests.

## 12.3 What is good to add (beyond Atlassian)

| Idea | Why it fits mixed startup teams | Running cost |
|---|---|---|
| **AI "plan this for me"** (same as AI project setup, extended to milestones and dates) | Blank-page problem | Fast tier, ~₹0.10 per setup (assumption — measure after launch) |
| **Client portal link** per client: progress, shared files, request form, *shared* comments | Freelancers and agencies send weekly status by email today | none |
| **Weekly AI digest for founders** (Batches, Friday) | "What changed this week?" without opening the app | ~₹0.04 per project per week (assumption) |
| **Reply to a comment by email** | First step towards chat-app replies | inbound email ~free |
| **Invoices from billable worklogs** | Freelancers otherwise need a second tool | none |
| **Meeting → doc** (AI notes saved as a project doc; `meeting_notes.doc_id` exists) | Meeting notes without effort | none |

## 12.4 Phased plan

Estimates are **assumptions — measure after launch**: one experienced full-stack developer with AI assistance;
double them for someone new to the codebase.

### Phase 0 — Launch blockers (2–3 weeks)

| Item | Ref | Done when |
|---|---|---|
| ✅ Email, sign-in codes, shared rate limits | `752e2a4` | Done |
| Per-org AI budget enforced on web and worker paths; free-tier meeting-minute cap (values TBD — pricing not decided) | ch. 08 §8.6, item 22 | Over budget returns `AI_BUDGET_EXCEEDED`; worker meetings wait in `awaiting_budget` |
| Haiku 5.5 / Sonnet 5.5, `temperature` removed; §8.10 evaluation run once | ch. 08 | Eval passes; ledger shows new models |
| Polling load: 60 s version-endpoint poll replaces the 15 s plan | R1 | An idle open board costs one indexed query per minute |
| Rate limits: edge rules for IPs; KV only when triggered | R2 | A one-IP load test is cut off at the edge |
| Rollup hot row | R3 / D21 | 20 concurrent writes in one org show no lock waits |
| Pool size 1–2 on Vercel; pooler limit recorded | R4 / D22 | Pool size read from `DB_API_POOL_SIZE` |
| Statement timeouts per role | R5 / D23 | A deliberately slow query is cancelled at 15 s in staging |
| Worker: 2 light replicas + heavy deployment, health checks | R6 | Killing one light replica loses no notifications |
| Dockerfiles (web `standalone`, api, worker) + full-stack `docker-compose.yml`; images built in CI | items 39–40 / D24 | `docker compose up` runs the whole stack; CI builds all three images |
| PITR from the first paying customer; 6-hourly off-site dumps; daily file sync | item 42 | A restore drill from the off-site dump succeeds |
| Sentry errors + tracing | item 46 | One trace shows route → Postgres → outbox → job |

### Phase 1 — Mixed-team launch (6–8 weeks)

| Item | Done when |
|---|---|
| **Role-based views: Dev and PM** (+ Founder view from the existing Progress/Insights pages) | A developer and a PM work on the same project, each in their view, with no hand-copied updates |
| **Status translation**: workflows with categories and stages (`0023`), `statusLabel()` used in every view and email | "In review" shows as "Almost done" to a PM; "Blocked" as "Waiting on Meera" |
| `blocks` links (needed for "Waiting on …") | A blocked task names the blocking task's owner |
| **GitHub integration** (GitHub App, branch/PR linking by key, PR status on task, status moves on open/merge) | A merged PR moves its task to Done within a minute |
| **AI project setup** from a title and description (fast tier) | A new team reaches a populated board in under a minute, after approving the proposal |
| **Zoom polish** (worker deployed, consent notice text, routing confirmation UX) | A real Zoom meeting turns into approved tasks end to end in production |
| **MCP server** + scoped API tokens; editor setup page | "What's assigned to me" and "mark ENG-142 done" work from Claude Code, Cursor and VS Code |
| Dev view keyboard-first: command palette, shortcuts, Markdown everywhere | Create, move and assign without the mouse |
| Jira-compatible CSV export | Exported file imports into Jira's CSV importer without column mapping errors |
| Global search (key jump + full text); per-person time zone | p95 search < 200 ms on 50 k tasks; "overdue" correct across time zones |

### Phase 2 — More meetings, clients and live updates (6 weeks)

| Item | Done when |
|---|---|
| **Google Meet** adapter (`MeetingProviderPort`, Meet REST API + Workspace Events) | A Meet meeting with transcripts on turns into suggested tasks |
| **Freelancer / client view**: shared progress page, milestones, decisions, files and comments marked *shared* | A client sees only shared items, enforced by RLS |
| **Realtime** hints (Supabase Realtime), 60 s poll stays as fallback | Two browsers see each other's moves within 2 s |
| **Microsoft Teams** adapter | A transcribed Teams meeting turns into suggested tasks |

### Phase 3+ — Remaining parity, by customer request

Everything marked "3+" in §12.1, ordered by how many paying teams ask for it. Candidates seen most often in
similar products: templates, custom fields, sprints, time tracking, dashboards, automation, goals, imports, page
tree for docs, webhooks and the public REST API.

### Timeline summary (assumption — measure after launch)

| Phase | Weeks | Cumulative | Outcome |
|---|---|---|---|
| 0 | 2–3 | 3 | Safe, recoverable, affordable to run |
| 1 | 6–8 | 11 | Startup teams with devs and non-devs can run on it |
| 2 | 6 | 17 | Meet and Teams, clients, live updates |
| 3+ | — | — | Driven by customer requests |

## 12.5 Mapping to the existing 25-stage roadmap

Stages 1–17b are done. Stages 18 (eval + cost), 19 (notifications), 20 (realtime), 21 (Ask AI, upload) and 22
(privacy) are folded into Phases 0–2. Stages 23–25 (AWS, migration, launch verification on AWS) are a separate
migration project (chapter 03 §3.8), started only when a customer contract or the running-cost model calls for
it. Record this as ADR "Mixed-team launch first; parity by request" in `docs/decision-log.md`.

## 12.6 Decided not to build yet

| Item | Why not now | What would change our mind |
|---|---|---|
| **MCP as the meeting intake path** | Intake must be reliable and unattended: provider webhooks + the queue retry, deduplicate and survive restarts; an agent calling tools is neither guaranteed to run nor auditable in the same way. MCP stays a developer feature (chapter 06 §6.10) | — |
| **A meeting bot API** (a bot that joins calls to record) | Costs per meeting hour and adds a visible participant; platform transcripts cover Zoom, Meet and Teams customers | Customers on plans without platform transcripts asking in numbers; then as a fallback behind `MeetingProviderPort` |
| **Our own video calling on LiveKit** | Not our problem to solve yet; calls already happen in Zoom, Meet and Teams | A possible Phase 4 "huddle" add-on on **LiveKit Cloud** — never self-hosted at this stage |
| **Dictation tools** (e.g. Wispr Flow) | Single-speaker dictation, not multi-speaker meeting capture | — |
| **Webex** | Low demand in the first target group | A paying customer asks |
| **Full Atlassian parity before launch** | §12 principle | Teams using the product ask for specific items |
| **App marketplace**, **Kubernetes** | See §12.1 and chapter 11 §11.2 | Self-hosted edition, > ~5 independently scaled services |
