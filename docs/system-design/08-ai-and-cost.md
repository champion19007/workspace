# 08 — AI features and cost model

The user asked for "my API rate… for all the things to be effective and cost effective". This chapter prices
every AI call and every piece of infrastructure, so each feature has a cost line before it is built.

## 8.1 Price sheet used in this guide

Claude prices are Anthropic first-party API rates as of 2026-10-06 (per million tokens). Amazon Bedrock prices
differ; check before Architecture B. Conversion: ₹86 per US$ (`DEFAULT_USD_TO_INR_RATE`).

| Model | ID | Input $/M | Output $/M | Context | Use here |
|---|---|---|---|---|---|
| Claude Haiku 5.5 | `claude-haiku-5-5` | **0.10** | **0.50** | prompts over 100K tokens cost $0.50 / $2.50 (none of our calls come close) | **fast tier (recommended)** |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 1.00 | 5.00 | 200K | previous fast default; rollback only (`ANTHROPIC_FAST_MODEL`) |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | 2.00 | 10.00 | 1M | strong tier (recommended; same price as Sonnet 5) |
| Claude Sonnet 5 | `claude-sonnet-5` | 2.00 | 10.00 | 1M | previous strong default; rollback only (`ANTHROPIC_STRONG_MODEL`) |
| Claude Opus 5.5 | `claude-opus-5-5` | 4.00 | 20.00 | 1M | only if the transcript evaluation (§8.10) shows Sonnet 5.5 missing tasks |
| Claude Fable 5.1 | `claude-fable-5-1` | 10.00 | 50.00 | 1M | not used |

Modifiers (apply to any model):

| Lever | Effect on price | Where it fits |
|---|---|---|
| Prompt cache **read** | ~0.1× input price | Stable system prompts, org glossary, field whitelist |
| Prompt cache **write** | 1.25× (5-minute TTL), 2× (1-hour TTL) | Paid once per TTL window |
| **Message Batches** | 50 % off input and output | Anything nobody is waiting for: meeting extraction, nightly summaries, re-embedding, eval runs |
| Effort (`output_config.effort`) | Fewer thinking/output tokens at `low`/`medium` | Default `low` for fast-tier helpers; `medium` for extraction |
| Shorter outputs | Output tokens cost 5× input | Strict Zod schemas, word limits in prompts |

Minimum cacheable prefix is model-dependent (512–4,096 tokens): a short system prompt may silently not cache.
Check `usage.cache_read_input_tokens` in the ledger after deploying.

Embeddings: Voyage via `LLMPort.embed`, 1,024 dimensions. The adapter's fallback price is $0.07 per million
tokens (`VOYAGE_PRICING_TABLE` default). Re-check the current Voyage price when wiring the ledger.

## 8.2 Every AI call in the product

| # | Feature | Prompt id | Tier → model (recommended) | Built? | Trigger | Who waits |
|---|---|---|---|---|---|---|
| A1 | Meeting routing (which project) | `route.meeting` | fast → Haiku 5.5 | Built (worker) | transcript ready | nobody |
| A2 | Speaker resolution (fuzzy) | `resolve.speakers` | fast → Haiku 5.5 | Built (worker) | transcript ready | nobody |
| A3 | Notes + action items from meeting | `extract.notes_and_actions` | strong → Sonnet 5.5, **Batches** | Built (worker) | routed | nobody (minutes OK) |
| A4 | Notes from pasted transcript | same | strong → Sonnet 5.5 (interactive) | Built (web) | button | person, ≤ 60 s |
| A5 | Owner/due resolution | `resolve.owner_due` | fast → Haiku 5.5 | Built (worker) | extraction | nobody |
| A6 | Dedup embedding of action items and tasks | embed | Voyage | Built | extraction / task save | nobody |
| A7 | Ask AI | `ask_ai.answer` | fast → Haiku 5.5 | Built (web) | question | person |
| A8 | Progress summary | `summarize.progress` | fast → Haiku 5.5 | Built (web) | page open, cached 1 h | person |
| A9 | "Ask in words" → WQL | `wql.from_words` | fast → Haiku 5.5 | Planned | filter box | person |
| A10 | Goal update draft | `goal.update_draft` | fast → Haiku 5.5 | Planned | button | person |
| A11 | Automation `ai_summarize`, `ai_classify` | `auto.*` | fast → Haiku 5.5 | Planned | rule | nobody |
| A12 | Automation from words | `auto.rule_from_words` | strong → Sonnet 5.5 | Planned | button | person |
| A13 | Split task into subtasks | `task.split` | fast → Haiku 5.5 | Planned | button | person |
| A14 | Weekly project digest (Executives) | `summarize.weekly` | fast → Haiku 5.5, **Batches** | Planned | Friday cron | nobody |
| A15 | Doc/notes chunk embeddings for Ask AI | embed | Voyage | Planned | doc publish | nobody |
| A16 | Speech-to-text fallback (uploads, meetings without a platform transcript) | `SpeechToTextPort` | vendor chosen after the Indian English / Hinglish test (chapter 03 §3.10) | Planned | upload / no transcript | nobody |
| A17 | AI project setup from a title and description | `project.setup` | fast → Haiku 5.5 | Planned (Phase 1) | onboarding, New project | person |

## 8.3 Cost per call

Token sizes are **assumptions — measure after launch**: estimates from the prompt shapes in the code (Ask AI
sources list, transcript windows). Replace them with real numbers from `ai_usage_ledger`.

| # | Call | Input tok | Output tok | Haiku 4.5 (previous default) | **Haiku 5.5** | Sonnet 5.5 | Sonnet 5.5 + Batch |
|---|---|---|---|---|---|---|---|
| A1 | Routing | 3,500 | 200 | ₹0.39 | **₹0.04** | — | — |
| A3/A4 | Notes, 1-hour meeting (~12k transcript + 2.5k instructions) | 14,500 | 2,000 | — | — | **₹4.21** | **₹2.11** |
| A3 | Notes, 30-minute meeting | 8,500 | 1,400 | — | — | ₹2.67 | ₹1.34 |
| A5 | Owner/due | 1,500 | 150 | ₹0.19 | ₹0.02 | — | — |
| A7 | Ask AI (~25 project lines + ~25 task/doc sources) | 4,000 | 400 | ₹0.52 | **₹0.05** | ₹1.03 | — |
| A8 | Progress summary | 5,000 | 500 | ₹0.65 | **₹0.06** | ₹1.29 | — |
| A9 | WQL from words | 1,500 | 150 | ₹0.19 | ₹0.02 | — | — |
| A10 | Goal update draft | 3,000 | 400 | ₹0.43 | ₹0.04 | — | — |
| A11 | Automation summarize | 2,000 | 300 | ₹0.30 | ₹0.03 | — | — |
| A12 | Rule from words | 3,000 | 800 | — | — | ₹1.20 | — |
| A17 | AI project setup (description + template list in, proposal out) | 1,500 | 2,000 | ₹0.99 | ₹0.10 | — | — |
| A13 | Split into subtasks | 800 | 300 | ₹0.20 | ₹0.02 | — | — |
| A14 | Weekly digest per project | 6,000 | 600 | ₹0.77 | ₹0.08 | — | ₹0.04 (Haiku 5.5 batch) |
| A6/A15 | Embedding 1M tokens (~650 docs of 1,500 tokens) | 1,000,000 | — | ₹6 (Voyage, code's fallback price) | | | |

Worked example (A3, Sonnet 5.5, interactive): 14,500 × $2/M = $0.029; 2,000 × $10/M = $0.020; total $0.049 ×
86 = ₹4.21. With Batches: ₹2.11.

## 8.4 Model and parameter changes recommended

**Model choices (decided):**

| Use | Model | Mode |
|---|---|---|
| Routing, speaker and owner/due resolution, short summaries, Ask AI, "ask in words", AI project setup, automation helpers | **Claude Haiku 5.5** (`claude-haiku-5-5`) | interactive |
| Meeting notes and task extraction (A3) | **Claude Sonnet 5.5** (`claude-sonnet-5-5`) | **Message Batches** (nobody is waiting) |
| Notes from a pasted transcript (A4), automation from words (A12) | Claude Sonnet 5.5 | interactive |
| Anything | **Claude Opus 5.5** only if the evaluation in §8.10, run on 20–30 real transcripts, shows Sonnet 5.5 missing tasks that Opus finds | — |

Haiku 4.5 and Sonnet 5 are not targets; they stay in the price table only as one-env-var rollbacks. The adapter
defaults were switched in Phase 0 (working tree, not yet committed at revision C).

1. **Switching rule.** No model change ships without the §8.10 evaluation passing on the new model.
2. **Fast tier saving.** Haiku 5.5 is about 10× cheaper than Haiku 4.5 for A1, A2, A5, A7–A11, A13, A14, A17.
3. **Remove `temperature`** (finding D2b). The AI routes pass `temperature: 0`, and the adapter forwards it only
   for `claude-haiku-4-5` (`SAMPLING_MODELS`). Claude Haiku 5.5 rejects non-default sampling values, and API
   version `2026-10-21` rejects the fields on every model. Delete the parameter from the routes and the
   `SAMPLING_MODELS` branch in the same change as the model switch. Determinism now comes from strict Zod
   schemas and structured outputs, not temperature.
4. **Thinking and effort.** Haiku 5.5 and Sonnet 5.5 think adaptively by default. For the fast helpers set
   `output_config.effort: 'low'`; for extraction start at `medium` and raise only if evals drop. Thinking tokens
   are billed as output, so effort is a direct cost dial.
5. **Batch the meeting pipeline.** A3 runs in the worker with nobody waiting; submit extraction windows as a
   Message Batch and poll. Halves the largest AI cost line. Keep A4 (pasted transcript) interactive.
6. **Cache the stable prefix.** Put the extraction instructions, output schema description and the per-org
   glossary first, mark `cache_control`, and put the transcript window last. Multi-window meetings (> 30k tokens)
   reuse the prefix across windows at 0.1× input price.
7. **Long calls and the function time limit** (review #23). The AI routes set `maxDuration = 60`. Vercel Pro
   allows longer function durations; raise A4 (notes from a long pasted transcript) to 300 s there, and stream
   the response so the person sees progress. Anything that can exceed that (very long transcripts, batch work)
   goes to the worker, never to a web function.
8. **Refusals.** Sonnet 5.5 can stop with `stop_reason: "refusal"`. The adapter must check `stop_reason` before
   parsing and record `status = 'refused'` in the ledger (the CHECK already allows it). Show "The AI couldn't
   help with this one" and let the person continue by hand.

## 8.5 Monthly AI cost per organization

**Assumption — measure after launch.** Usage for an active 25-person org: 40 meeting-hours a month, each person asks Ask AI 30 times, 10 people
open Progress 20 times (1-hour cache hits halve the calls), 300 "ask in words" filters, 200 automation AI
actions, 3M embedding tokens.

| Line | Volume | Previous defaults (Haiku 4.5 + Sonnet 5, no batch) | Recommended (Haiku 5.5 + Sonnet 5.5 + batch) |
|---|---|---|---|
| Meeting notes (A3) | 40 h | ₹168 | ₹84 |
| Routing + speakers + owner/due (A1, A2, A5) | 40 meetings | ₹30 | ₹4 |
| Ask AI (A7) | 750 | ₹390 | ₹38 |
| Progress summaries (A8) | 100 (after cache) | ₹65 | ₹6 |
| WQL from words (A9) | 300 | ₹57 | ₹6 |
| Automation AI (A11) | 200 | ₹60 | ₹6 |
| Embeddings (A6, A15) | 3M tokens | ₹18 | ₹18 |
| **Total / month** | | **≈ ₹790** | **≈ ₹160** |

The default `orgs.ai_budget_inr = 5000.00` is far above this, so the budget mostly guards against abuse and
runaway loops. Per-plan budgets: **TBD — pricing not decided.**

**Free-tier caps on meeting notes.** Meeting notes are the largest AI line, so the free tier caps **meeting-note
minutes per month** (in addition to the ₹ budget), counted from `meetings.duration_seconds` of meetings that were
extracted. Cap values: **TBD — pricing not decided.** Over the cap, meetings still import and show their
transcript; notes and suggestions wait until the next month or an upgrade.

## 8.6 Enforcing the AI budget (fixes D2) — launch blocker

The per-org AI budget is a **launch blocker**: no paying customer before it is enforced on every AI path (web and
worker). As built in Phase 0 (working tree, uncommitted at revision C):

| Piece | Where | Does |
|---|---|---|
| `sys_ai_usage_record(...)` | migration `0022` (definer function) | writes one ledger row per web AI call; the web role can't write the ledger directly and clients can't see it |
| `sys_ai_month_usage(org)` | `0022` | the org's `ai_budget_inr` and succeeded spend this calendar month (UTC; org time zone later) |
| `completeAndRecord()` | `apps/web/src/lib/ai.ts` | runs the call, records success or failure with tokens and ₹ cost |
| `aiBudgetExceeded()` | same | `429 AI_BUDGET_EXCEEDED` with "Your organization has used this month's AI allowance…" |
| `aiBudgetAllows(used, budget)` | `packages/core/src/ai/index.ts` | the rule itself (at-or-over, headroom for the in-flight call, budget 0 = off?) — **still a `TODO(human)`**, currently always allows |
| `checkBudgetCapacity()` | `packages/db/src/extraction-operations.ts` (worker) | older check for the meeting pipeline; should call `aiBudgetAllows` so web and worker share one rule |

Still to build before launch: the shared rule, Owner notification and email at 80 % and 100 % (dedupe key
`ai-budget:{month}:{level}`), a blocked meeting waiting in `awaiting_budget` until raised or next month, the
meeting-minute cap above, and recording `refused` stops as `status = 'refused'`.

## 8.7 Non-AI running costs per action

| Action | Unit cost | Note |
|---|---|---|
| Transactional email (Resend / SES) | ~$0.0004–0.001 each (₹0.03–0.09) | Free tiers cover early stage (Resend 3,000/month) |
| File storage | ~$0.021/GB-month (Supabase Pro overage) | 100 GB included on Pro (estimate) |
| Egress | ~$0.09/GB beyond included | Serve downloads via signed URLs; images resized client-side before upload |
| DB storage | ~$0.125/GB-month beyond included | Vectors are the largest item (§4.17): use `halfvec` |
| Function invocations | Vercel Pro includes a generous quota | Keep AI routes ≤ 60 s (`maxDuration = 60`) |

## 8.8 Infrastructure cost by stage (estimates, check current vendor pricing)

| Stage | Orgs | Stack | Monthly (USD) | Monthly (INR) |
|---|---|---|---|---|
| Build / private beta | ≤ 5 | Vercel Hobby (non-commercial use only) + Supabase Free (pauses when idle, 500 MB) | $0 | ₹0 |
| Paid launch | ≤ 50 | Vercel Pro (1 seat $20) + Supabase Pro ($25, includes small compute) + workers on Railway/Fly (2 × light + 1 × heavy, $10–20) + Resend free + Sentry ($26) + off-site backups (< $2) + domain. **Plus Supabase PITR** from the first paying customer (revision C; check its current price — it is the largest single line at this stage) | **$85–110 + PITR** | **₹7,300–9,500 + PITR** |
| Growth | ~300 | Vercel Pro (2 seats) + usage (~$60) + Supabase Pro with medium/large compute add-on + ~35 GB disk (~$100–150) + worker ($20) + Resend ($20) + error tracking (~$26) | **$230–280** | **₹20,000–24,000** |
| Architecture B baseline | any | 2 NAT gateways, ALB, Aurora Serverless v2 minimum, RDS Proxy, ECS tasks, CloudFront/WAF, interface endpoints | **$300–450 before traffic** | ₹26,000–39,000 |

Vercel's Hobby plan is for non-commercial projects. Move to Pro before charging anyone.

Unit economics at the paid-launch stage (revision C costs, before PITR): infrastructure about ₹190 per
org-month (₹9,500 ÷ 50), plus AI ≈ ₹160 per active 25-person org on the recommended models. Total ≈ ₹350 per
org-month, or about ₹14 per seat, plus a share of PITR.

## 8.9 Cost guardrails in code

| Guardrail | Where | Status |
|---|---|---|
| Per-person AI rate limit 30/h | `apps/web/src/lib/ai.ts` | Built (`752e2a4`) |
| Per-org monthly ₹ budget | `aiBudgetExceeded` + `aiBudgetAllows` (§8.6) | **Launch blocker**: wired in working tree, rule pending |
| Progress summary cached 1 h per person | `progress_summaries` | Built |
| Ask AI sends ≤ 25 project lines + top matches, not whole docs | `ai/ask/route.ts` | Built |
| Strict output schemas (no free-form essays) | `packages/prompts` Zod | Built |
| Batches for background extraction | worker | Planned |
| Prompt caching for stable prefixes | adapter `systemPrefix` | Partial (prefix exists; add `cache_control`, verify reads) |
| Embed only content > 200 chars; skip unchanged `content_hash` | indexer | Planned |
| `halfvec` storage for chunk vectors | `0032` | Planned |
| Notifications retention 90 days, activity log partitioning | cron | Planned |
| Usage page for Owners (AI ₹, storage, automation runs) | `/usage` | Planned P1 |

## 8.10 Evaluation before any model change

A fixed evaluation set runs before any change of model, prompt version or effort level for meeting extraction.

| Item | Rule |
|---|---|
| Data | 20–30 real meeting transcripts from consenting design partners, **anonymised** (names → roles, companies → placeholders), including Indian English and Hinglish meetings; stored with `packages/evals`, never in production tables |
| Gold labels | For each transcript, a person lists the action items, owners and due dates that should be found |
| Scores | **Missed tasks** (recall), **wrong owners** (owner accuracy), **hallucinated tasks** (suggestions with no supporting quote or not in the gold list), hallucinated due dates, evidence validity |
| Pass bar | The thresholds already in the roadmap: recall ≥ 0.70, precision ≥ 0.80, owner accuracy ≥ 0.85, hallucinated due dates = 0, evidence validity ≥ 0.98. A new model must also not be worse than the current one on missed tasks |
| Cost | Run through Message Batches: 30 one-hour transcripts × ₹2.11 ≈ ₹65 per run on Sonnet 5.5 (assumption — measure after launch) |
| When | Before every model, prompt or effort change; monthly on the current setup to catch drift |

