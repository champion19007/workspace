# 05 — Domain types and algorithms

TypeScript is the contract between database, API and UI. Every type below lives in `packages/core` with a
Zod schema; DTOs leave the server, row types never do.

## 5.1 Branded IDs and primitives

```ts
// packages/core/src/types/ids.ts
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type OrgId = Brand<string, 'OrgId'>;
export type UserId = Brand<string, 'UserId'>;
export type NodeId = Brand<string, 'NodeId'>;        // team or project
export type ProjectId = NodeId;
export type TaskId = Brand<string, 'TaskId'>;
export type StatusId = Brand<string, 'StatusId'>;
export type FieldId = Brand<string, 'FieldId'>;
export type DocId = Brand<string, 'DocId'>;
export type GoalId = Brand<string, 'GoalId'>;
export type RuleId = Brand<string, 'RuleId'>;

export type IsoDate = Brand<string, 'IsoDate'>;          // 'YYYY-MM-DD'
export type IsoInstant = Brand<string, 'IsoInstant'>;    // RFC 3339 UTC
export type DecimalString = Brand<string, 'Decimal'>;    // '125000.00'
export type Rank = Brand<string, 'Rank'>;                // base-62 fractional index
export type TaskKey = Brand<string, 'TaskKey'>;          // 'ENG-142'

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/) as unknown as z.ZodType<IsoDate>;
```

Brands cost nothing at runtime and stop a `TaskId` being passed where a `ProjectId` is expected — a real class
of bug in code that handles many UUIDs.

## 5.2 Core enums (single source of truth)

```ts
export const OrgRole = z.enum(['owner', 'admin', 'member', 'viewer', 'client']);
export const OrgRoleLabel = { owner: 'Owner', admin: 'Manager', member: 'Developer', viewer: 'Executive', client: 'Client' } as const;
export const ProjectRole = z.enum(['manager', 'contributor', 'viewer']);
export const UiMode = z.enum(['simple', 'pro']);
export const StatusCategory = z.enum(['todo', 'in_progress', 'done']);
export const Priority = z.enum(['low', 'medium', 'high', 'urgent']);
export const WorkTypeLevel = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
export const LinkType = z.enum(['blocks', 'relates', 'duplicates', 'clones']);
export const Resolution = z.enum(['done', 'wont_do', 'duplicate', 'cannot_reproduce']);
export const FieldType = z.enum(['text','long_text','number','currency','date','select','multi_select','person','checkbox','url','rating']);
export const GoalStatus = z.enum(['pending','on_track','at_risk','off_track','done','cancelled']);
export const RunStatus = z.enum(['config_change','success','no_actions','in_progress','waiting','queued_for_retry','loop','throttled','some_errors','failure']);
export const RequestStatus = z.enum(['new', 'accepted', 'declined']);
export const CommentTarget = z.enum(['task', 'node', 'doc', 'meeting']);
```

## 5.3 Workflow state machine

### Types

```ts
export interface WorkflowStatus {
  id: StatusId; name: string; category: StatusCategory;
  color: string | null; position: number; isInitial: boolean; wipLimit: number | null;
}
export interface TransitionRules {
  // Conditions: who may run it
  roles?: Array<'manager' | 'contributor'>;     // project roles allowed; default all editors
  onlyAssignee?: boolean;
  // Validators: what must be true
  requireFields?: string[];                      // field keys that must be non-empty
  requireComment?: boolean;
  blockIfOpenBlockers?: boolean;                 // any unfinished 'blocks' link → refuse
  allSubtasksDone?: boolean;
  // Post-functions: what happens after
  setResolution?: Resolution;
  assignTo?: 'reporter' | 'unassigned' | { userId: UserId };
  clearFields?: string[];
}
export interface WorkflowTransition {
  id: string; name: string; from: StatusId | null; to: StatusId; rules: TransitionRules; position: number;
}
export interface Workflow {
  id: string; name: string; freeMovement: boolean;
  statuses: WorkflowStatus[]; transitions: WorkflowTransition[]; version: number;
}
```

### Algorithm: `planTransition`

Pure function in core; the db layer runs it inside the update transaction with fresh rows.

```ts
export type TransitionError =
  | { code: 'NOT_ALLOWED_FROM_HERE' } | { code: 'ROLE'; need: string[] }
  | { code: 'NOT_ASSIGNEE' } | { code: 'MISSING_FIELDS'; fields: string[] }
  | { code: 'COMMENT_REQUIRED' } | { code: 'OPEN_BLOCKERS'; taskKeys: TaskKey[] }
  | { code: 'OPEN_SUBTASKS'; count: number } | { code: 'WIP_LIMIT'; limit: number };

export function planTransition(input: {
  workflow: Workflow; task: TaskSnapshot; toStatusId: StatusId; actor: Actor;
  comment?: string; openBlockers: TaskKey[]; openSubtasks: number; countInTarget: number;
}): { ok: true; patch: TaskPatch } | { ok: false; error: TransitionError } {
  const { workflow, task, toStatusId } = input;
  const target = workflow.statuses.find((s) => s.id === toStatusId)!;
  const t = workflow.freeMovement
    ? { rules: {} as TransitionRules }
    : workflow.transitions.find((x) => x.to === toStatusId && (x.from === null || x.from === task.statusId));
  if (!t) return { ok: false, error: { code: 'NOT_ALLOWED_FROM_HERE' } };
  const r = t.rules;
  if (r.roles && !r.roles.includes(input.actor.projectRole as never)) return { ok: false, error: { code: 'ROLE', need: r.roles } };
  if (r.onlyAssignee && task.assigneeId !== input.actor.userId) return { ok: false, error: { code: 'NOT_ASSIGNEE' } };
  const missing = (r.requireFields ?? []).filter((k) => isEmpty(fieldValue(task, k)));
  if (missing.length) return { ok: false, error: { code: 'MISSING_FIELDS', fields: missing } };
  if (r.requireComment && !input.comment?.trim()) return { ok: false, error: { code: 'COMMENT_REQUIRED' } };
  if (r.blockIfOpenBlockers && input.openBlockers.length) return { ok: false, error: { code: 'OPEN_BLOCKERS', taskKeys: input.openBlockers } };
  if (r.allSubtasksDone && input.openSubtasks > 0) return { ok: false, error: { code: 'OPEN_SUBTASKS', count: input.openSubtasks } };
  if (target.wipLimit && input.countInTarget >= target.wipLimit) return { ok: false, error: { code: 'WIP_LIMIT', limit: target.wipLimit } };
  return { ok: true, patch: buildPatch(task, target, r) };   // sets statusId, statusCategory, completedAt, resolution, assignee
}
```

Every error code has a plain-language message in the UI ("Finish the 2 subtasks first", "Only Arjun or a
manager can approve"). The API returns `409` with `code: 'TRANSITION_REFUSED'` and the error in `details`.

**WIP limits** are soft on the board in the PM view (warning colour) and hard in the Dev view when the project
manager ticks *enforce*.

### Templates shipped in core

| Key | Statuses (category) | Transitions | Typical use |
|---|---|---|---|
| `simple` | To do (todo) → Doing (in_progress) → Stuck (in_progress) → Done (done) | free movement | Everything |
| `approval` | Draft → In review → Changes needed → Approved (done) → Rejected (done) | Review needs manager role; Approved requires comment | Marketing, legal, finance |
| `content` | Idea → Writing → Editing → Scheduled → Published (done) | free | Content teams |
| `hiring` | Applied → Screening → Interview → Offer → Hired (done) / Not hired (done, wont_do) | free | HR |
| `bug` | Open → In progress → In review → Done / Won't fix | Done requires resolution | Software |
| `service` | New → Waiting for us → Waiting for requester → Resolved (done) | free | Request forms |

## 5.4 Ranking (fractional index) and rebalancing (fixes D6)

`tasks.rank` is a base-62 string compared with `COLLATE "C"`. Inserting between `a` and `b` takes the midpoint
string; one row write per drag (stage 7). Strings grow when people repeatedly insert in the same gap.

```ts
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Midpoint between a and b (a < b, either may be '' meaning -∞/+∞). */
export function rankBetween(a: string, b: string): Rank { /* existing implementation in core/tasks */ }

export const RANK_REBALANCE_AT = 64;   // chars; column limit is 128
```

**Rebalance job** (`org.maintenance` with `kind: 'rank_rebalance'`): triggered when any write produces a rank
longer than 64 characters in a `(project_id, status_id)` column. It runs in one transaction:

```sql
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY rank COLLATE "C", id) AS n
  FROM tasks WHERE project_id = $1 AND status_id = $2 AND archived_at IS NULL
  FOR UPDATE
)
UPDATE tasks t SET rank = rank_for_index(o.n, $3)          -- version NOT bumped (review #33)
FROM ordered o WHERE t.id = o.id;
```

`rank_for_index(n, total)` spreads keys evenly in 3-character space (62³ = 238,328 slots), so a column of up
to ~20 k cards gets ≥ 10 slots between neighbours.

Rebalancing must not bump `version`: `version` guards *content* edits (`If-Match` on the task drawer), and
bumping it on every card would make every open board and drawer answer `412` at once. Rank needs no version
check because the move endpoint takes neighbour ids (`{statusId, beforeId?, afterId?}`) and computes the new
rank from the neighbours' **current** ranks on the server; a client holding stale rank strings can't produce a
wrong order. The job publishes one `project.reranked` realtime hint so open boards refetch their column order.
Run it in the background when triggered, or nightly for columns past the threshold.

## 5.5 Tree paths

`nodes.path` stores ancestor ids as an `ltree`-compatible label path (`org.<team>.<subteam>.<project>` with
hyphens removed). Queries:

| Need | SQL |
|---|---|
| All projects under a team | `WHERE path <@ $teamPath AND kind = 'project'` (GiST index) |
| Ancestors (breadcrumbs) | `WHERE $path <@ path` |
| Move subtree | one `UPDATE … SET path = $new || subpath(path, nlevel($old))` in a transaction (< 500 ms for 500 nodes, stage 6 requirement) |

Docs get the same pattern (`docs.path`) for the page tree.

## 5.6 WQL — Workspace Query Language

A small, safe subset of JQL, used in the Dev view. The PM view never shows it; the chip filters and "Ask in words" generate it.

### Grammar (EBNF)

```
query      = [ expr ] [ "ORDER BY" order { "," order } ] ;
expr       = term { ("AND" | "OR") term } ;
term       = [ "NOT" ] ( "(" expr ")" | clause ) ;
clause     = field op value
           | field ("IN" | "NOT IN") "(" value { "," value } ")"
           | field "IS" [ "NOT" ] "EMPTY" ;
op         = "=" | "!=" | ">" | ">=" | "<" | "<=" | "~" | "!~" ;   (* ~ = contains text *)
field      = ident | "cf[" string "]" ;                              (* custom field by key *)
value      = string | number | date | function ;
function   = ident "(" [ value { "," value } ] ")" ;                 (* currentUser(), startOfWeek(-1), now() *)
order      = field [ "ASC" | "DESC" ] ;
```

Fields: `project, key, title, text, status, category, priority, assignee, reporter, label, type, parent,
due, start, created, updated, completed, sprint, flagged, watcher, linkedTo, goal, cf["…"]`.
Functions: `currentUser()`, `now()`, `today()`, `startOfDay/Week/Month(±n)`, `endOfDay/Week/Month(±n)`,
`membersOf("team name")`.

### Compilation

```ts
export type WqlNode =
  | { k: 'and' | 'or'; items: WqlNode[] } | { k: 'not'; item: WqlNode }
  | { k: 'cmp'; field: WqlField; op: WqlOp; value: WqlValue }
  | { k: 'in'; field: WqlField; negate: boolean; values: WqlValue[] }
  | { k: 'empty'; field: WqlField; negate: boolean };

export interface CompiledQuery { sql: string; params: unknown[]; orderBy: string; }
export function compileWql(ast: WqlNode, ctx: WqlContext): CompiledQuery;
```

Rules that keep it safe and cheap:

1. **Parameters only.** Values become `$n` parameters; field names map through a fixed whitelist to SQL
   expressions (`due → tasks.due_date`, `cf["budget"] → (tasks.custom->>'<id>')::numeric`). No string
   concatenation of user input.
2. **RLS still applies.** The compiled `WHERE` runs inside the tenant transaction; WQL cannot widen access.
3. **Limits.** ≤ 50 clauses, nesting depth ≤ 8, `IN` lists ≤ 200, `~` text search uses `tsv @@
   plainto_tsquery('simple', $n)`, `statement_timeout = 3s` for WQL queries.
4. **Dates** are resolved in the viewer's time zone at compile time (`today()` = local date).
5. **Errors** return the character offset and a friendly message: `Unknown field "assigne" — did you mean
   "assignee"?` (Levenshtein ≤ 2 against the whitelist).

### "Ask in words" (PM view)

`"show me Meera's overdue design tasks"` → fast-tier model with the field whitelist and the org's project/label
/person names in the prompt (cached) → `WqlNode` JSON validated by Zod → shown as chips the person can edit.
Cost ≈ ₹0.02 per question on Haiku 5.5 (chapter 08). The model never sees task data for this; only names.

## 5.7 Rollups

Existing design (stage 9) stays: `nodes.rollup jsonb` holds counters, recomputed debounced bottom-up via
`node_rollup_dirty`. Target shape:

```ts
export interface NodeRollup {
  computedAt: IsoInstant; generation: number;
  tasks: { total: number; todo: number; inProgress: number; done: number; stuck: number };
  overdueCount: number; dueSoonCount: number;          // dueSoon = due within 3 local days
  completionPercentage: number;                        // done / total, 0–100, integer
  health: 'on_track' | 'at_risk' | 'off_track' | 'no_tasks';
  spentSeconds?: number; estimateSeconds?: number;     // when time tracking on
  goalIds?: GoalId[];
}
```

**Health rule** (single implementation, fixes D10):

```ts
export function healthOf(r: Omit<NodeRollup, 'health'>, today: IsoDate): NodeRollup['health'] {
  if (r.tasks.total === 0) return 'no_tasks';
  const open = r.tasks.total - r.tasks.done;
  const lateShare = open ? r.overdueCount / open : 0;
  if (lateShare >= 0.25 || r.tasks.stuck >= 3) return 'off_track';
  if (lateShare > 0 || r.tasks.stuck > 0 || r.dueSoonCount > open / 2) return 'at_risk';
  return 'on_track';
}
```

Counts use `status_category`, never status names. "Stuck" = statuses with `legacy_key='blocked'` or an open
`blocks` link pointing at the task.

## 5.8 Dashboard gadgets

```ts
export type GadgetConfig =
  | { kind: 'assigned_to_me'; limit: number }
  | { kind: 'activity'; projectIds?: ProjectId[]; limit: number }
  | { kind: 'projects_health'; teamId?: NodeId }
  | { kind: 'filter_results'; filterId: string; columns: string[]; limit: number }
  | { kind: 'pie'; filterId: string; groupBy: 'status' | 'assignee' | 'priority' | 'label' | `cf:${string}` }
  | { kind: 'created_vs_done'; filterId: string; days: 7 | 30 | 90; cumulative: boolean }
  | { kind: 'two_dimensional'; filterId: string; x: string; y: string }
  | { kind: 'overdue'; projectIds?: ProjectId[] }
  | { kind: 'goals'; goalIds?: GoalId[]; followingOnly: boolean }
  | { kind: 'workload'; teamId?: NodeId; weeks: 1 | 2 | 4 }
  | { kind: 'time_logged'; filterId?: string; groupBy: 'person' | 'project'; days: 7 | 30 }
  | { kind: 'text'; bodyMd: string };
```

Each gadget fetches through `GET /dashboards/{id}/gadgets/{gid}/data`, cached per (gadget, viewer) for 60 s in
Postgres (`gadget_cache` unlogged table) — enough to make a 10-gadget dashboard cost one query per gadget per
minute regardless of viewers.

**Workload** gadget (from LTD and Atlassian Teams): open tasks with due date in the window per person, weighted
by `estimate_seconds` (or 1 per task when no estimates), compared with the person's working hours.

## 5.9 Notifications: who hears about what

The comment rule is implemented in `commentRecipients()` (`packages/core/src/comments/index.ts`, committed in
`752e2a4`): the people mentioned, the task's assignee and creator, and the thread's latest
`MAX_THREAD_RECIPIENTS = 10` earlier commenters, minus the author; the caller then drops anyone who can't see the
target. The general rule for every event:

```ts
export function recipientsFor(event: DomainEvent, ctx: RecipientContext): Recipient[] {
  // 1. Candidates by event kind: assignee, reporter, watchers, @mentioned, earlier commenters (last 5),
  //    goal followers, request requester (email only).
  // 2. Drop the actor (no self-notifications).
  // 3. Drop anyone who can't see the target (checked in SQL with the same RLS function).
  // 4. Collapse: one notification per (user, target) per 10 minutes via dedupe_key = `${kind}:${targetId}:${bucket10m}`.
  // 5. Mark mentions as 'mentioned you' (higher priority, instant email if enabled).
}
```

Email channel rules as built (`0021`, `lib/email.ts`): mentions and new requests are emailed right after the
request that created them, if still unread and the person's switch is on; everything else unread from the last
two days rolls into one daily digest per person per org, sent by the 03:30 UTC cron (09:00 IST); each
notification is emailed at most once (`emailed_at`); every email has HMAC-signed one-click unsubscribe per kind
(RFC 8058 `List-Unsubscribe-Post`). Target: digest at 09:00 in the recipient's own time zone (finding E2).

## 5.10 Domain events catalogue

One list feeds notifications, automation triggers and webhooks. Written to `outbox.topic`.

| Event | Payload (beyond `{orgId, actorId, at}`) | Notifies | Automation | Webhook |
|---|---|---|---|---|
| `task.created` | `{taskId, projectId}` | assignee | ✓ | ✓ |
| `task.updated` | `{taskId, changed: FieldChange[]}` | assignee, watchers (if field ∈ title/due/assignee/priority) | ✓ | ✓ |
| `task.transitioned` | `{taskId, from, to, category}` | reporter, watchers | ✓ | ✓ |
| `task.assigned` | `{taskId, from, to}` | new assignee | ✓ | ✓ |
| `task.deleted` / `task.archived` | `{taskId}` | — | ✓ | ✓ |
| `task.due_soon` *(scheduled)* | `{taskId, dueDate}` | assignee | ✓ | — |
| `task.overdue` *(scheduled)* | `{taskId, dueDate}` | assignee, project managers (digest) | ✓ | — |
| `comment.created` | `{commentId, targetType, targetId, mentions}` | `commentRecipients()` | ✓ | ✓ |
| `link.created` / `link.deleted` | `{linkId, from, to, type}` | — | ✓ | ✓ |
| `worklog.created` | `{worklogId, taskId, seconds}` | — | ✓ | ✓ |
| `file.uploaded` | `{fileId, nodeId, taskId?}` | watchers | ✓ | ✓ |
| `doc.published` / `doc.updated` | `{docId, version}` | page watchers | ✓ | ✓ |
| `request.submitted` | `{requestId, formId}` | project managers | ✓ | ✓ |
| `request.decided` | `{requestId, status, taskId?}` | requester (email) | ✓ | ✓ |
| `goal.updated` | `{goalId, status}` | followers | ✓ | ✓ |
| `meeting.notes_ready` | `{meetingId, actionItemCount}` | host | ✓ | ✓ |
| `action_item.decided` | `{actionItemId, decision, taskId?}` | — | ✓ | — |
| `sprint.started` / `sprint.completed` | `{sprintId}` | project members | ✓ | ✓ |
| `member.joined` / `member.removed` / `member.role_changed` | `{userId, role}` | Owners (digest) | — | ✓ |
| `config.changed` | `{entity, id}` | — | `config_change` run entries | — |

## 5.11 Search

Global search box order of operations (no AI, no cost):

1. If the text matches `^[A-Z][A-Z0-9]{1,15}-\d+$`, jump to that task key.
2. Else run one SQL with three `UNION ALL` branches (tasks by `tsv`, docs by `tsv`, projects/people by
   `ILIKE prefix%`), each `LIMIT 8`, ranked with `ts_rank_cd`, all under RLS.
3. Show results grouped; *Ask AI* is a separate button, so cheap search stays cheap.

Ask AI (paid) uses hybrid retrieval once chunks have embeddings: top 40 by vector + top 40 by `tsv`, fused with
Reciprocal Rank Fusion (`score = Σ 1/(60 + rank)`), top 12 to the model with numbered citations (the existing
citation contract in `AskAiOutputSchema`).
