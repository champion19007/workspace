# 10 — Front-end architecture

## 10.1 Stack (as built) and the rule for adding to it

`next@15` (App Router), `react@19`, `tailwindcss@3`, `lucide-react` icons, `clsx` + `tailwind-merge`, `zod`.
No data-fetching library, no drag-and-drop library, no component kit beyond shadcn-style local components.

**Rule:** add a dependency only when the platform can't do it in a few dozen lines. Candidates this guide
expects to need, in order:

| Need | First choice | Add a library only if |
|---|---|---|
| Server data | React Server Components + route handlers + a 40-line `useResource()` hook (fetch, ETag, refetch on focus) | caching/invalidation logic exceeds ~200 lines → then TanStack Query |
| Board drag | Native HTML5 drag events + keyboard "Move to…" menu (already the accessible path) | touch drag on mobile is required → `@dnd-kit/core` |
| Rich text editor for docs | Markdown textarea with toolbar + preview (built) | Pro users ask for WYSIWYG → TipTap (ProseMirror) storing `body_json` + Markdown export |
| Charts (dashboards) | Inline SVG components (pie, bar, line, burn-up ≈ 300 lines total) | > 6 chart types → a small chart lib |
| Timeline/Gantt | CSS grid with one column per day (built) | dependency arrows between tasks → draw SVG paths over the grid, still no lib |
| Dates | `Intl.DateTimeFormat` + `Temporal` polyfill-free helpers in `lib/format.ts` | — |

## 10.2 Route map (target)

```
/                                   landing / sign-in redirect
/auth/login, /auth/verify-request, /auth/error
/invitations/accept
/onboarding                         job picker → template → first project (Phase 1)
/r/[token]                          public request form (built); /r/[token]/embed (iframe-friendly)
/d/[token]                          public dashboard/progress link (org toggle)
/orgs                               org picker
/orgs/[org]                         For you (Home): Get started, Assigned to me, Recent, Starred
/orgs/[org]/my-tasks
/orgs/[org]/inbox                   approvals (AI suggestions) + requests
/orgs/[org]/progress                Executive/Client home (locked view)
/orgs/[org]/projects                directory + template gallery
/orgs/[org]/projects/[p]/{dashboard|tasks|board|calendar|timeline|docs|docs/[d]|files|requests|settings|automation|backlog*}
/orgs/[org]/filters, /filters/[id]  saved WQL filters (Pro)
/orgs/[org]/dashboards, /dashboards/[id]
/orgs/[org]/goals, /goals/[id]
/orgs/[org]/meetings, /meetings/notes
/orgs/[org]/teams, /members (People), /profile/[user]
/orgs/[org]/chat                    Ask AI
/orgs/[org]/settings/{general|people|projects|workflows|fields|automation|integrations|webhooks|api-tokens|usage|audit-log|import|export}
```

`*` shown in the Dev view. Settings sections hide by role: Developers see only *My settings*.

## 10.3 Role-based views in the UI

Revision C replaces the Simple/Pro switch with four views (chapter 01 §1.5). One context, read everywhere:

```tsx
// components/shell/view-context.tsx
export type View = 'dev' | 'pm' | 'founder' | 'client';

export interface ViewContextValue {
  view: View;
  role: OrgRole;
  locked: boolean;                                  // Executive → founder, Client → client
  t: (key: VocabKey) => string;                     // vocabulary per view
  statusLabel: (s: { name: string; stage: Stage }, ctx?: { blockerOwner?: string }) => string; // chapter 01 §1.6
  setView(next: View): Promise<void>;               // PUT /me/preferences, then router.refresh()
}

const VOCAB: Record<View, Record<VocabKey, string>> = {
  dev:     { task: 'Issue', tasks: 'Issues', project: 'Project', epic: 'Epic', status: 'Status', filter: 'Filter', automation: 'Rule' },
  pm:      { task: 'Task', tasks: 'Tasks', project: 'Project', epic: 'Milestone', status: 'Step', filter: 'View', automation: 'Automation' },
  founder: { task: 'Task', tasks: 'Tasks', project: 'Project', epic: 'Milestone', status: 'Progress', filter: 'View', automation: 'Automation' },
  client:  { task: 'Item', tasks: 'Items', project: 'Project', epic: 'Milestone', status: 'Status', filter: 'View', automation: '' },
};
```

Pattern for view-dependent UI: never fork whole pages; fork small parts.

```tsx
<FieldList fields={layout.filter((f) => view === 'dev' || f.section === 'main')} />
{view === 'dev' && <WqlBox value={wql} onChange={setWql} />}
{view === 'pm' && <FilterChips />}
<StatusPill status={task.status} />   {/* uses statusLabel() for the current view */}
```

The server enforces permissions; the view only changes what's shown. A Dev-view endpoint called from the PM view
still works if the person's role allows it: the view is not a security boundary.

### Dev view requirements (keyboard-first, Markdown)

| Requirement | Detail |
|---|---|
| Command palette | `Ctrl/⌘ K` opens it everywhere: go to task by key, run any action, switch project or view |
| Shortcuts | `c` create, `e` edit, `a` assign, `s` change status, `l` labels, `m` move to project, `j`/`k` next/previous, `x` select, `Shift+X` select range, `/` filter, `g i` my issues, `g b` board, `?` list all. Every shortcut can be turned off (WCAG 2.1.4) |
| Markdown | Descriptions, comments and docs are Markdown: GitHub-flavoured tables, task lists, fenced code with highlighting, `@mention`, `ENG-142` auto-links to the task |
| Git | Branch name copy button (`eng-142-fix-login`), PR list and status on the task, status moves from Git events (chapter 06 §6.11) |
| Editor clients | MCP server (chapter 06 §6.10): the same actions from Claude Code, Cursor or VS Code |

### AI project setup (onboarding and "New project")

1. The person types a project title and a short description.
2. A fast-tier call (Claude Haiku 5.5, chapter 08 A17) returns a Zod-validated proposal: milestones, workflow
   statuses with stages, starter tasks with suggested owners from the invited people, and a first doc outline.
3. The proposal is shown as an editable checklist; nothing is created until the person clicks **Create project**
   (principle 5, humans approve AI).
4. The choice of template remains for people who'd rather pick one.

## 10.4 Layout and design system

- Tokens as CSS custom properties (built by the design-system pass): surfaces, text, borders, accent,
  status category colours (`--cat-todo`, `--cat-progress`, `--cat-done`), priority colours.
- Light and dark themes (built), org accent colour (move from localStorage to `orgs.accent`, keep per-person
  override).
- Components to add for parity: `QuickCreate` (ref 361: title, description, chips for type/parent/labels/due/
  team, *Create another*), `StatusButton` (shows allowed transitions with reasons), `WqlBox` (tokenising input
  with autocomplete), `ColumnPicker`, `GroupBy`, `Gadget` frame, `RuleBuilder` (trigger card → step cards),
  `PermissionExplainer`, `UsageMeter`.
- Density: comfortable rows (44 px) in the PM view, compact (32 px) in the Dev view, cards in the Founder and Client views.

## 10.5 Data flow on a page

```
Server component (page.tsx)
  └─ getServerContext() → db operations under the viewer's tenant context
  └─ renders initial HTML with data (no client waterfall)
Client islands (board, list, drawer)
  └─ useResource(url, {etag}) for refetch after mutations / focus / realtime hint
  └─ mutate(): optimistic update → fetch with If-Match → on 412 show "keep mine / use theirs"
```

Optimistic rules: board moves, status changes, title edits, checkbox subtasks are optimistic; anything that
fans out (bulk edit, workflow change, imports) waits for the server.

## 10.6 Live updates (finding: no realtime)

Revision B planned 15-second polling in Phase 1. Revision C drops that (review #18): with a third of people
keeping a board open, polling alone would be about a third of all database work (chapter 11 §11.6).

Phase 0: the **60-second version poll** below replaces the 15-second plan.

Phase 2: **Supabase Realtime broadcast hints** through `RealtimePort`. The outbox relay (or, before the worker
runs, the route handler via `after()`) publishes id-only hints (§6.7) on `org:{orgId}:project:{projectId}`;
the board refetches only the task named in the hint. Broadcast doesn't read the database, so open boards cost
nothing while idle.

Fallback (and the only mechanism until Phase 2): poll
`GET …/projects/{p}/changes?since=<cursor>` every **60 s**, only while the tab is visible. The endpoint answers
from one indexed lookup (`max(updated_at)` over the project's tasks, or `nodes.rollup.generation`) and returns
`304` when nothing changed. It can't be cached at the edge because the answer depends on who is asking (private
projects, clients), so it is kept cheap instead.

The version check (`If-Match`) still prevents lost updates either way.

## 10.7 Accessibility (WCAG 2.2 AA)

| Area | Rule |
|---|---|
| Board | Every card has a *Move to…* menu; arrow keys move focus between cards and columns; live region announces "Moved ENG-142 to Done" |
| Drawer/dialog | Focus trap, `Esc` closes, focus returns to the trigger (portals built in PR #2) |
| Colour | Status and priority always shown with text or icon, never colour alone; contrast ≥ 4.5:1 (tokens checked) |
| Forms | Labels on every input; errors linked with `aria-describedby`; request form usable without JavaScript |
| Motion | Respect `prefers-reduced-motion` |
| Keyboard shortcuts | Single-key shortcuts can be turned off (WCAG 2.1.4) in `user_preferences.shortcuts` |

## 10.8 Performance budgets

| Metric | Budget | How |
|---|---|---|
| LCP (Home, board, list) | ≤ 2.0 s on 4G mid-range phone | RSC with data in first response; no client fetch waterfall |
| INP | ≤ 200 ms | Optimistic updates; virtualise lists > 200 rows (simple windowing hook) |
| JS per route | ≤ 150 KB gzip | No heavy editor or chart lib until needed; dynamic `import()` for drawer, rule builder, WQL box |
| Board with 500 cards | ≤ 100 ms to render | Cards are plain elements; avatars lazy; counts precomputed in `TaskDTO.counts` |
| API p95 | reads ≤ 300 ms, writes ≤ 400 ms | Indexes in §4.17; one transaction per request |

## 10.9 Internationalisation

Strings move to `apps/web/src/i18n/{en,hi}.json` with a typed `t()` in Phase 2. Dates and numbers via `Intl` in
the viewer's locale and time zone (`users.locale`, `users.time_zone`). Right-to-left is out of scope.

## 10.10 Mobile

Responsive web first (all pages work at 375 px): sidebar becomes a bottom sheet, board columns scroll
horizontally with snap, the task drawer is full-screen. Installable PWA (manifest + icons; no offline sync) in
Phase 2. Native apps are not planned.
