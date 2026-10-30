# 06 — API reference

## 6.1 Conventions (apply to every endpoint)

| Topic | Rule | Source |
|---|---|---|
| Base path (browser) | `/api/orgs/{orgId}/…` on the web origin; `orgId` may be the uuid or the slug | `resolve-org.ts` |
| Base path (public API) | `https://api.<domain>/api/v1/orgs/{orgId}/…` | chapter 03 §3.5 |
| Auth (browser) | httpOnly `Secure` `SameSite=Lax` session cookie, 30-day rolling | stage 3 |
| Auth (public) | `Authorization: Bearer wsp_<prefix>_<secret>` (API token) or OAuth 2.1 access token | §6.10 |
| Content type | `application/json; charset=utf-8`; errors `application/problem+json` (RFC 9457) | `docs/api-conventions.md` |
| Errors | `{type, title, status, detail, instance, code, details?}`; `code` is a stable UPPER_SNAKE string | `problem.ts` |
| Validation | Zod; first issue in `detail`, all issues in `details.issues`; status `422` | |
| Concurrency | `GET` returns `ETag: W/"v<version>"`; `PATCH/PUT/DELETE` require `If-Match`; mismatch → `412 PRECONDITION_FAILED` | `concurrency/etag.ts` |
| Idempotency | `POST` that creates accepts `Idempotency-Key` (≤ 128 chars); same key + same body within 24 h returns the stored response; same key + different body → `422 IDEMPOTENCY_KEY_REUSED` | `idempotency_keys` |
| Pagination | `?limit=1..100` (default 20) & `?cursor=<opaque base64url>`; response `{items, nextCursor, hasMore}`; stable sort with `id` tie-breaker | `pagination/` |
| Sync | `?updatedSince=<ISO instant>` on list endpoints returns rows changed after that time, including archived ones with `archivedAt` set | stage 20 |
| Dates | Calendar dates `YYYY-MM-DD`; instants ISO 8601 UTC with `Z` | |
| Rate limits | `429 RATE_LIMITED` (web) / `RATE_LIMIT_EXCEEDED` (Fastify) with `Retry-After` seconds | §6.8 |
| Versioning | Browser API is unversioned (deployed with the UI). Public API is `/v1`; breaking changes go to `/v2` with 12 months' overlap | |
| Request id | `x-request-id` echoed / generated; logged with every line | |

### Error codes catalogue

| HTTP | `code` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | malformed JSON, bad cursor |
| 401 | `UNAUTHORIZED` | no/expired session or token |
| 403 | `FORBIDDEN` | role can't do this (e.g. Executive editing) |
| 404 | `NOT_FOUND` | doesn't exist **or** caller can't see it (never reveal existence) |
| 409 | `CONFLICT` / `TRANSITION_REFUSED` / `TARGET_CHANGED` / `ALREADY_DECIDED` | state conflict |
| 412 | `PRECONDITION_FAILED` | stale `If-Match` |
| 413 | `PAYLOAD_TOO_LARGE` | body or file over limit |
| 422 | `VALIDATION_ERROR` / `WQL_ERROR` / `IDEMPOTENCY_KEY_REUSED` | |
| 429 | `RATE_LIMITED` / `AI_BUDGET_EXCEEDED` / `PLAN_LIMIT` | limits (§6.8) |
| 503 | `AI_UNAVAILABLE` / `STORAGE_UNAVAILABLE` / `BACKGROUND_UNAVAILABLE` | optional provider not configured |

## 6.2 Current browser endpoints (PR #2 + working tree)

Roles: **O** Owner, **M** Manager, **D** Developer, **E** Executive, **C** Client. "R" = read allowed,
"W" = write allowed. RLS further narrows rows.

### Auth and org

| Method | Path | Purpose | Roles | Limit |
|---|---|---|---|---|
| POST | `/api/auth/magic-link` | Send sign-in email (link + 6-digit code) | public | 5/h per email, 20/h per IP |
| POST | `/api/auth/verify-code` | Sign in with the 6-digit code `{email, code}` | public | 5 per 15 min per email |
| GET | `/api/auth/oauth/google` | Start Google sign-in | public | |
| GET | `/api/auth/callback` | Finish sign-in, set cookie | public | |
| GET | `/api/auth/session` | Current session | any | |
| POST | `/api/auth/logout` | Sign out | any | |
| POST | `/api/auth/switch-org` | Change active org | member of target | |
| POST | `/api/invitations/accept` | Accept invite | invited email | |
| GET, POST | `/api/orgs` | List my orgs / create org (+ General team) | any signed-in | |
| GET | `/api/orgs/{org}/members` | Member list | O M D E (C: none) | |
| PATCH, DELETE | `/api/orgs/{org}/members/{userId}` | Change level / remove | O M (only O makes O/M) | |
| POST | `/api/orgs/{org}/invitations` | Invite by email (sent through Resend) and return the link | O M | 100 / org / day |
| GET, PUT | `/api/orgs/{org}/me/notification-settings` | Email switches | self | |
| GET, PATCH | `/api/orgs/{org}/notifications` | Bell list / mark read | self | |
| POST | `/api/email/unsubscribe` | One-click unsubscribe (RFC 8058) | signed link | |
| GET | `/api/cron/daily` | Daily digests and rate-limit counter purge (Vercel Cron `30 3 * * *`, `Authorization: Bearer $CRON_SECRET`; refuses all callers while unset) | cron | |

### Tree, projects, tasks

| Method | Path | Purpose | Roles |
|---|---|---|---|
| GET | `/api/orgs/{org}/tree` | Team/project tree | all (C: granted only) |
| POST | `/api/orgs/{org}/nodes` | Create team/project | O M D |
| GET, PATCH, DELETE | `/api/orgs/{org}/nodes/{nodeId}` | Read/edit/archive node | R all; W O M D |
| GET, POST, DELETE | `/api/orgs/{org}/nodes/{nodeId}/members` | Private-project members; client grants | R O M D; W O M (clients: O M only) |
| GET | `/api/orgs/{org}/projects` | Projects with health | all |
| GET | `/api/orgs/{org}/projects/{p}/dashboard` | Overview numbers | all |
| GET, POST | `/api/orgs/{org}/projects/{p}/tasks` | List/create in project | R O M D; W O M D |
| GET | `/api/orgs/{org}/tasks` | Cross-project task query | O M D |
| GET, PATCH, DELETE | `/api/orgs/{org}/tasks/{taskId}` | Read/edit/archive (`If-Match`) | O M D |
| PATCH | `/api/orgs/{org}/tasks/{taskId}/move` | Board move: `{status, beforeId?, afterId?}` → new rank | O M D |
| GET, POST | `/api/orgs/{org}/tasks/{taskId}/subtasks` | Subtasks | O M D |
| GET | `/api/orgs/{org}/me/tasks` | My tasks | O M D |
| GET, POST / DELETE | `/api/orgs/{org}/labels`, `/labels/{id}` | Labels | R all editors; W O M D |
| GET | `/api/orgs/{org}/leadership` | Insights / Progress data | all (C: granted) |

### Docs, files, comments, requests, AI

| Method | Path | Purpose | Roles | Limit |
|---|---|---|---|---|
| GET, POST | `/api/orgs/{org}/docs` | List/create docs | R all; W O M D | |
| GET, PATCH, DELETE | `/api/orgs/{org}/docs/{docId}` | Read/edit (autosave)/archive | R all; W O M D | |
| GET | `…/docs/{docId}/versions`, `…/versions/{n}` | History | R all | |
| POST | `…/docs/{docId}/restore` | Restore version | O M D | |
| GET, POST | `/api/orgs/{org}/files` | List/upload (multipart ≤ 4 MB today) | R all; W O M D | uploads 60/h per person |
| GET, DELETE | `/api/orgs/{org}/files/{fileId}` | Download (signed redirect) / delete | R all; W uploader, O M | |
| GET, POST | `/api/orgs/{org}/comments` | Thread for `{targetType, targetId}` | R all; W all (E/C on projects and docs only) | |
| DELETE | `/api/orgs/{org}/comments/{id}` | Delete own (or O M any) | | |
| GET | `/api/orgs/{org}/comments/mentionable` | @-mention candidates (names only) | | |
| GET, PUT | `/api/orgs/{org}/projects/{p}/request-form` | Form settings | O M | |
| POST | `/api/public/request-forms/{token}` | Public submit (honeypot) | public | 5 / IP+form / 10 min |
| GET | `/api/orgs/{org}/requests` | Inbox | O M D | |
| POST | `/api/orgs/{org}/requests/{id}/decision` | Accept → task / decline | O M D | |
| POST | `/api/orgs/{org}/ai/ask` | Ask AI with citations | all | 30 AI calls / person / h |
| POST | `/api/orgs/{org}/ai/meeting-notes` | Notes + action items from pasted transcript | O M D | same |
| GET, POST | `/api/orgs/{org}/ai/progress-summary` | Plain-words summary (1 h cache) | all | same |

### Meetings (needs worker for import)

`GET /meetings`, `GET /meetings/{id}`, `GET /meetings/{id}/transcript`, `GET /meetings/{id}/notes`,
`GET|POST /meetings/{id}/speakers`, `GET /meetings/{id}/routing-candidates`, `POST /meetings/{id}/route`,
`POST /meetings/{id}/skip`, `POST /meetings/{id}/retry`, `POST /meetings/{id}/guest-consent`;
`GET /action-items`, `GET /action-items/{id}`, `POST /action-items/{id}/decision`
(`{decision: 'approve'|'edit'|'reject', values?, reason?, note?}`, `If-Match`, `Idempotency-Key`);
Zoom: `GET|POST|DELETE /integrations/zoom`, `POST /integrations/zoom/callback`, `GET /integrations/zoom/hosts`,
`PATCH /integrations/zoom/hosts/{zoomUserId}`, `GET|PATCH /zoom/my-consent`.

## 6.3 Key payloads

```ts
// TaskDTO — what list, board and drawer receive
export interface TaskDTO {
  id: TaskId; key: TaskKey; projectId: ProjectId; parentTaskId: TaskId | null;
  type: { id: string; name: string; level: -1 | 0 | 1; icon: string };
  title: string; descriptionMd: string | null;
  status: { id: StatusId; name: string; category: 'todo' | 'in_progress' | 'done'; color: string | null };
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee: PersonDTO | null; reporter: PersonDTO | null;
  startDate: IsoDate | null; dueDate: IsoDate | null; completedAt: IsoInstant | null;
  labels: Array<{ id: string; name: string; color: string }>;
  custom: Record<string, unknown>;              // keyed by field key in the DTO (id in the DB)
  estimateSeconds: number | null; spentSeconds: number;
  flagged: boolean; rank: Rank; version: number;
  counts: { subtasks: number; subtasksDone: number; comments: number; files: number; openBlockers: number };
  source: 'manual' | 'zoom_meeting' | 'request' | 'import' | 'automation';
  createdAt: IsoInstant; updatedAt: IsoInstant; archivedAt: IsoInstant | null;
}

export const CreateTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(512),
  descriptionMd: z.string().max(100_000).optional(),
  typeId: z.string().uuid().optional(),
  statusId: z.string().uuid().optional(),           // default: workflow initial
  priority: Priority.default('medium'),
  assigneeId: z.string().uuid().nullable().optional(),
  parentTaskId: z.string().uuid().nullable().optional(),
  startDate: IsoDateSchema.nullable().optional(),
  dueDate: IsoDateSchema.nullable().optional(),
  labelIds: z.array(z.string().uuid()).max(20).optional(),
  custom: z.record(z.unknown()).optional(),          // validated against field_definitions server-side
  estimateSeconds: z.number().int().min(0).max(10_000_000).optional(),
  beforeId: z.string().uuid().optional(), afterId: z.string().uuid().optional(),
}).refine((v) => !v.startDate || !v.dueDate || v.startDate <= v.dueDate, 'Start must be before due');
```

## 6.4 Planned endpoints — work

| Method | Path | Body / query | Response | Roles |
|---|---|---|---|---|
| GET | `/workflows` | — | `Workflow[]` | O M D |
| POST | `/workflows` | `{name, templateKey?}` | `Workflow` | O M |
| PUT | `/workflows/{id}` | full `Workflow` (`If-Match`) | `Workflow` | O M |
| POST | `/workflows/{id}/migrate-check` | `{statusMap}` | `{affectedTasks, unmapped[]}` | O M |
| POST | `/tasks/{id}/transition` | `{toStatusId, comment?, fields?}` | `TaskDTO` / `409 TRANSITION_REFUSED` | O M D |
| GET | `/tasks/{id}/transitions` | — | `{id, name, to, allowed, reason?}[]` (for the status button) | O M D |
| GET, POST | `/fields` | `FieldDefinition` | | R O M D; W O M |
| PATCH, DELETE | `/fields/{id}` | | | O M |
| GET, PUT | `/projects/{p}/field-layout` | `FieldLayoutItem[]` | | O M |
| GET, POST | `/work-types` | | | O M |
| GET, POST, DELETE | `/tasks/{id}/links` | `{toTaskId, type}` | `TaskLinkDTO[]` | O M D |
| GET, POST, DELETE | `/tasks/{id}/watchers` | `{userId?}` (self default) | | all editors |
| GET | `/tasks/{id}/activity` | cursor | `ActivityDTO[]` | O M D |
| POST | `/tasks/bulk` | `{ids[], patch, transitionTo?}` (≤ 500, Dev view) | `{updated, failed[]}` | O M D |
| GET | `/search/tasks` | `?wql=…&limit&cursor&columns` | paginated `TaskDTO` | O M D |
| POST | `/search/wql/validate` | `{wql}` | `{ok, ast?, error?: {offset, message}}` | O M D |
| POST | `/ai/wql` | `{sentence}` | `{ast, wql, chips}` | all |
| GET, POST | `/filters`, `/filters/{id}` | `{name, wql, sharing, columns}` | | O M D |
| GET, POST, DELETE | `/tasks/{id}/worklogs` | `{startedAt, seconds, note?, billable}` | | O M D |
| POST | `/timer/start`, `/timer/stop` | `{taskId}` | running worklog | O M D |
| GET | `/reports/time` | `?from&to&groupBy=person|project|task&billable` | rows + totals | O M |
| GET, POST | `/projects/{p}/sprints` | | | O M D (Pro) |
| POST | `/sprints/{id}/start`, `/complete` | `{moveOpenTo: sprintId|'backlog'}` | | O M |
| POST | `/projects/{p}/from-template` | `{templateKey, name, keyPrefix?}` | `{projectId}` | O M D |
| GET | `/templates` | `?category` | `TemplateSummary[]` | all editors |

## 6.5 Planned endpoints — knowledge, goals, dashboards, automation, admin

| Method | Path | Purpose | Roles |
|---|---|---|---|
| PATCH | `/docs/{id}/move` | `{parentDocId, beforeId?, afterId?}` page tree | O M D |
| GET | `/docs/{id}/children` | lazy page tree | all |
| GET, POST | `/goals`, `/goals/{id}` | goals CRUD | R all (restricted: followers/owner); W O M D |
| POST | `/goals/{id}/updates` | weekly status update | owner, O M |
| POST | `/goals/{id}/updates/draft` | AI draft from linked work (human posts it) | owner, O M |
| POST, DELETE | `/goals/{id}/links`, `/follow` | | |
| GET, POST, PUT | `/dashboards`, `/dashboards/{id}` | dashboards CRUD | R by sharing; W owner, O M |
| GET | `/dashboards/{id}/gadgets/{gid}/data` | computed with viewer's permissions | |
| GET | `/public/dashboards/{token}` | public link (org toggle) | public, 60/min/IP |
| GET, POST, PUT, DELETE | `/automation/rules`, `/rules/{id}` | rules CRUD | O M (project rules: project managers) |
| POST | `/automation/rules/{id}/test` | dry run on one task: returns planned actions | O M |
| GET | `/automation/runs` | audit log, filters `status, ruleId, from, to, taskKey` | O M |
| GET | `/automation/usage` | this month: runs, AI actions, limit | O M |
| POST | `/automation/from-words` | AI drafts a rule from a sentence | O M |
| GET, POST | `/imports`, `/imports/{id}` | create job from uploaded file, mapping, status | O M |
| POST | `/exports` | `{kind: 'org_backup' \| 'user_data' \| 'project_csv' \| 'jira_csv' \| 'audit_csv'}` → job; `GET /exports/{id}` → signed URL when done. `jira_csv` uses the column names Jira's CSV importer expects (chapter 01 §1.7) | O (org backup, Jira CSV), self (user data) |
| GET | `/audit-log` | org activity with filters, CSV export | O |
| GET | `/admin/permission-helper` | `?userId&targetType&targetId` → explanation steps | O M |
| GET, PUT | `/settings` | `org_settings` | O |
| GET, PUT | `/me/preferences` | `user_preferences` + `view` (`dev`/`pm`/`founder`; locked for Executive and Client), time zone | self |
| GET, POST, DELETE | `/me/api-tokens` | create (secret shown once), revoke | self (Dev view) |
| GET, POST, PATCH, DELETE | `/webhooks`, `/webhooks/{id}` | outbound webhooks | O M |
| GET | `/webhooks/{id}/deliveries`, `POST …/{deliveryId}/redeliver` | | O M |
| GET | `/usage` | storage, members, AI spend (₹ month-to-date vs budget), automation runs | O |

## 6.6 Direct uploads (fixes the 4 MB limit)

```
1. POST /files/upload-url   {name, contentType, sizeBytes, nodeId, taskId?}
   ← 201 {fileId, uploadUrl, headers, expiresAt}       (pre-created row, status 'pending', 10-min URL)
2. PUT  uploadUrl  (browser → Supabase Storage / S3 directly, body = file)
3. POST /files/{fileId}/complete
   ← 200 FileDTO                                       (server HEADs the object, checks size and type)
```

Rules: size ≤ `org_settings.max_upload_mb` (default 25 MB; per-plan maximum: TBD — pricing not decided); content type allowlist (images,
PDF, Office, text, CSV, ZIP, MP4/WebM up to the plan's limit, TBD — pricing not decided); `Content-Disposition: attachment` on download for
anything not image/PDF/video (blocks HTML/SVG XSS); pending rows older than 1 h are purged with their objects.
Add `status varchar(10) NOT NULL DEFAULT 'ready' CHECK (status IN ('pending','ready'))` to `files`.

## 6.7 Realtime hints (optional, Phase 2)

Server → client messages carry ids only; the client refetches through the normal API (RLS applies):

```json
{ "t": "task.upserted", "projectId": "…", "taskId": "…", "version": 9 }
{ "t": "comment.created", "targetType": "task", "targetId": "…" }
{ "t": "notification.created" }
```

Channel names: `org:{orgId}:project:{projectId}`, `org:{orgId}:user:{userId}`. Tokens are minted per channel
list by `RealtimePort.mintToken`, valid 1 h.

## 6.8 Rate limits and quotas

Counters live in `rate_limit_counters` (shared across instances, keys SHA-256-hashed so no emails or IPs are
stored). Fixed windows aligned to the clock; `Retry-After` = seconds to window end.

| Scope | Key | Limit | Window | Why / status |
|---|---|---|---|---|
| Sign-in email | `sign-in-email:{email}` | 5 | 1 h | stop email bombing a person — **built** |
| Sign-in email | `sign-in-ip:{ip}` | 20 | 1 h | stop enumeration — **built** |
| Sign-in code | `sign-in-code:{email}` | 5 | 15 min | stop guessing a 6-digit code (5 tries ⇒ 1 in 200,000 per window) — **built** |
| Org creation | `org-create:{userId}` | 5 | 1 day | stop spam orgs — planned |
| Invitations | `invitations:{orgId}` | 100 | 1 day | **built** |
| Public request form | `request-form:{ip}:{token}` | 5 | 10 min | **built** |
| Public dashboard | `public-dash:{ip}` | 60 | 1 min | scraping — planned |
| AI calls (any) | `ai:{userId}` | 30 | 1 h | **built** |
| AI calls (org) | monthly ₹ budget | `orgs.ai_budget_inr` | month | **P0, still open**: hard cap at 100 %, email Owner at 80 % |
| Uploads | `uploads:{userId}` | 60 | 1 h | **built** |
| Storage | org total | per plan (TBD — pricing not decided) | — | `PLAN_LIMIT` |
| Mutations (browser) | `mut:{userId}` | 600 | 1 min | runaway clients — **in Redis/KV, not Postgres** (one counter write per mutation would add load; chapter 11 §11.4) |
| Requests per org (browser) | `org:{orgId}` | 3,000 | 1 min | one large org can't slow everyone (review #20); Redis/KV |
| Public API | `api:{tokenId}` | 1,000 | 1 min; burst 50/s | same as Fastify default 600 → raise for tokens |
| Public API | `api-org:{orgId}` | 5,000 | 1 min | protect DB from one org |
| Webhook endpoints | per org | 20 endpoints | — | |
| Automation | runs per org | per plan (TBD — pricing not decided) | month | `throttled` status |
| Automation | runs per rule | 100 | 1 min | loop protection backstop |
| Export | `export:{orgId}` | 3 | 1 day | heavy job |
| Import | concurrent per org | 1 | — | |

Where each limit lives (review #10):

| Store | Limits | Why |
|---|---|---|
| Vercel Firewall (edge) | per-IP limits on `/api/auth/*`, `/api/public/*`, `/d/*` | rejects floods before a function or the database runs |
| Postgres `rate_limit_counters` (built) | per-address sign-in, codes, invitations, AI, uploads, request form | low volume (a few hits a minute); one row write each, no extra service |
| Redis / Vercel KV (when §11.4 step 2 triggers) | per-person mutations, per-org request budget, API tokens | high volume; a database write per request would be real load |

Read-heavy endpoints get no per-request limiter at all; they are protected by the edge rules and the per-org
budget.

## 6.9 Outbound webhooks

Delivery:

```http
POST https://customer.example.com/hooks/workspace
Content-Type: application/json
User-Agent: Workspace-Webhooks/1
Webhook-Id: 0192f7…               (delivery id; idempotency key for receivers)
Webhook-Timestamp: 1793011200
Webhook-Signature: v1,<base64 HMAC-SHA256(secret, id + "." + timestamp + "." + body)>

{ "id": "evt_0192f7…", "type": "task.transitioned", "orgId": "…", "occurredAt": "2026-10-28T10:00:00Z",
  "actor": { "id": "…", "name": "Arjun" },
  "data": { "task": { …TaskDTO… }, "from": { "id": "…", "name": "Doing" }, "to": { "id": "…", "name": "Done" } } }
```

Follows the Standard Webhooks spec (same headers), so receivers can use existing libraries. Retries: 8 attempts
over ~24 h (1 m, 5 m, 30 m, 2 h, 6 h, 12 h, 24 h); 2xx = delivered; 410 = disable endpoint; 50 consecutive
failures = auto-disable + email the Owner. Timeout 10 s; body ≤ 256 KB (larger → `data` replaced by a link to
the public API). Endpoints must be `https://` and must not resolve to private, loopback or link-local addresses
(checked at save time **and** at send time to stop DNS-rebinding SSRF).

## 6.10 Public API and tokens

- Tokens: `wsp_` + 8-char prefix + `_` + 32 random bytes base62. Stored as SHA-256 hash; prefix shown in UI.
- Scopes: `read` (GET), `write` (task/doc/comment mutations), `admin` (members, webhooks, settings).
  A token never exceeds its owner's role; if the owner is demoted or removed, the token loses access at once
  (checked per request via membership).
- Same resources and DTOs as the browser API, under `/api/v1/orgs/{orgId}/…`, served by Fastify, with OpenAPI
  3.1 generated from the Zod schemas (`@fastify/swagger` is already a dependency).
- OAuth 2.1 (authorization code + PKCE) for third-party apps comes later (P3).

### MCP server (developer feature, Phase 1)

A Model Context Protocol server at `/mcp` (Streamable HTTP), authenticated with a scoped API token, so a
developer works with tasks from **Claude Code, Cursor or VS Code** without opening the app. A competitor (LTD)
already ships an MCP server in beta, so this is **table stakes, not a differentiator**: it must exist at launch
for the Dev view to be credible.

| Tool | Input | Does | Scope |
|---|---|---|---|
| `my_tasks` | `{status?, project?}` | "What's assigned to me", ordered by priority and due date | read |
| `get_task` | `{key}` | Task with description, subtasks, links, last comments | read |
| `search_tasks` | `{wql? \| text?}` | WQL or plain text search | read |
| `create_task` | `{project, title, description?, assignee?, priority?, parent?}` | Creates a task; returns key and URL | write |
| `update_status` | `{key, to}` | "Mark ENG-142 done": `to` may be a status name or a stage (`in_review`, `done`) | write |
| `comment` | `{key, body}` | Adds a Markdown comment | write |
| `log_time` | `{key, minutes, note?}` | Worklog | write |
| `summarize_project` | `{project}` | Progress summary (fast-tier AI, counts against the org's AI budget) | read |

The MCP tools call the same `packages/db` operations as the browser API, so permissions, RLS, `If-Match` and the
outbox behave identically. Every MCP write is recorded in `activity_log` with `payload.via = 'mcp'`. Setup page:
*Settings → Developer → Connect your editor* shows the token and a copy-paste config for each editor.

## 6.11 GitHub integration (Phase 1)

A GitHub App (not a personal OAuth token) installed on the org's repositories, with read access to pull
requests and branches and permission to post check-run summaries.

| Event (GitHub webhook) | Match | Effect |
|---|---|---|
| `create` (branch) | task key in the branch name, case-insensitive (`eng-142-fix-login`, `feature/ENG-142`) | link branch to task; move task to the first `in_progress` stage status if it is in `todo`/`backlog` |
| `pull_request.opened` / `ready_for_review` | key in PR title, branch or body | link PR; move task to the `in_review` stage status if one exists |
| `pull_request.closed` with `merged = true` | same | move task to the `done` stage status, set resolution `done`; comment "Merged in #123" |
| `pull_request.closed` without merge | same | unlink nothing; comment "PR closed without merging"; no status change |
| `check_suite.completed` | linked PR | PR status (passing/failing) shown on the task |

```sql
CREATE TABLE git_links (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  org_id uuid NOT NULL, task_id uuid NOT NULL,
  provider varchar(12) NOT NULL DEFAULT 'github' CHECK (provider IN ('github','gitlab','bitbucket')),
  kind varchar(8) NOT NULL CHECK (kind IN ('branch','pr','commit')),
  repo varchar(200) NOT NULL, ref varchar(255) NOT NULL,   -- 'owner/repo', branch name or PR number
  url varchar(1024) NOT NULL, state varchar(16),            -- open | merged | closed | passing | failing
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, provider, kind, repo, ref),
  FOREIGN KEY (org_id, task_id) REFERENCES tasks (org_id, id) ON DELETE CASCADE
);
```

Rules: webhook signature (`X-Hub-Signature-256`) verified in Fastify `/webhooks/github`; deliveries deduplicated by
`X-GitHub-Delivery`; status moves go through `planTransition` (chapter 05 §5.3), so workflow rules still apply and
a refused move is shown on the task instead of failing silently; each project chooses which GitHub events move
status (default: all three). GitLab and Bitbucket follow later as adapters behind a `GitProviderPort`
(`verifyWebhook`, `parseEvent`, `prUrl`).
