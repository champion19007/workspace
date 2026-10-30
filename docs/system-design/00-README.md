# Workspace — System Design, Architecture and Full-Stack Engineering Guide

**Audience:** developers, architects and full-stack engineers working on Workspace.
**Status:** revision C, 2026-10-29, against branch `claude/upbeat-jemison-2f0f25` (PR #2) at commit
`752e2a4`, which holds the most complete version of the product: migrations `0001`–`0021` committed, including
email notifications, 6-digit sign-in codes and shared rate limits. Phase 0 code changes (models, AI budget wiring,
migration `0022`) are in the working tree, not yet committed.
**Inputs:** the code in this repository, the existing docs in `docs/`, and 456 screenshots of Atlassian
Cloud (Jira, Goals, Teams, Atlassian account, Loom, Bitbucket home) captured on 2026-10-28.

## What this guide is

**One workspace for every role: developers, non-technical PMs, founders, freelancers and their clients work on
the same tasks, each in a view built for how they work, so teams don't need two tools or someone copying
updates between them. The easy, affordable starting point before (or instead of) Atlassian.**

The rule behind it: **one data model, many views**. Everyone edits the same tasks, projects and statuses; views
differ, data never forks (chapter 01 §1.2). The first target group is startup teams of 2–15 people with both
developers and non-developers. The product also turns meetings into work: a transcript becomes notes and
suggested tasks, and a person approves each one before it lands in the right project.

This guide does four things:

1. Describes what is built today, file by file, with its strengths and its faults.
2. Catalogues every Atlassian feature seen in the screenshots and decides, for each one, whether to build it,
   simplify it, or leave it out.
3. Gives the target architecture: every table, column, data type, TypeScript type, API endpoint, rate limit,
   queue job, automation trigger and action, and AI call, with what each one costs to run.
4. Lays out a phased plan that keeps the monthly bill low while the product grows.

## Changes in revision C

Revision C combines the external review of revision B (33 flaws, register in chapter 13 §13.6) and the product
owner's change list:

1. **Vision and positioning** (ch. 00, 01): new one-line vision; new §1.2 *Why one product for every role*; new
   personas with startup teams as the first target; §1.7 *Before Atlassian, or instead of it* with a
   Jira-compatible export.
2. **Role-based views replace the Simple/Pro switch** (ch. 01 §1.5, ch. 04 §4.4, ch. 10 §10.3): Dev, PM, Founder
   and Client views stored in `memberships.view`.
3. **Status translation** (new ch. 01 §1.6; ch. 04 §4.5): a `stage` on every workflow status, translated per view.
4. **Competitor facts corrected** (ch. 01 §1.10–1.11): Atlassian's Loom → Confluence → Jira → Rovo route is
   described; LTD by Eshway and other competitors added. The claim that Atlassian lacks meeting → tasks is gone.
5. **Meetings** (new ch. 03 §3.10): `MeetingProviderPort` generalises `ZoomPort`; provider order Zoom → Google
   Meet → Teams → Webex with prerequisites; platform transcript first, STT as fallback after an Indian English /
   Hinglish test; consent notice requirement (ch. 09 §9.6).
6. **Decided not to build yet** (new ch. 12 §12.6): MCP as meeting intake, a meeting bot API, own video calling
   on LiveKit, dictation tools.
7. **Developer features** (new ch. 06 §6.10 MCP and §6.11 GitHub; ch. 10 §10.3): GitHub integration and the MCP
   server in Phase 1; keyboard-first Dev view; AI project setup in onboarding.
8. **AI models** (ch. 08): Haiku 5.5 and Sonnet 5.5 (Batches) stated as decided; Opus 5.5 only on evaluation
   evidence; new §8.10 evaluation step; per-org AI budget is a launch blocker; free-tier meeting-minute caps.
9. **Infrastructure** (ch. 03, 04, 11): chapter 11 rewritten; new §11.9 *Known risks and fixes*; worker split,
   Docker images and full-stack compose, connection and timeout rules, PITR from the first paying customer,
   regional outage plan, honest composite SLO, tracing.
10. **Roadmap** (ch. 12 rewritten): principle "don't chase full parity before teams use the product"; Phase 0
    launch blockers, Phase 1 mixed-team launch, Phase 2 Meet/Teams/clients/Realtime, Phase 3+ by request.
11. **No plan prices**: plan limits and per-plan values are marked "TBD — pricing not decided"; running-cost
    tables stay. Assumed numbers are labelled "assumption — measure after launch".

## How the chapters fit together

| # | Chapter | What you get | Approx. pages |
|---|---|---|---|
| 01 | [Product vision and Atlassian parity](01-product-vision-and-parity.md) | Vision, why one product for every role, personas, role-based views, status translation, positioning, the full Atlassian catalogue, competitors | 13 |
| 02 | [Current-state audit](02-current-state-audit.md) | What exists on each branch, stage by stage; strengths, defects (D1–D25, E1–E4), debt | 7 |
| 03 | [System architecture](03-architecture.md) | Containers, modular monolith, ports, the one-backend decision, request lifecycle, Architecture A vs B as a project, meeting providers | 6 |
| 04 | [Data model](04-data-model.md) | Every current table with column types, DDL for new tables (views, stages, workflows, fields, goals, dashboards, automation, webhooks), indexing and RLS rules | 12 |
| 05 | [Domain types and algorithms](05-domain-types-and-algorithms.md) | TypeScript types; workflow state machine; ranking and rebalancing; tree paths; WQL; rollups; search | 6 |
| 06 | [API reference](06-api-reference.md) | Conventions, current and planned endpoints, payloads, rate-limit table, webhooks, public API, MCP server, GitHub integration | 9 |
| 07 | [Automation engine](07-automation-engine.md) | Triggers, conditions, actions, smart values, execution model, loop detection, limits, audit log | 4 |
| 08 | [AI features and cost model](08-ai-and-cost.md) | Every AI call, model choices, cost per call and per org, AI budget as a launch blocker, evaluation step, infrastructure cost by stage | 6 |
| 09 | [Security, tenancy and permissions](09-security-and-permissions.md) | RLS, roles, permission model, client scoping, secrets, abuse controls, privacy law and meeting consent | 4 |
| 10 | [Front-end architecture](10-frontend-architecture.md) | Routes, role-based views, Dev view requirements, AI project setup, design system, live updates, accessibility, performance | 3 |
| 11 | [Infrastructure, operations and scaling](11-infra-ops-scaling.md) | Docker images, worker topology, Postgres move-out plan, connections and timeouts, capacity, known risks, SLOs, backups, scaling path | 8 |
| 12 | [Gap analysis and phased roadmap](12-roadmap.md) | Principle, parity matrix, Phases 0–3+, decided not to build yet | 5 |
| 13 | [Appendix](13-appendix.md) | Vocabulary map, glossary, checklists, screenshot index, review register | 5 |

Size: about 40,000 words of Markdown, roughly 90 printed A4 pages with tables and code blocks at their printed
size.

## Conventions used in this guide

- **SQL** is PostgreSQL 16 or newer. Every tenant table has `org_id uuid NOT NULL` and row-level security
  (see chapter 09). IDs are UUIDv7 from `uuid_generate_v7()` unless stated.
- **Types** are TypeScript 5.7 with Zod 3 schemas, matching `packages/core`.
- **Money** is shown in USD and INR. The conversion rate is the one in the code,
  `DEFAULT_USD_TO_INR_RATE = 86.0` (`packages/adapters/src/llm/index.ts`). Re-check vendor prices before
  quoting them to customers; prices quoted here were current on 2026-10-06 for Claude models and are marked
  *estimate* for cloud infrastructure.
- **Status words:** *Built* = merged or on PR #2 with tests. *Partial* = some of it exists. *Planned* = designed
  here, not built.
- **Priority:** P0 = needed for the launch to mixed startup teams. P1 = needed by most of those teams soon after.
  P2 = good to add when asked. P3 = leave out unless a customer pays for it.
- **Assumptions:** numbers not measured from the running product are labelled *assumption — measure after
  launch*. Plan prices and plan limits are not decided and appear only as *TBD — pricing not decided*.
- **Atlassian names** are mapped to plain names in this product. The full map is in chapter 13. The main ones:
  work item → **task** (PM view) or **issue** (Dev view), space → **project**, epic → **milestone** (PM view) or
  epic (Dev view),
  JQL → **WQL**, flow → **automation rule**, Confluence page → **doc**.

## The decisions this guide recommends

1. **One data model, many views.** Dev, PM, Founder and Client views of the same records, chosen per person
   (`memberships.view`); a view never changes data or access. Chapter 01 §1.5 and chapter 10 §10.3.
2. **Configurable workflows with categories and stages.** Replace the hard-coded `tasks.status` check
   (`todo | in_progress | done | blocked`) with `workflow_statuses` rows that carry a **category** (what all
   counting reads) and a **stage** (what each view translates into its own words). Chapter 04 §4.5, chapter 01 §1.6.
3. **One backend for the web app.** Next.js route handlers serve the browser; Fastify serves webhooks, the
   public API and the MCP server. Chapter 03 §3.5.
4. **Custom fields in one JSONB column**, `tasks.custom`, described by `field_definitions`. Chapter 04 §4.6.
5. **Claude Haiku 5.5 for the fast tier, Sonnet 5.5 with Batches for meeting extraction**, Opus 5.5 only on
   evaluation evidence; the per-org AI budget is a launch blocker. Chapter 08.
6. **Postgres does many jobs on purpose**, and each moves out in a fixed order when a measured trigger fires.
   Chapter 11 §11.4.
