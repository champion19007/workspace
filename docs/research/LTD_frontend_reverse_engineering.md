# LTD (Live Tracking Dashboard) by Eshway — Frontend Reverse-Engineering Report

**Target:** `https://ltd.eshway.com` · **Build:** `t5whabwPhBGwuTIxBCQHA` · **Date:** 2026-10-16 · **Requested by:** the signed-in customer (Free plan), who authorised analysis of the code their browser receives.

**Confidence tags used throughout:** **[static]** read directly from the shipped JavaScript; **[runtime]** observed read-only in the user's own signed-in session; **[inferred]** a reasoned conclusion, with its basis stated. Evidence is cited as `chunk#module` (paths relative to `/_next/static/chunks/`).

---

## 0. Scope, method and evidence

| Item | Detail |
|---|---|
| Code corpus | **158 original JavaScript files, 6.8 MB**: every chunk this build serves across all 46 routes. 83 files were captured on 2026-10-15 by the earlier Antigravity session; the other 75 (all protected `/dashboard/...` route code plus shared chunks) were downloaded on 2026-10-16 with the user's approval. Every file's size matches what the signed-in browser loaded; a SHA-256 manifest is kept with the corpus. Corpus root digest `815dc936…38c7`. |
| REA analysis | `rea-agents 6.5.0`, `analyze-javascript-application`: Evidence **`ev_ab495723…0e41`** (summary view `ev_9134232f…bea1`). 158/158 files parsed, **0 parse failures**, 2,230 modules, 8,081 findings. Limits: graph coverage is partial for 13 large chunks (their static facts are retained per file); REA's request extractor covers `fetch`/WebSocket/`node:http` only, and **LTD uses axios (XHR)**, so the API inventory below comes from code text plus runtime notes, not from REA. |
| Module index | Parse-only (Babel 8.0.4) index of all 2,232 webpack modules: string literals and template shapes per module. Nothing was executed. |
| API call sites | **279 HTTP-client call sites** across every importer of LTD's axios client. **All 279 were verified**: the URL expression occurs verbatim in the cited module, and the HTTP method occurs at the exact recorded position. |
| Runtime | Read-only observation in the user's own session: route manifest, resource-timing URLs (no bodies), CSS custom properties via CSSOM, and the public `/docs/mcp` page text. Dynamic routes were visited with the placeholder id `not-a-real-id`, which the client never sends to the API. No data was created, edited, paid for or deleted. |
| Not done | No LTD code executed; no API calls replayed; no access beyond the user's own page loads. The 3 CSS files were not downloaded (tokens read from the live page instead). |

---

## 1. Executive summary

- **Stack:** Next.js **15.5.15** App Router with React **19.2.0-canary-0bdb9206-20250818**, Tailwind + **shadcn/ui** (Radix primitives), **zustand** (client state), **TanStack Query** (server state), **axios**, Chart.js, TanStack Table, react-virtualized, React Flow, cmdk, framer-motion, jsPDF + html2canvas, SheetJS, react-image-crop, dotlottie. **[static]**
- **API:** a single REST API at `https://api.eshway.com/v1`, **254 distinct method+path templates across 30 domains** (Appendix B). Every request carries `X-Organization-ID` from the selected organisation. **[static]**
- **Auth is cookie-based, not token-in-localStorage.** The axios client sends `withCredentials: true`; `setAuth` explicitly sets `accessToken`/`refreshToken` to `null`, and the persisted `auth-storage` keeps only the user profile. A 401 triggers one shared `POST /auth/refresh-token` that queues concurrent requests and retries each once; if refresh fails, auth is cleared and the user is sent to `/login`. **[static]** LTD's own docs show the session cookie is named `access_token`. **[runtime]**
- **46 routes** (37 static, 9 dynamic). The project workspace has **9 views**: Dashboard, List, Board, Timeline, Roots, Workload, Calendar, Files, Nexus. **[static]+[runtime]**
- **AI features are server-side only.** There is no LLM SDK or provider host anywhere in the browser code. Features: AI project auto-setup (`/gemini_integration/auto-setup`), AI task and custom-field suggestions, "Ask Your Project" chat, AI Standups, Nexus "project signal map", and scheduled analytics reports. **[static]**
- **Plans:** Free ₹0, Starter ₹749 and Professional ₹1399 **per user per month** (landing page), seat-based. Nexus, AI Standups and My Assistant are Professional-only. Payments go through **Razorpay** subscriptions with server-side signature verification. **[static]+[runtime]**
- **MCP server for AI assistants** at `https://api.eshway.com/mcp/`, using personal access tokens (`ltdpat_…`, scopes `mcp:read` / `mcp:analytics` / `mcp:write`). It has **12 tools**, with a two-phase, server-enforced confirm protocol for every write. **[runtime: public docs]+[static: settings page]**
- **RBAC** roles: `super_admin`, `admin`, `manager`, `member`, `viewer` (plus an "owner" label on the team page). Permissions: `create`, `read`, `update`, `delete`, `invite`, `manage_roles`, `manage_organization`. **[static: 2283#56771]**
- **Task "perspective"** uses the four Balanced-Scorecard perspectives: **financial, customer, internal, learning**. **[static]**
- **No realtime push:** no WebSocket, EventSource or socket.io in the corpus. Freshness comes from React Query stale times (0–5 min), 5-minute refetch intervals in places, and job-status polling for AI jobs. **[static]**
- **Telemetry:** PostHog through a first-party `/ingest` proxy (surveys, web vitals, exception and dead-click autocapture), Sentry through a `/monitoring` tunnel (Session Replay code included), and Google Analytics. Razorpay's checkout and risk-detection scripts load on dashboard pages. **[static]+[runtime]**
- **Corrections to the earlier report:** it claimed Recharts, Tiptap, uppercase role names with numeric weights, an `analytics-store`, localStorage JWTs, an `internal | client` perspective, and `/tasks`-rooted task CRUD. The code contradicts all of these (§9).

---

## 2. Tech stack

| Library / service | Purpose in LTD | Version | Evidence | Confidence |
|---|---|---|---|---|
| Next.js (App Router) | Framework, routing, RSC | 15.5.15 | `"15.5.15"` in `834-…`, `main-app-…`; `window.next.version` | [static]+[runtime] |
| React | UI | 19.2.0-canary-0bdb9206-20250818 | version string in `4bd1b696-…`, `834-…` | [static] |
| Tailwind CSS + shadcn/ui | Styling, component system | — | shadcn HSL tokens (§7); 2,592 CSS rules | [runtime] |
| Radix UI | Dialog/Dropdown/Select/Tooltip primitives | — | `radix-` / `data-radix` in 63 files | [static] |
| zustand (+ persist) | Client state | — | `zustand`, persisted stores (§4.2) | [static] |
| TanStack Query | Server state, caching | — | `QueryClient`, `queryCache` in `1535-…`, `9451-…` | [static] |
| TanStack Table | List view table engine | — | `getCoreRowModel` in `6021.…`, `8642.…` | [static] |
| react-virtualized | Large-list virtualisation | — | `ReactVirtualized` in `9155.…` | [static] |
| axios | HTTP client | — | `AxiosError` etc. in 22 files; client `270#20270` | [static] |
| Chart.js | Analytics charts | — | `chartjs` in `603-…`, `ca377847-…` | [static] |
| React Flow (@xyflow) | Graph canvas (Roots view) | — | "React Flow", Mini Map, Fit View in `6344.…`, `1a258343.…` | [static] |
| react-beautiful-dnd family | Drag and drop | — | `rfd-` attributes in `602dbae6-…` (only DnD library found) | [static] |
| cmdk | Command palette | — | `cmdk-` in 6 files | [static] |
| framer-motion | Motion | — | `motionValue` in `519-…`; variants `fadeIn`, `fadeInUp`, `scaleIn`, `slideInLeft`, `pageTransition` | [static] |
| date-fns | Dates | — | `formatDistance` and `MMM dd, yyyy` formats | [static] |
| zod | Validation | — | `ZodError` in `7692-…` | [static] |
| jsPDF + html2canvas (+ canvg, UPNG-style decoder) | PDF export of analytics | — | `jsPDF` in `164f4fb6.…`; html2canvas in `ad2866b8.…` | [static] |
| SheetJS (xlsx) | Spreadsheet import/export | — | `xlsx` in 4 files | [static] |
| remark | Markdown rendering (chat) | — | `remark` in `7554-…` | [static] |
| DOMPurify | HTML sanitising (bundled with jsPDF) | — | `DOMPurify` in `164f4fb6.…` | [static] |
| react-image-crop | Avatar cropping | — | `ReactCrop` in `8949-…`; `--rc-*` CSS vars | [static]+[runtime] |
| dotlottie-web | Loading animations | 0.50.2 (wasm from jsDelivr) | `dotlottie` in `f58c171e-…`; `/lottie/Palmloading.lottie` | [static]+[runtime] |
| lucide | Icons | — | `lucide` in `519-…`, `9658-…` | [static] |
| posthog-js | Product analytics, surveys | — | `9da6db1e-…#26614`; `/ingest` proxy | [static]+[runtime] |
| @sentry/nextjs | Errors, tracing, Session Replay | — | `/monitoring` tunnel; replay strings in `52774a7f-…` | [static]+[runtime] |
| Razorpay Checkout | Payments | v1 | `Razorpay` in 6 files; `checkout.razorpay.com/v1/checkout.js` | [static]+[runtime] |
| Google Identity Services | Google sign-in | — | `accounts.google.com/gsi/client` loaded | [runtime] |
| Google Analytics (gtag) | Analytics | — | `GA_MEASUREMENT_ID` in config `27750` (value redacted) | [static]+[runtime] |

**Not found anywhere in the corpus:** Recharts, Tiptap/ProseMirror, dnd-kit, dayjs, react-window, sonner, react-hot-toast, socket.io, WebSocket, EventSource, and any LLM SDK or provider endpoint. (Case-insensitive search over all 158 files.)

---

## 3. Architecture

### 3.1 Rendering model

- **App Router, hybrid.** Public pages (landing, legal, `/docs/mcp`) are server-rendered: `/docs/mcp` content arrives in the RSC payload, not in any JS chunk. The `/dashboard` area is a client application. `app/dashboard/layout` (2.3 KB) calls `GET /onboarding/status` on mount, and `app/dashboard/template` re-renders per navigation. **[static]**
- **Configuration is compiled in:** module `270#27750` exports `{API_URL: "https://api.eshway.com/v1", NODE_ENV: "production", IS_PRODUCTION: true, GA_MEASUREMENT_ID: <redacted>, POSTHOG_PROJECT_TOKEN: <redacted>}`. **[static]**
- **Code-splitting:** each route has its own page chunk. Heavy views are lazy chunks imported by `app/dashboard/page` (27 dynamic imports), and PDF/graph/chart libraries load only when used. **[static]**
- **Route-level access:** the server redirects anonymous visitors to `/login?redirect=…` for protected routes. **[runtime]** For a signed-in Free-plan non-admin account, `/onboarding` and `/superadmin` redirect to `/dashboard` after their code loads. **[runtime]** The superadmin layout calls `GET /superadmin/stats` and `GET /users/me`. **[static]**

### 3.2 Routes (Sentry route manifest + page chunks)

See **Appendix A** for the full route → chunk map. Summary:

- **Public:** `/`, `/login`, `/signup`, `/verify`, `/verify-email`, `/forgot-password`, `/reset-password`, `/accept-invitation`, `/forms/:slug`, `/docs/mcp`, `/support`, `/contact`, `/privacypolicy`, `/termsconditions`, `/refund`, `/profile/:username`. **[runtime]**
- **App:** `/dashboard` (+ `chat`, `external-apps` [+ `github`, `slack`, `migrate`], `goals`, `groups`, `my-assistant`, `my-tasks`, `projects` [+ `new`, `:id`, `:id/custom-fields`, `:id/forms` [+ `new`, `:formId`], `:id/standup`], `standups`, `team` [+ `:id/performance`]), `/settings` (+ `calendar/callback`), `/subscription` (+ `my-subscription`), `/profile`, `/organization`, `/onboarding`, `/superadmin`, `/github/installed`. **[runtime]**
- `/contact`, `/privacypolicy`, `/termsconditions` and `/refund` have **no client page chunk**: they are server-only pages. **[runtime]**

### 3.3 App shell and navigation

- **Sidebar** (shadcn "sidebar" block, `641-…#90641`): an organisation switcher with "All Organizations"; **Personal** (Home, My Tasks, Goals, My Assistant); **Company** (Teams, Projects with an expandable project list and "All Projects", Groups, Chat, Subscription, External Apps, Support); an "Upgrade to Pro" entry; subscription-state handling for `trial`, `past_due`, `canceled`, `expired`; and a rotating motivational card. **[static]+[runtime]**
  - The module still contains the **shadcn template's demo data** ("Acme Inc", "Evil Corp.", "Acme Corp.", `/avatars/shadcn.jpg`, `m@example.com`). These are unused leftovers from the block template. **[static]**
- **Motivational card:** a time-of-day message pool (184 candidate strings) lives in constants module `270#54354`, e.g. "Afternoon slump? Our AI just assigned you a 'caffeine boost' task…". **[static]+[runtime]**
- **Command palette** (cmdk, opened with Ctrl K / ⌘K; definitions in `app/layout#56138`). **[static]+[runtime]** Navigation commands and their shortcuts:

  | Command | Shortcut | Command | Shortcut |
  |---|---|---|---|
  | Go to Dashboard | ⇧D | Go to My Tasks | ⌥M |
  | Go to List | ⇧L | Go to Teams | ⇧⌥T |
  | Go to Board | ⇧B | Go to Groups | ⇧G |
  | Go to Timeline | ⇧T | Go to Goals | ⌥G |
  | Go to Roots | ⇧R | Go to Chat | ⌥C |
  | Go to Workload | ⇧W | Go to External Apps | ⌥E |
  | Go to Calendar | ⇧C | Go to Upgrade to Pro | — |
  | Go to Files | ⇧F | Go to today | — |
  | Go to Nexus | ⇧N | | |

  "Shift + ?" opens the shortcut help. **[static]**
- **User-remappable shortcuts:** custom bindings are stored in `localStorage["userShortcuts"]`, with scope toggles in `enabledShortcutScopes`, a "Keyboard Shortcuts" settings tab, and a first-run hint flag `keyboardShortcutHintSeen`. **[static]**
- **Theme:** this account renders `<html class="dark">`. Users can change the accent via `localStorage["primary-color"]` (Settings → Appearance). **[static]+[runtime]**

### 3.4 Plan gating

- **Professional plan:** Nexus ("Premium Feature — Professional plan subscribers"), AI Standups ("Professional plan required for AI Standup") and My Assistant ("Professional plan only.") check the plan in the client and render upsells. **[static]+[runtime]**
- **Role gates:** Analytics configuration shows "Analytics are restricted to admins". Nexus generation shows "Only organization admins or managers can generate insights". **[static]** Server enforcement is not observable from the client. **[inferred]**

---

## 4. Client data layer

### 4.1 HTTP client (`270#20270`, 1.6 KB) [static]

- `axios.create({ baseURL: API_URL, headers: { "Content-Type": "application/json" }, withCredentials: true })`.
- **Request interceptor:** adds `X-Organization-ID` from `organization-store.selectedOrgId`, and merges extra headers from a helper in `main-app#10820` (the same module that holds the PostHog `/ingest` setup).
- **Response interceptor:**
  - Errors on the login call pass straight through.
  - If the refresh call itself fails, auth is cleared and the user is redirected to `/login`.
  - A 401 on public auth pages (`/login`, `/signup`, `/verify`, `/verify-email`, `/forgot-password`, `/reset-password`, `/accept-invitation`) clears auth without redirecting.
  - Any other 401 triggers a **single-flight refresh**: a flag plus a queue of pending promises, one retry per request (`_retry`), and `POST /auth/refresh-token` with `{}` and cookies. The response's `user` is written via `setAuth`. On failure the queue is rejected, auth cleared, and the user redirected to `/login`.

### 4.2 Client state [static]

| Store / key | Kind | Contents |
|---|---|---|
| `auth-storage` (`270#48632`) | zustand `persist` | `user`, `isAuthenticated`, `pendingEmail`, `hasHydrated`, `loading`, `error`; `accessToken`/`refreshToken` exist in the shape but are **always set to `null`**; `partialize` persists the user/session flags. Actions: `setAuth`, `updateAuthUser`, `setSubscription`, `clearAuth`, `setPendingEmail`. |
| `organization-store` (`270#22436`) | zustand | `selectedOrgId` (feeds `X-Organization-ID`) and the organisation list |
| `dashboard-store` (`270#53550`) | zustand `persist` | active project/view state for the workspace |
| `ui-store` (`641-…#89868` et al.) | zustand `persist` | UI preferences |
| `privacy-settings` (`3572-…#85991`) | key | profile privacy settings cache |
| `localStorage`: `userShortcuts`, `enabledShortcutScopes`, `keyboardShortcutHintSeen`, `primary-color`, `calendar_connect_callback` | raw keys | shortcuts, accent colour, Google Calendar connect round-trip |
| `ltd_ref` | key (signup page) | referral code, validated against `^[a-z0-9-]{3,32}$` |

### 4.3 Server state, polling and freshness [static]

- **TanStack Query `staleTime` values:** 0 (team, onboarding), 30 s (analytics, project page), 60 s (projects, dashboard template), 120 s (My Tasks), and 300 s (list, task detail, sidebar). `refetchInterval` of 5 minutes appears in shared modules.
- AI jobs (Nexus, Standups) poll `…/job-status/{id}` and `…/rate-limit/{id}`.
- The My Tasks fetch adds a request header `Cache-Control: max-age=120`.
- **No push channel exists in the corpus.**

### 4.4 Telemetry and error reporting

- **PostHog** (`9da6db1e-…#26614`), with requests proxied through same-origin `/ingest/*`. Remote config, surveys (`lastSeenSurveyDate`), web-vitals, exception and dead-click autocapture scripts all load from `/ingest/static/…`. **[static]+[runtime]**
- **Sentry** (`@sentry/nextjs`), tunnelled through same-origin `/monitoring`. Session Replay code (`.sentry-mask`, `.sentry-block`) is bundled; whether replay is sampled on is decided by server/DSN config and was not observed. **[static]+[runtime]**
- **Google Analytics** (gtag) **[runtime]** and **Razorpay** `lumberjack` logging beacon **[runtime]**.

---

## 5. API surface (summary — full list in Appendix B)

**Conventions [static]:**
- REST under `/v1`, JSON bodies, multipart for uploads and imports, paging via `skip`/`limit`.
- Organisation scoping comes both from the `X-Organization-ID` header and from path segments. In `/projects/{x}/projects/...` the first id is the **organisation id**: create-project passes `organization_id` in that slot. **[static]**
- File upload is two-step (`…/upload`, then `…/upload/finalize`), consistent with presigned direct-to-storage uploads. **[inferred]**

| Domain | Templates | What it covers |
|---|---|---|
| `auth` | 11 | login (+ OTP 2FA challenge `challenge_token`/`otp`), Google sign-in (`id_token`, `referral_code`), register, verify email (link `token` or `email`+`code`), resend, forgot/reset (token validation), refresh, logout |
| `onboarding`, `organizations`, `invitations` | 3 / 7 / 2 | ensure/create organisation (name, address, industry, plan; logo multipart), my organisations, member counts, import members, verify/accept invitation (`token`, `password`, `full_name`, `skills`) |
| `projects` | 44 | projects CRUD and bulk delete (incl. "delete all matching" with `expected_count`/`expected_token` safety), portfolio paging/filtering, cockpit, members, tasks CRUD, status change by `status_slug`, archive, CSV/XLSX import, dependencies/antecedents, GitHub branch link/reconnect/disconnect, AI suggest, custom fields (incl. dependent-field import and conditional links), forms, calendar reminders |
| `tasks`, `comments`, `task-file`, `project-file` | 4 / 2 / 5 / 6 | comments (`text`), status, reminders, attachments (two-step upload, download, delete), project file library and storage used |
| `task-statuses` | 8 | global/project/org statuses, enable custom statuses, create/rename/recolour/reorder, delete with `replacement_status_id` |
| `analytics`, `list-view` | 13 / 5 | dashboard configs, batch widget data, drill-down, emailed reports (+ preview), report schedules (+ run-now); saved list-view profiles (+ set-default) |
| `nexus`, `standups`, `chat`, `gemini_integration` | 4 / 7 / 5 / 1 | AI jobs (generate, job-status, rate-limit), standup history, "Ask Your Project" conversations, AI project auto-setup |
| `team`, `group`, `goals`, `users` | 13 / 5 / 4 / 21 | members/roles/invites/invite links/project access; groups; goals; profiles, education, certificates, avatar, privacy, public profile, performance |
| `subscriptions` | 9 | plans, subscribe (`plan_id`, `plan_duration`, `members_cap`), Razorpay payment verification, seat upgrade (+ verification), cancel, my subscription(s) |
| `integrations` (GitHub, Slack, migration) | 20 | GitHub App install/repos/branches/project connect/preferences; Slack member mapping and project channel connect; migration providers/validate/fetch-structure/start/jobs |
| `calendar`, `settings`, `pats`, `support`, `superadmin` | 6 / 2 / 3 / 2 / 37 | Google Calendar OAuth and sync; auto-sync; personal access tokens; support tickets; superadmin console |

---

## 6. Features in depth

### 6.1 Project workspace and the 9 views

`app/dashboard/page` (101 KB) is the workspace shell. Its view ids are `dashboard`, `list`, `board`, `timeline`, `roots`, `workload`, `calendar`, `files`, `nexus`. The project route `app/dashboard/projects/[id]/page` additionally references `forms` and custom-status management. **[static]**

| View | Chunk | What the code shows |
|---|---|---|
| **Dashboard** | `1295.…#51295` | "Project Progress", completion path, completed/remaining tasks, "Recent movement". **Health label computed in the browser:** progress > 70% → **Good**, > 30% → **Watch**, otherwise **At risk**; "No tasks yet" when empty. [static] |
| **Analytics** (in Dashboard) | `5628.…#85628` (140 KB) | Presets "Starter (status, priority, workload)" and "Post Dep Tracker (issues, ageing, reopens)", plus custom charts: **pie, doughnut, bar, line, area, radar, scatter, KPI, number, table** (Chart.js). Also: "View analytics as of date", PDF export (jsPDF + html2canvas), email a report (with preview), and **scheduled reports** (time, timezone, message, include task lists). Admin-only. [static] |
| **List** | `6021.…#56021` + `9155.…` | TanStack Table with react-virtualized, draggable columns, group expand/collapse, rows per page, filters, and **saved list profiles** (`/list-view/{org}/projects/{p}/profiles`, set-default). [static] |
| **Board** | page code + `602dbae6-…` | Columns follow the project's (custom) statuses; moves call `PUT /projects/{p}/tasks/{t}/status` with `status_slug`. The drag-and-drop library is the react-beautiful-dnd-family one in `602dbae6-…` (the only DnD library present). [static]; library-to-view mapping [inferred] |
| **Timeline** | `2845.…#62845` | Year navigation ("Center on current year"), custom timeline start/end dates, "Dependent on previous task" markers, and dependencies from `/projects/{p}/tasks/{t}/dependencies`. [static] |
| **Roots** | `6344.…`, `1a258343.…`, `9861.…` | React Flow canvas (Mini Map, Fit View, Zoom, Control Panel), filters (All Priorities/Statuses/Perspectives, show archived/completed), and the legend "Colored border indicates task status" / "Red color date indicates overdue". It edits task relationships ("Updating task relationship…"). [static]; chunk-to-view mapping [inferred] |
| **Workload** | `2435.…#82435` | A per-member load number is classified as **≥ 4 → "Over capacity"**, **≥ 2 → "At pace"**, else **"Available"**, plus "Overloaded" and "Unassigned" counters, next-due item, and "At limit". [static]; the load metric is presumably active task count [inferred] |
| **Calendar** | not pinned to a chunk | Google Calendar connect/status/disconnect, per-task sync and removal, and custom calendar reminders are present. The calendar grid's own chunk was not identified. [static] |
| **Files** | `146.…#90146` | Project file library: drag-drop upload (two-step), type filters, download, delete, permission message "You do not have permission to upload files.", and storage-used meter (`/project-file/storage-used`). [static] |
| **Nexus** | `7650.…#25269` | AI "project signal map", one generation per day ("Daily Limit Reached"), queued/processing/completed/failed job states, and only admins or managers can generate. Sections: **Milestones, Issues, Inactivity, Trends, Actions** (response fields `notable_issues`, `actionable_insights`). Severity: Needs attention / Watch closely / Informational signal / Stable signal. Risk filter: Low/Medium/High. **Professional plan.** [static]+[runtime] |

### 6.2 Task model [static]

- **Core fields:** `title`, `description`, `status` (per-project custom statuses; changed by `status_slug`), and `priority` (High/Medium/Low; "Urgent" appears only in analytics and migration mappings).
- **Perspective** is a Balanced-Scorecard value: **`financial` / `customer` / `internal` / `learning`**.
- **Dates and people:** `start_date`, `end_date`/`due_date`, `assignees`, `assigned_groups`, `custom_fields`.
- **GitHub and lifecycle:** `create_github_branch` (custom branch name, base branch), archive (`task_ids`, `archive_status`), and a reopen counter (project setting `reopen_counter_enabled`).
- **Dependencies:** `antecedent_task_id`, `dependent_task_id`, with `type` ∈ `finishes_before_starts`, `starts_before_starts`, `finishes_before_finishes`, `starts_before_finishes` (constants `270#54354`).
- **Extras:** reminders (`/tasks/{t}/schedule-reminder`, custom calendar reminder), attachments, comments (`text`; edit and delete), and bulk import (CSV/XLSX multipart).
- **AI assist:** `POST /projects/{p}/tasks/ai-suggest` (`title`, `description`) and `…/field-suggest` (`custom_fields`).
- Task create/edit dialogs live in `3700.…` and `7329.…`, including the GitHub integration options.

### 6.3 Statuses, custom fields, forms [static]

- **Custom statuses** (`1763.…`, `5077.…`): opt-in per project ("Yes, Enable Custom Statuses"). Names are unique and at most 100 characters, double-click renames, each status has a colour, statuses are reordered with `status_orders`, and deleting one requires a replacement status.
- **Custom fields** (`64-…#23625`, `/projects/:id/custom-fields`): CRUD with archived-field toggle, **dependent (cascading) fields** via CSV "dependency import" with preview, "conditional links", and a source-task lookup. The importer recognises hierarchical column names such as country/state/city/region/site, organisation/company/customer/client, and workflow/process/use case.
- **Forms** (`2478-…#27341`): templates such as IT Request and job application, or "Start from scratch". Public `/forms/:slug` collects title, details, due date, assignees, optional email and dependent fields, then calls `POST /forms/{slug}/submit`.

### 6.4 AI features [static unless noted]

- **AI project setup:** `POST /gemini_integration/auto-setup` sends the project description, team members (id, name, email, role, skills) and a date range. The endpoint name suggests Google Gemini on the backend. **[inferred]**
- **Ask Your Project** (`/dashboard/chat`): an AI chat over project tasks, blockers, goals and activity. Conversations are persisted, renamable and deletable (`/chat/{org}/conversations`), with markdown answers (remark).
- **AI Standups** (`/dashboard/standups`, `/projects/:id/standup`): two modes ("Reviews yesterday · Plans today · 24h activity window" and "Reviews today · Plans tomorrow · 12h activity window"), optional user context added to the prompt, a 24 h cooldown, and job polling. **Professional only.**
- **My Assistant** (`/dashboard/my-assistant`, 5 KB): a hub of "Personal AI tools", currently AI Standup, gated to Professional.
- **Nexus** (§6.1) and **emailed/scheduled analytics reports**.

### 6.5 Organisation, team, roles, goals, groups [static]

- **Roles and permissions:** enums in `2283-…#56771`: roles `super_admin`, `admin`, `manager`, `member`, `viewer`; permissions `create`, `read`, `update`, `delete`, `invite`, `manage_roles`, `manage_organization`. The same module also defines a gender enum, used by profiles.
- **Team page:** invite by email (with seat limits), pending invitations, regenerate invite link, change role, remove member, per-member **project access** (grant/update/revoke, plus a summary), CSV import of members, and **buy more seats** through Razorpay (`additional_seats`).
- **Goals:** "Execution goals" with title, description, target and current value, and deadline. Progress mood is On track / Review soon / At risk.
- **Groups:** create (name, members, project), rename, edit members, delete.
- **Member performance** (`/dashboard/team/:id/performance`, `GET /users/{id}/performance?organization_id&start_date&end_date`): a **customisable widget dashboard**. Widgets: Completion Rate, Deadline Adherence, **Focus Score** (priority-weighted completion), Overdue Rate, Average Lead Time (created → completed), Average Cycle Time (started → completed), Open Work (WIP), Blocked (dependencies), Work Aging (15 d+), Comments Written, Weekly Throughput (8 weeks), completion trend, priority distribution, per-project performance, and early/on-time/late split. It also shows "Key Strengths", "Growth Opportunities" and recommendations.

### 6.6 Profile and settings [static]

- **Profile:** name and avatar (with cropping), resend verification, education and certificates (multipart, reorder, download), privacy settings (`/users/me/privacy`), and a public profile at `/users/public/{username}`.
- **Settings tabs:** General, Appearance (accent colour), Keyboard Shortcuts, Integrations (Google Calendar **auto-sync** toggle), and **API tokens** (§6.8).

### 6.7 Integrations [static]

- **GitHub App:**
  - Connect: install flow, then the `/github/installed` callback (`installation_id`, `state`, `setup_action`). List installation repos and project branches; connect a repo to a project; set the `auto_create_branches` preference; disconnect a project or the whole organisation.
  - Per task: link, reconnect or disconnect a branch, and optionally delete the branch when the task is deleted.
- **Slack:** map members to Slack ids, connect or disconnect a project channel, and a per-project `slack_ai_enabled` setting.
- **Migration** from other tools: the provider list comes from the server, then validate credentials → fetch workspace structure → start an import job (selected projects, field mapping, options, target or new organisation) → poll job status.
- **Google Calendar:** OAuth (`/calendar/auth-url`, then `/calendar/oauth2callback?code=…`), status, disconnect, and per-task sync and removal.

### 6.8 MCP server and personal access tokens

- **Server:** `https://api.eshway.com/mcp/`, streamable HTTP. Auth is the header `Authorization: Bearer ltdpat_…`. Docs last updated 13 Aug 2026. **[runtime: public `/docs/mcp`]**
- **Tokens** (Settings → API tokens; `/pats`): shown once and stored only as a hash. Expiry is 30/60/90/180/365 days with no non-expiring option. Each token is pinned to one organisation and can never exceed the creator's own permissions. **[static]+[runtime]**
- **Scopes:** `mcp:read`, `mcp:analytics` (kept separate on purpose), `mcp:write`.
- **Client setup:** the settings page ships snippets for Cursor (`~/.cursor/mcp.json`) and Claude Code (`claude mcp add --transport http ltd …/mcp/ --scope user`). The docs page covers about 20 clients. **[static]+[runtime]**
- **Tools (12):**
  - **Read:** `ltd_list_projects`, `ltd_describe_project`, `ltd_search_tasks`, `ltd_get_task`, `ltd_my_tasks`, `ltd_get_comments`, `ltd_project_pulse`.
  - **Analytics:** `ltd_analytics_query` (metrics count/sum/avg/min/max/percentage; group by status, priority, assignee, date or custom field; filters; presets such as `avg_cycle_time_completed`), `ltd_drilldown_tasks`.
  - **Write:** `ltd_create_task`, `ltd_update_task`, `ltd_add_comment`.
  - The page text says "Nine tools", but its tables list twelve. **[runtime]**
- **Write safety:** every write takes two calls. The first is a preview that returns a `confirm_token` (5 minutes, single use). The confirm is refused if the token, tool or arguments changed, or if the task was edited in between. Writes can never delete, archive, or change settings, statuses or field definitions. **[runtime]**

### 6.9 Billing and plans

- **Landing page:** Free **₹0**, Starter **₹749**, Professional **₹1399** per user per month ("Scale with Professional", "Enterprise analytics for leadership visibility"). **[static: `app/page#39444`]**
- **Checkout flow:** `GET /subscriptions/plans` → `POST /subscriptions/{org}/subscribe {plan_id, plan_duration, members_cap}` → Razorpay checkout → `POST …/verify-payment {razorpay_subscription_id, razorpay_payment_id, razorpay_signature}`. **[static]**
- **Other actions:** seat upgrades (`upgrade-seat`, then `verify-seat-upgrade-payment` with an order id) and cancel (`subscription_id`). Statuses handled: `trial`, `past_due`, `canceled`, `expired`. Onboarding includes plan and seat selection ("Most Popular", recommended seats). **[static]**

### 6.10 Superadmin console [static]

`/superadmin` (88 KB) covers:
- platform stats and activity feed;
- full CRUD **plus bulk delete** for organisations, users, projects and tasks (with "ids" listing endpoints for select-all);
- bulk email to users;
- a **referral programme**: creators, codes and a report under `/superadmin/referrals`.

### 6.11 Auth and onboarding [static]

- **Login:** email + password, with optional **OTP second factor** (`challenge_token` + `otp`); Google sign-in via GIS `id_token`; referral codes on sign-up.
- **Email verification:** by link token (`/verify-email`) or by email + code (`/verify`).
- **Other:** resend verification, forgot/reset with token validation, invitation verify/accept (sets password, full name and skills), logout.
- **Onboarding:** org details (name, address, industry), plan and seats with Razorpay, invite teammates within seat limits, then "Platform Tutorial". The default workspace name is "Personal Working Space".

### 6.12 My Tasks and support [static]

- **My Tasks:** cross-project list with **Pending / Overdue / Due Today / Upcoming** tabs, project/status/priority filters, search, pagination and refresh.
- **Support:** `/support/tickets` (list and create).

---

## 7. Design system

**Tokens** (read from the live CSS; shadcn convention `hsl(var(--token))`) **[runtime]**:

| Token | Light | Dark |
|---|---|---|
| `--primary` | `287 96% 71%` (= **#d86dfc** orchid) | same |
| `--background` | `0 0% 100%` | `240 6% 12%` |
| `--card` / `--popover` | `0 0% 100%` | `240 5% 16%` |
| `--foreground` | `0 0% 3.9%` | `220 13% 95%` |
| `--muted` / `--muted-foreground` | `0 0% 96.1%` / `0 0% 45.1%` | `240 4% 18%` / `220 13% 65%` |
| `--secondary` | `287 96% 95%` | `240 4% 22%` |
| `--border` / `--input` | `0 0% 89.8%` | `240 4% 22%` |
| `--destructive` | `0 84.2% 60.2%` | `0 62.8% 40.6%` |
| `--ring` | `0 0% 3.9%` | `287 96% 71%` |
| `--sidebar-*` | dedicated sidebar palette | orchid primary and ring |
| `--chart-1…5` | `12 76% 61%`, `173 58% 39%`, `197 37% 24%`, `43 74% 66%`, `27 87% 67%` | same |
| `--radius` | `0.5rem` | — |

- **Brand accents:** literal `#d86dfc` in Tailwind arbitrary classes, and a gradient via `#6B46C1` in dark mode. **[runtime]**
- **Components:** shadcn/ui on Radix (dialogs, dropdowns, selects, tooltips, popovers, tabs, scroll areas), the shadcn sidebar block, cmdk palette, lucide icons, and framer-motion variants `fadeIn`, `fadeInUp`, `scaleIn`, `slideInLeft`, `pageTransition`. **[static]**
- **Fonts:** self-hosted via `next/font` (14 `.ttf`/`.woff` files). Computed body family is `Arial, Helvetica, sans-serif`. **[runtime]**
- **Accessibility signals:** aria labels on search and filter controls (e.g. "Search Nexus insights", "Filter Nexus insights by signal"), `sr-only` labels, and keyboard hints in dialogs ("Enter to send • Shift+Enter for newline"). **[static]** Not audited for WCAG conformance.

---

## 8. Third parties and data leaving the browser

| Destination | What | Observed |
|---|---|---|
| `api.eshway.com/v1` | All application data (session cookie + `X-Organization-ID`) | [runtime] |
| `ltd.eshway.com/ingest/*` → PostHog | Product events, surveys, web vitals, exception and dead-click capture | [runtime] |
| `ltd.eshway.com/monitoring` → Sentry | Errors and traces (Session Replay code bundled) | [static]+[runtime] |
| `analytics.google.com`, `googletagmanager.com` | Google Analytics | [runtime] |
| `checkout.razorpay.com`, `cdn.razorpay.com`, `api.razorpay.com`, `lumberjack.razorpay.com` | Checkout script, risk-detection bundle, checkout iframe, logging beacon (loaded on dashboard pages, not only at checkout) | [runtime] |
| `accounts.google.com/gsi` | Google sign-in | [runtime] |
| `cdn.jsdelivr.net` | dotlottie-web wasm | [runtime] |
| `lh3.googleusercontent.com` | Google avatar images | [runtime] |

---

## 9. Corrections to the earlier (Antigravity) report

| Earlier claim | Verdict | What the code shows |
|---|---|---|
| "Next.js 14/15" | Refined | 15.5.15, React 19.2.0-canary |
| Recharts **and** Chart.js | **Refuted (Recharts)** | Chart.js only; no Recharts anywhere |
| Tiptap / ProseMirror rich text | **Refuted** | Not present in any chunk; chat uses remark (markdown) |
| `auth-storage` holds `accessToken`/`refreshToken` (JWT in localStorage) | **Refuted** | Fields exist but are always `null`; the session is a cookie (`withCredentials`, `access_token` cookie); refresh returns `{user}` |
| Roles `SUPER_ADMIN`…`VIEWER` with weights 100/80/60/40/20 | **Partly correct** | Roles and permissions exist as lowercase enum values; no numeric weights found |
| Stores incl. `analytics-store` | **Partly correct** | `auth-storage`, `organization-store`, `dashboard-store` confirmed; `analytics-store` not found; `ui-store` and `privacy-settings` exist |
| Perspective `"internal" \| "client"` | **Refuted** | `financial`, `customer`, `internal`, `learning` |
| `POST /tasks`, `PUT /tasks/{id}`, `DELETE /tasks/{id}` | **Refuted** | `POST /projects/{p}/tasks`, `PUT`/`DELETE /projects/{p}/tasks/{t}`; `/tasks/{t}` is used only for comments, status and reminders |
| Calendar "Month / Workweek / Day" modes | **Unverified** | No such strings found; calendar grid chunk not identified |
| 10 workspace views incl. "Task Forms View" | **Partly correct** | 9 views in the switcher; Forms is a separate route and project tab |
| Roots node colours `#d86dfc` client / `#3b82f6` internal | **Unverified** | Roots legend uses border colour = status, red date = overdue |
| Axios 401 refresh queue; `X-Organization-ID` | **Confirmed** | `270#20270` |
| Route manifest, shortcuts ⇧D…⇧N, ⌥M, ⇧⌥T, ⇧G, ⌥G, ⌥C, ⌥E | **Confirmed** | `app/layout#56138`; runtime manifest |
| Health "Good / Watch / At risk"; workload labels; Nexus categories and severity labels | **Confirmed** (now with thresholds) | §6.1 |
| 4 dependency types | **Confirmed** | `270#54354` |
| MCP endpoint, 12 tools, `ltdpat_`, confirm token | **Confirmed** | live `/docs/mcp` (the earlier report did not note the scopes or the "nine tools" wording) |
| react-virtualized, jsPDF/html2canvas, Razorpay, PostHog via `/ingest`, framer-motion variant names | **Confirmed** | §2 |

---

## 10. Unknowns and limits

- **Server behaviour is invisible.** Authorisation enforcement, plan enforcement, AI prompts and models, rate limits and response schemas beyond fields the UI reads cannot be established from the client.
- **The account is an empty Free-plan workspace.** Populated views, Professional-only screens (beyond their upsell), admin-only analytics and the superadmin console were analysed statically, not exercised.
- **Chunk-to-view mapping** for Board's DnD library, Roots (`9861`), and the Calendar grid is inferred or unidentified.
- **REA coverage is partial** for 13 large chunks (graph relationships only), and its request extractor does not cover axios. The API inventory relies on the verified call-site extract (279/279).
- **Session Replay and PostHog session recording** code is present; whether either is enabled in production depends on remote configuration not captured.
- **CSS files were not downloaded.** Tokens come from the live CSSOM of a dark-theme session.

---

## Appendix A — Route → page chunk map [runtime + static]

| Route | Page / layout chunk(s) |
|---|---|
| `/` | `app/page-1b6208149e385f4b.js` (landing; pricing) |
| `/login` | `app/login/page-782a1c4ece9debc4.js` |
| `/signup` | `app/signup/page-b660dfd121134f49.js` |
| `/verify` | `app/verify/page-7b7a55b6b5881518.js` |
| `/verify-email` | `app/verify-email/page-3a17202d0e5d402f.js` |
| `/forgot-password` | `app/forgot-password/page-5c63f1402a192c01.js` |
| `/reset-password` | `app/reset-password/page-fdb9c4cdd02246d4.js` |
| `/accept-invitation` | `app/accept-invitation/page-b44ee4fa9fc5af4f.js` |
| `/onboarding` | `app/onboarding/page-1a1b9b7f52884250.js` |
| `/organization` | `app/organization/page-5ec0f0da211c281d.js` |
| `/dashboard` | `app/dashboard/layout-3c5f17ea3aa12a50.js`, `template-514f77b0e7c3d697.js`, `page-b37c2f9a9a38c5cd.js` |
| `/dashboard/my-tasks` | `app/dashboard/my-tasks/page-a33c90725581e763.js` |
| `/dashboard/goals` | `app/dashboard/goals/page-b01e9408a6a9d138.js` |
| `/dashboard/my-assistant` | `app/dashboard/my-assistant/page-fcd5c260b4471475.js` |
| `/dashboard/chat` | `app/dashboard/chat/page-ec13b3110e3afc98.js` |
| `/dashboard/standups` | `app/dashboard/standups/page-575d91c3509a8945.js` |
| `/dashboard/team` | `app/dashboard/team/page-624f2113b51ed159.js` |
| `/dashboard/team/:id/performance` | `app/dashboard/team/[id]/performance/page-26595080a762a2de.js` |
| `/dashboard/groups` | `app/dashboard/groups/page-bd6aa0f1ae5a6cfb.js` |
| `/dashboard/projects` | `app/dashboard/projects/page-8ccf24db63ad1d14.js` |
| `/dashboard/projects/new` | `app/dashboard/projects/new/page-3e10b0c666941979.js` |
| `/dashboard/projects/:id` | `app/dashboard/projects/[id]/page-3aefbc4940e0e94e.js` |
| `/dashboard/projects/:id/custom-fields` | `…/[id]/custom-fields/page-3ec0234e9b8546b5.js` |
| `/dashboard/projects/:id/forms` | `…/[id]/forms/page-e624f9d872e965fa.js` |
| `/dashboard/projects/:id/forms/new` | `…/[id]/forms/new/page-c3a0b384c740b38b.js` |
| `/dashboard/projects/:id/forms/:formId` | `…/[id]/forms/[formId]/page-daa2b07fc97c8b11.js` |
| `/dashboard/projects/:id/standup` | `…/[id]/standup/page-87c02135c8c7ce41.js` |
| `/dashboard/external-apps` (+ `/github`, `/slack`, `/migrate`) | `app/dashboard/external-apps/page-e83b505c9f00b3ec.js`, `github/page-6a43cca7ffee3521.js`, `slack/page-51ac7827e10845b8.js`, `migrate/page-8bd3aa71bb1d00b9.js` |
| `/github/installed` | `app/github/installed/page-008519cedd070f90.js` |
| `/settings` | `app/settings/page-fd09227ba1289f4e.js` |
| `/settings/calendar/callback` | `app/settings/calendar/callback/page-3c8d78f00f0dbbca.js` |
| `/subscription` | `app/subscription/page-863261aef001f4ca.js` |
| `/subscription/my-subscription` | `app/subscription/my-subscription/page-4d16ce3fc63b0d66.js` |
| `/profile` | `app/profile/layout-311e9b3672e38a93.js`, `page-34a496bd4e09ae3f.js` |
| `/profile/:username` | `app/profile/[username]/page-4a78d9401a4b88a6.js` |
| `/forms/:slug` | `app/forms/[slug]/page-25907d84ce2cafa0.js` |
| `/docs/mcp` | `app/docs/mcp/page-43ab82ecec68587e.js` (content server-rendered) |
| `/support` | `app/support/layout-0036b2b91dd0d52b.js`, `page-41d8dd4932a59bc2.js` |
| `/superadmin` | `app/superadmin/layout-f2f4138faa52ffca.js`, `page-7ad9109a4f91e0c6.js` |
| `/contact`, `/privacypolicy`, `/termsconditions`, `/refund` | no client page chunk (server-only) |
| all routes | root `app/layout-d586298ac2238eed.js`, `app/global-error-c390ebf217d894d2.js` |

---

## Appendix B — Complete endpoint list (generated from the 279 verified call sites)

Paths are relative to `https://api.eshway.com/v1`; `{…}` marks a path parameter (minified variable names carry no meaning). "Request shape" lists the body or query keys visible at the call site; `(variable)` means the body object is built elsewhere. \*Resource Timing records URLs, not methods, so "Path seen at runtime" is path-level only.

Total call sites: 279; distinct method+path templates: 254; domains: 30.

#### `(URL supplied by caller)` (2)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| DELETE | `(URL supplied by caller)` | — | page-6a43cca7ffee3521.js#75939 | — |
| GET | `(URL supplied by caller)` | — | page-6a43cca7ffee3521.js#75939 | — |

#### `analytics` (13)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/analytics/{…}/projects/{…}/configs` | — | 5628.d431a788932baedd.js#85628 | — |
| POST | `/analytics/{…}/projects/{…}/configs` | body: (variable) | 5628.d431a788932baedd.js#85628 | — |
| DELETE | `/analytics/{…}/projects/{…}/configs/{…}` | — | 5628.d431a788932baedd.js#85628 | — |
| PUT | `/analytics/{…}/projects/{…}/configs/{…}` | body: (variable) | 5628.d431a788932baedd.js#85628 | — |
| POST | `/analytics/{…}/projects/{…}/data/batch` | body: items | 5628.d431a788932baedd.js#85628 | — |
| POST | `/analytics/{…}/projects/{…}/drilldown/tasks` | body: (variable) | 5628.d431a788932baedd.js#85628 | — |
| GET | `/analytics/{…}/projects/{…}/report-schedules` | — | 5628.d431a788932baedd.js#85628 | — |
| POST | `/analytics/{…}/projects/{…}/report-schedules` | body: (variable) | 5628.d431a788932baedd.js#85628 | — |
| DELETE | `/analytics/{…}/projects/{…}/report-schedules/{…}` | — | 5628.d431a788932baedd.js#85628 | — |
| PUT | `/analytics/{…}/projects/{…}/report-schedules/{…}` | body: (variable) | 5628.d431a788932baedd.js#85628 | — |
| POST | `/analytics/{…}/projects/{…}/report-schedules/{…}/run-now` | — | 5628.d431a788932baedd.js#85628 | — |
| POST | `/analytics/{…}/projects/{…}/send-report` | body: (variable) | 5628.d431a788932baedd.js#85628 | — |
| POST | `/analytics/{…}/projects/{…}/send-report/preview` | body: (variable) | 5628.d431a788932baedd.js#85628 | — |

#### `auth` (11)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| POST | `/auth/forgot-password` | body: email | page-5c63f1402a192c01.js#17427 | — |
| POST | `/auth/google-signin` | body: id_token, referral_code | 3453-edd6a4c42cd00400.js#69176 | — |
| POST | `/auth/login` | body: email, password | 3453-edd6a4c42cd00400.js#69176 | — |
| POST | `/auth/login/verify-otp` | body: challenge_token, otp | 3453-edd6a4c42cd00400.js#69176 | — |
| POST | `/auth/logout` | — | 3453-edd6a4c42cd00400.js#69176 | — |
| POST | `/auth/refresh-token` | body: (variable) | 3453-edd6a4c42cd00400.js#69176 | yes |
| POST | `/auth/register` | body: email, username, password, full_name, referral_code | 3453-edd6a4c42cd00400.js#69176 | — |
| POST | `/auth/resend-verification-email` | body: email | page-782a1c4ece9debc4.js#46006 | — |
| POST | `/auth/reset-password` | body: token, new_password | page-fdb9c4cdd02246d4.js#58895 | — |
| GET | `/auth/validate-reset-token?token={…}` | — | page-fdb9c4cdd02246d4.js#58895 | — |
| POST | `/auth/verify-email` | body: token | page-3a17202d0e5d402f.js#51049, page-7b7a55b6b5881518.js#94177 | — |

#### `calendar` (6)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/calendar/auth-url` | — | 64-00c2f5b4a74c44a0.js#30064, page-b37c2f9a9a38c5cd.js#5463 | — |
| POST | `/calendar/disconnect` | — | page-b37c2f9a9a38c5cd.js#5463 | — |
| GET | `/calendar/oauth2callback?code={…}` | body: (variable) | page-3c8d78f00f0dbbca.js#60342 | — |
| DELETE | `/calendar/remove-task-event?task_id={…}` | — | 64-00c2f5b4a74c44a0.js#30064 | — |
| GET | `/calendar/status` | — | 64-00c2f5b4a74c44a0.js#30064, page-b37c2f9a9a38c5cd.js#5463 | — |
| POST | `/calendar/sync-task?task_id={…}` | — | 64-00c2f5b4a74c44a0.js#30064 | — |

#### `chat` (5)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/chat/{…}/conversations` | — | page-ec13b3110e3afc98.js#55798 | — |
| DELETE | `/chat/{…}/conversations/{…}` | — | page-ec13b3110e3afc98.js#55798 | — |
| GET | `/chat/{…}/conversations/{…}` | — | page-ec13b3110e3afc98.js#55798 | — |
| PATCH | `/chat/{…}/conversations/{…}` | body: title | page-ec13b3110e3afc98.js#55798 | — |
| POST | `/chat/{…}/message` | body: message, conversation_id | page-ec13b3110e3afc98.js#55798 | — |

#### `comments` (2)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| DELETE | `/comments/{…}` | — | 64-00c2f5b4a74c44a0.js#30064 | — |
| PUT | `/comments/{…}` | body: text | 64-00c2f5b4a74c44a0.js#30064 | — |

#### `forms` (2)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/forms/{…}` | — | 2478-3ce968856b292224.js#27341 | — |
| POST | `/forms/{…}/submit` | body: (variable) | 2478-3ce968856b292224.js#27341 | — |

#### `gemini_integration` (1)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| POST | `/gemini_integration/auto-setup` | body: project_description, team_members, id, name, email, role, skills, start_date, end_date | 1295.0c6a022cd1f4cae0.js#51196 | — |

#### `goals` (4)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| DELETE | `/goals/{…}` | — | page-b01e9408a6a9d138.js#51089 | yes |
| GET | `/goals/{…}` | body: (variable) | page-b01e9408a6a9d138.js#51089 | yes |
| POST | `/goals/{…}` | body: project_id | page-b01e9408a6a9d138.js#51089 | yes |
| PUT | `/goals/{…}` | body: (variable) | page-b01e9408a6a9d138.js#51089 | yes |

#### `group` (5)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/group/all/project/{…}` | — | 3572-f1153058a8ebadeb.js#85991 | — |
| POST | `/group/create` | body: name, members, project_id | page-bd6aa0f1ae5a6cfb.js#11372 | — |
| DELETE | `/group/{…}` | — | page-bd6aa0f1ae5a6cfb.js#11372 | — |
| PUT | `/group/{…}/members` | body: members | page-bd6aa0f1ae5a6cfb.js#11372 | — |
| PUT | `/group/{…}/name` | body: new_name | page-bd6aa0f1ae5a6cfb.js#11372 | — |

#### `integrations` (20)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/integration/github/install/{…}/{…}` | — | page-6a43cca7ffee3521.js#75939 | — |
| GET | `/integration/github/installations/{…}/repos` | query: project_id | page-6a43cca7ffee3521.js#75939 | — |
| GET | `/integration/github/oauth/callback` | query: installation_id, state, setup_action | page-008519cedd070f90.js#58394 | — |
| DELETE | `/integration/github/organizations/{…}/disconnect` | — | page-6a43cca7ffee3521.js#75939 | — |
| GET | `/integration/github/projects/{…}` | — | page-6a43cca7ffee3521.js#75939 | yes |
| GET | `/integration/github/projects/{…}/branches` | query: search | page-6a43cca7ffee3521.js#75939 | — |
| POST | `/integration/github/projects/{…}/{…}/connect` | body: installation_id, repo_full_name | page-6a43cca7ffee3521.js#75939 | — |
| DELETE | `/integration/github/projects/{…}/{…}/disconnect` | — | page-6a43cca7ffee3521.js#75939 | — |
| PUT | `/integration/github/projects/{…}/{…}/preferences` | body: auto_create_branches | page-6a43cca7ffee3521.js#75939 | — |
| GET | `/integration/organizations/{…}` | — | page-6a43cca7ffee3521.js#75939 | yes |
| POST | `/migration/fetch-structure` | body: provider, credentials, workspace_id | page-8bd3aa71bb1d00b9.js#17199 | — |
| GET | `/migration/jobs/{…}` | — | page-8bd3aa71bb1d00b9.js#17199 | — |
| GET | `/migration/providers` | — | page-8bd3aa71bb1d00b9.js#17199 | yes |
| POST | `/migration/start` | body: provider, credentials, workspace_id, selected_project_ids, field_mapping, options, organization_id, create_new_organization, new_organization_name | page-8bd3aa71bb1d00b9.js#17199 | — |
| POST | `/migration/validate` | body: provider, credentials | page-8bd3aa71bb1d00b9.js#17199 | — |
| GET | `/slack/members/{…}` | — | page-6a43cca7ffee3521.js#75939 | yes |
| PUT | `/slack/members/{…}/{…}` | body: slack_id | page-6a43cca7ffee3521.js#75939 | — |
| GET | `/slack/projects/{…}` | — | page-6a43cca7ffee3521.js#75939 | yes |
| POST | `/slack/projects/{…}/{…}/connect` | — | page-6a43cca7ffee3521.js#75939 | — |
| DELETE | `/slack/projects/{…}/{…}/disconnect` | — | page-6a43cca7ffee3521.js#75939 | — |

#### `invitations` (2)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| POST | `/invitations/accept-invitation` | body: token, password, full_name, skills | page-b44ee4fa9fc5af4f.js#64200 | — |
| GET | `/invitations/verify-invitation?token={…}` | — | page-b44ee4fa9fc5af4f.js#64200 | — |

#### `list-view` (5)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/list-view/{…}/projects/{…}/profiles` | — | 6021.0278a368c4fc7b9d.js#56021 | — |
| POST | `/list-view/{…}/projects/{…}/profiles` | body: (variable) | 6021.0278a368c4fc7b9d.js#56021 | — |
| DELETE | `/list-view/{…}/projects/{…}/profiles/{…}` | — | 6021.0278a368c4fc7b9d.js#56021 | — |
| PUT | `/list-view/{…}/projects/{…}/profiles/{…}` | body: (variable) | 6021.0278a368c4fc7b9d.js#56021 | — |
| PUT | `/list-view/{…}/projects/{…}/profiles/{…}/set-default` | — | 6021.0278a368c4fc7b9d.js#56021 | — |

#### `my-tasks` (1)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/my-tasks/{…}` | body: (variable) | 3572-f1153058a8ebadeb.js#85991 | yes |

#### `nexus` (4)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| POST | `/nexus/generate/{…}` | — | 7650.9f93396859716c09.js#25269 | — |
| GET | `/nexus/job-status/{…}` | — | 7650.9f93396859716c09.js#25269 | — |
| GET | `/nexus/rate-limit/{…}` | — | 7650.9f93396859716c09.js#25269 | — |
| GET | `/nexus/{…}` | — | 7650.9f93396859716c09.js#25269 | — |

#### `onboarding` (3)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| POST | `/onboarding` | body: (variable) | page-1a1b9b7f52884250.js#39345 | — |
| POST | `/onboarding/ensure-organization` | body: name, address, industry, plan | page-1a1b9b7f52884250.js#39345 | — |
| GET | `/onboarding/status` | — | 3453-edd6a4c42cd00400.js#69176, layout-3c5f17ea3aa12a50.js#16905 | yes |

#### `organizations` (7)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| POST | `/organizations/create` | body: (variable) (multipart) | page-1a1b9b7f52884250.js#98825 | — |
| GET | `/organizations/my-organizations` | — | 3453-edd6a4c42cd00400.js#69176, 3572-f1153058a8ebadeb.js#85991 | yes |
| GET | `/organizations/my-organizations/members/count` | — | 3572-f1153058a8ebadeb.js#85991 | — |
| DELETE | `/organizations/{…}` | — | page-1a1b9b7f52884250.js#98825 | — |
| PUT | `/organizations/{…}` | body: (variable) (multipart) | page-1a1b9b7f52884250.js#98825 | — |
| POST | `/organizations/{…}/import-members` | body: (variable) (multipart) | page-6a43cca7ffee3521.js#16542 | — |
| GET | `/organizations/{…}/members/count` | — | 3572-f1153058a8ebadeb.js#85991 | yes |

#### `pats` (3)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/pats` | query: organization_id | page-fd09227ba1289f4e.js#3814 | — |
| POST | `/pats` | body: (variable) | page-fd09227ba1289f4e.js#3814 | — |
| DELETE | `/pats/{…}` | — | page-fd09227ba1289f4e.js#3814 | — |

#### `project-file` (6)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/project-file/all/{…}` | — | 3572-f1153058a8ebadeb.js#85991 | — |
| POST | `/project-file/download/{…}` | body: file_name, uploaded_by | 146.7dd08b2c7f6ba4f0.js#90146 | — |
| GET | `/project-file/storage-used` | — | 3572-f1153058a8ebadeb.js#85991 | — |
| POST | `/project-file/upload` | body: project_id, organization_id, file_name, file_size | 146.7dd08b2c7f6ba4f0.js#90146 | — |
| POST | `/project-file/upload/finalize` | body: project_id, organization_id, file_name | 146.7dd08b2c7f6ba4f0.js#90146 | — |
| DELETE | `/project-file/{…}` | body: organization_id, uploaded_by, file_name | 146.7dd08b2c7f6ba4f0.js#90146 | — |

#### `projects` (44)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/projects/{…}/custom-fields` | query: include_archived | 64-00c2f5b4a74c44a0.js#23625 | — |
| POST | `/projects/{…}/custom-fields` | body: (variable) | 64-00c2f5b4a74c44a0.js#23625 | — |
| POST | `/projects/{…}/custom-fields/conditional-links` | body: links | 64-00c2f5b4a74c44a0.js#23625 | — |
| POST | `/projects/{…}/custom-fields/dependency-import` | body: (variable) (multipart) | 64-00c2f5b4a74c44a0.js#23625 | — |
| POST | `/projects/{…}/custom-fields/dependency-import/preview` | body: (variable) (multipart) | 64-00c2f5b4a74c44a0.js#23625 | — |
| DELETE | `/projects/{…}/custom-fields/{…}` | — | 64-00c2f5b4a74c44a0.js#23625 | — |
| GET | `/projects/{…}/custom-fields/{…}` | — | 64-00c2f5b4a74c44a0.js#23625 | — |
| PATCH | `/projects/{…}/custom-fields/{…}` | body: (variable) | 64-00c2f5b4a74c44a0.js#23625 | — |
| GET | `/projects/{…}/custom-fields/{…}/source-tasks` | query: search, limit | 64-00c2f5b4a74c44a0.js#23625 | — |
| GET | `/projects/{…}/forms` | — | 2478-3ce968856b292224.js#27341 | — |
| POST | `/projects/{…}/forms` | body: (variable) | 2478-3ce968856b292224.js#27341 | — |
| DELETE | `/projects/{…}/forms/{…}` | — | 2478-3ce968856b292224.js#27341 | — |
| GET | `/projects/{…}/forms/{…}` | — | 2478-3ce968856b292224.js#27341 | — |
| PUT | `/projects/{…}/forms/{…}` | body: (variable) | 2478-3ce968856b292224.js#27341 | — |
| POST | `/projects/{…}/project/{…}/import-members` | body: (variable) (multipart) | page-3aefbc4940e0e94e.js#15995 | — |
| POST | `/projects/{…}/projects` | body: project_data, name, description, team_members, ai_tasks | 1295.0c6a022cd1f4cae0.js#51196 | — |
| DELETE | `/projects/{…}/projects/bulk-delete` | body: project_ids | 1295.0c6a022cd1f4cae0.js#51196 | — |
| DELETE | `/projects/{…}/projects/bulk-delete-matching` | body: search, manager_id, needs_owner, expected_count, expected_token | 1295.0c6a022cd1f4cae0.js#51196 | — |
| GET | `/projects/{…}/projects/details` | — | 3572-f1153058a8ebadeb.js#85991 | yes |
| GET | `/projects/{…}/projects/portfolio` | query: skip, limit, search, manager_id, needs_owner, sort | 3572-f1153058a8ebadeb.js#85991 | yes |
| GET | `/projects/{…}/projects/portfolio-selection` | query: search, manager_id, needs_owner | 1295.0c6a022cd1f4cae0.js#51196 | — |
| DELETE | `/projects/{…}/projects/{…}` | — | 1295.0c6a022cd1f4cae0.js#51196 | — |
| GET | `/projects/{…}/projects/{…}` | — | 1295.0c6a022cd1f4cae0.js#51196 | — |
| PUT | `/projects/{…}/projects/{…}` | body: (variable) | 1295.0c6a022cd1f4cae0.js#51196 | — |
| GET | `/projects/{…}/projects/{…}/cockpit` | — | 1295.0c6a022cd1f4cae0.js#51196 | — |
| GET | `/projects/{…}/projects/{…}/members` | — | 3572-f1153058a8ebadeb.js#85991 | — |
| PUT | `/projects/{…}/task/{…}/custom-calender-reminder` | body: reminder | 64-00c2f5b4a74c44a0.js#30064 | — |
| GET | `/projects/{…}/tasks` | body: (variable) | 3572-f1153058a8ebadeb.js#85991 | — |
| POST | `/projects/{…}/tasks` | body: start_date, end_date | 64-00c2f5b4a74c44a0.js#9550 | — |
| POST | `/projects/{…}/tasks/ai-suggest` | body: title, description | page-b37c2f9a9a38c5cd.js#11190 | — |
| PUT | `/projects/{…}/tasks/archive` | body: task_ids, archive_status | 64-00c2f5b4a74c44a0.js#30064, 64-00c2f5b4a74c44a0.js#9550 | — |
| POST | `/projects/{…}/tasks/field-suggest` | body: custom_fields | page-b37c2f9a9a38c5cd.js#11190 | — |
| POST | `/projects/{…}/tasks/import` | body: (variable) (multipart) | 64-00c2f5b4a74c44a0.js#9550 | — |
| DELETE | `/projects/{…}/tasks/{…}` | query: delete_github_branch | 64-00c2f5b4a74c44a0.js#9550 | — |
| GET | `/projects/{…}/tasks/{…}` | — | 64-00c2f5b4a74c44a0.js#30064, 64-00c2f5b4a74c44a0.js#9550 | — |
| PUT | `/projects/{…}/tasks/{…}` | body: (variable) | 64-00c2f5b4a74c44a0.js#9550 | — |
| GET | `/projects/{…}/tasks/{…}/antecedents` | — | 64-00c2f5b4a74c44a0.js#30064 | — |
| GET | `/projects/{…}/tasks/{…}/dependencies` | — | 2845.dc51e40aea120161.js#62845, 64-00c2f5b4a74c44a0.js#30064 | — |
| POST | `/projects/{…}/tasks/{…}/dependencies` | body: antecedent_task_id, dependent_task_id, type | 64-00c2f5b4a74c44a0.js#30064 | — |
| DELETE | `/projects/{…}/tasks/{…}/dependencies/{…}` | — | 64-00c2f5b4a74c44a0.js#30064 | — |
| PUT | `/projects/{…}/tasks/{…}/github/branch` | body: branch_name | 64-00c2f5b4a74c44a0.js#9550 | — |
| POST | `/projects/{…}/tasks/{…}/github/branch/disconnect` | — | 64-00c2f5b4a74c44a0.js#9550 | — |
| POST | `/projects/{…}/tasks/{…}/github/branch/reconnect` | body: branch_name, base_branch | 64-00c2f5b4a74c44a0.js#9550 | — |
| PUT | `/projects/{…}/tasks/{…}/status` | body: status_slug | 64-00c2f5b4a74c44a0.js#9550 | — |

#### `settings` (2)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/settings/auto-sync` | — | 3572-f1153058a8ebadeb.js#85991 | yes |
| PATCH | `/settings/auto-sync` | body: auto_sync | page-4a78d9401a4b88a6.js#60500 | yes |

#### `standups` (7)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| POST | `/standups/generate/{…}` | body: user_context, standup_type | 4078-db82bd175b39ce74.js#51728 | — |
| GET | `/standups/job-status/{…}` | — | 4078-db82bd175b39ce74.js#51728 | — |
| GET | `/standups/my` | query: limit, organization_id | 4078-db82bd175b39ce74.js#51728 | — |
| GET | `/standups/my/{…}` | query: limit | 4078-db82bd175b39ce74.js#51728 | — |
| GET | `/standups/rate-limit/{…}` | — | 4078-db82bd175b39ce74.js#51728 | — |
| GET | `/standups/user/{…}` | query: organization_id, project_id, limit, skip | 4078-db82bd175b39ce74.js#51728 | — |
| GET | `/standups/{…}` | — | 4078-db82bd175b39ce74.js#51728 | — |

#### `subscriptions` (9)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| POST | `/subscriptions/cancel` | body: subscription_id | page-34a496bd4e09ae3f.js#88010 | — |
| GET | `/subscriptions/my-subscription` | — | 3453-edd6a4c42cd00400.js#69176 | — |
| GET | `/subscriptions/my-subscriptions` | — | page-34a496bd4e09ae3f.js#88010, page-4d16ce3fc63b0d66.js#23032 | yes |
| GET | `/subscriptions/plans` | — | page-1a1b9b7f52884250.js#39345, page-863261aef001f4ca.js#63989 | yes |
| GET | `/subscriptions/{…}/my-subscription` | — | 3453-edd6a4c42cd00400.js#51539, 3572-f1153058a8ebadeb.js#85991 | yes |
| POST | `/subscriptions/{…}/subscribe` | body: plan_id, plan_duration, members_cap | page-1a1b9b7f52884250.js#39345, page-863261aef001f4ca.js#63989 | — |
| POST | `/subscriptions/{…}/upgrade-seat` | body: additional_seats | page-624f2113b51ed159.js#34864 | — |
| POST | `/subscriptions/{…}/verify-payment` | body: razorpay_subscription_id, razorpay_payment_id, razorpay_signature | page-1a1b9b7f52884250.js#39345, page-863261aef001f4ca.js#63989 | — |
| POST | `/subscriptions/{…}/verify-seat-upgrade-payment` | body: razorpay_order_id, razorpay_payment_id, razorpay_signature | page-624f2113b51ed159.js#34864 | — |

#### `superadmin` (37)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/superadmin/activity` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| GET | `/superadmin/organizations` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| POST | `/superadmin/organizations` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| DELETE | `/superadmin/organizations/bulk` | body: ids | page-7ad9109a4f91e0c6.js#52993 | — |
| GET | `/superadmin/organizations/ids` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| DELETE | `/superadmin/organizations/{…}` | — | page-7ad9109a4f91e0c6.js#52993 | — |
| GET | `/superadmin/organizations/{…}` | — | page-7ad9109a4f91e0c6.js#52993 | — |
| PATCH | `/superadmin/organizations/{…}` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| GET | `/superadmin/projects` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| POST | `/superadmin/projects` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| DELETE | `/superadmin/projects/bulk` | body: ids | page-7ad9109a4f91e0c6.js#52993 | — |
| GET | `/superadmin/projects/ids` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| DELETE | `/superadmin/projects/{…}` | — | page-7ad9109a4f91e0c6.js#52993 | — |
| GET | `/superadmin/projects/{…}` | — | page-7ad9109a4f91e0c6.js#52993 | — |
| PATCH | `/superadmin/projects/{…}` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| POST | `/superadmin/referrals/codes` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| PATCH | `/superadmin/referrals/codes/{…}` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| POST | `/superadmin/referrals/creators` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| DELETE | `/superadmin/referrals/creators/{…}` | — | page-7ad9109a4f91e0c6.js#52993 | — |
| PATCH | `/superadmin/referrals/creators/{…}` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| GET | `/superadmin/referrals/report` | — | page-7ad9109a4f91e0c6.js#52993 | — |
| GET | `/superadmin/stats` | — | layout-f2f4138faa52ffca.js#14888, page-7ad9109a4f91e0c6.js#52993 | — |
| GET | `/superadmin/tasks` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| POST | `/superadmin/tasks` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| DELETE | `/superadmin/tasks/bulk` | body: ids | page-7ad9109a4f91e0c6.js#52993 | — |
| GET | `/superadmin/tasks/ids` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| DELETE | `/superadmin/tasks/{…}` | — | page-7ad9109a4f91e0c6.js#52993 | — |
| GET | `/superadmin/tasks/{…}` | — | page-7ad9109a4f91e0c6.js#52993 | — |
| PATCH | `/superadmin/tasks/{…}` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| GET | `/superadmin/users` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| POST | `/superadmin/users` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| DELETE | `/superadmin/users/bulk` | body: ids | page-7ad9109a4f91e0c6.js#52993 | — |
| POST | `/superadmin/users/bulk-email` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| GET | `/superadmin/users/ids` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |
| DELETE | `/superadmin/users/{…}` | — | page-7ad9109a4f91e0c6.js#52993 | — |
| GET | `/superadmin/users/{…}` | — | page-7ad9109a4f91e0c6.js#52993 | — |
| PATCH | `/superadmin/users/{…}` | body: (variable) | page-7ad9109a4f91e0c6.js#52993 | — |

#### `support` (2)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/support/tickets` | — | page-41d8dd4932a59bc2.js#27371 | — |
| POST | `/support/tickets` | body: (variable) | page-41d8dd4932a59bc2.js#27371 | — |

#### `task-file` (5)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/task-file/all?task_id={…}&project_id={…}` | — | 3572-f1153058a8ebadeb.js#85991 | — |
| DELETE | `/task-file/delete` | body: organization_id, project_id, task_id, uploaded_by, file_name | 64-00c2f5b4a74c44a0.js#30064 | — |
| POST | `/task-file/download` | body: project_id, task_id, file_name, uploaded_by | 64-00c2f5b4a74c44a0.js#30064 | — |
| POST | `/task-file/upload` | body: organization_id, project_id, task_id, file_name, file_size | 64-00c2f5b4a74c44a0.js#30064 | — |
| POST | `/task-file/upload/finalize` | body: organization_id, project_id, task_id, file_name | 64-00c2f5b4a74c44a0.js#30064 | — |

#### `task-statuses` (8)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/task-statuses/global` | — | 1763.59dd63492a616cc5.js#43 | — |
| GET | `/task-statuses/organization/{…}/projects/all` | — | 1763.59dd63492a616cc5.js#43 | yes |
| GET | `/task-statuses/project/{…}` | — | 1763.59dd63492a616cc5.js#43 | — |
| POST | `/task-statuses/project/{…}` | body: (variable) | 1763.59dd63492a616cc5.js#43 | — |
| POST | `/task-statuses/project/{…}/enable-custom` | — | 1763.59dd63492a616cc5.js#43 | — |
| PUT | `/task-statuses/project/{…}/reorder` | body: status_orders | 1763.59dd63492a616cc5.js#43 | — |
| DELETE | `/task-statuses/status/{…}` | query: replacement_status_id | 1763.59dd63492a616cc5.js#43 | — |
| PUT | `/task-statuses/status/{…}` | body: (variable) | 1763.59dd63492a616cc5.js#43 | — |

#### `tasks` (4)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/tasks/{…}/comments` | — | 3572-f1153058a8ebadeb.js#85991 | — |
| POST | `/tasks/{…}/comments` | body: text | 64-00c2f5b4a74c44a0.js#30064 | — |
| POST | `/tasks/{…}/schedule-reminder` | — | 64-00c2f5b4a74c44a0.js#30064 | — |
| PUT | `/tasks/{…}/status` | body: status_slug | 1763.59dd63492a616cc5.js#43 | — |

#### `team` (13)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/team/{…}/current-user-role` | — | page-6a43cca7ffee3521.js#16542 | yes |
| DELETE | `/team/{…}/invitations/{…}` | — | page-6a43cca7ffee3521.js#16542 | — |
| POST | `/team/{…}/invitations/{…}/invite-link` | body: regenerate | page-6a43cca7ffee3521.js#16542 | — |
| POST | `/team/{…}/invite` | body: (variable) | page-6a43cca7ffee3521.js#16542, page-1a1b9b7f52884250.js#39345 | — |
| GET | `/team/{…}/members` | — | page-6a43cca7ffee3521.js#16542 | yes |
| DELETE | `/team/{…}/members/{…}` | — | page-6a43cca7ffee3521.js#16542 | — |
| PUT | `/team/{…}/members/{…}` | body: role | page-6a43cca7ffee3521.js#16542 | — |
| DELETE | `/team/{…}/members/{…}/project-access` | body: (variable) | page-6a43cca7ffee3521.js#16542 | — |
| POST | `/team/{…}/members/{…}/project-access` | body: (variable) | page-6a43cca7ffee3521.js#16542 | — |
| PUT | `/team/{…}/members/{…}/project-access` | body: (variable) | page-6a43cca7ffee3521.js#16542 | — |
| GET | `/team/{…}/pending-invitations` | — | page-6a43cca7ffee3521.js#16542 | yes |
| GET | `/team/{…}/project-access/projects` | query: user_id | page-6a43cca7ffee3521.js#16542 | — |
| GET | `/team/{…}/project-access/summary` | — | page-6a43cca7ffee3521.js#16542 | yes |

#### `users` (21)

| Method | Path (relative to `/v1`) | Request shape | Defined in (chunk#module) | Path seen at runtime* |
|---|---|---|---|---|
| GET | `/users` | — | page-4a78d9401a4b88a6.js#60500 | — |
| GET | `/users/me` | — | layout-f2f4138faa52ffca.js#14888 | — |
| GET | `/users/me/privacy` | — | page-4a78d9401a4b88a6.js#60500 | — |
| PATCH | `/users/me/privacy` | body: (variable) | page-4a78d9401a4b88a6.js#60500 | — |
| GET | `/users/public/{…}` | — | page-4a78d9401a4b88a6.js#60500 | — |
| GET | `/users/{…}` | — | page-4a78d9401a4b88a6.js#60500 | yes |
| PATCH | `/users/{…}` | body: (variable) | page-4a78d9401a4b88a6.js#60500 | yes |
| POST | `/users/{…}/avatar` | body: (variable) (multipart) | page-4a78d9401a4b88a6.js#60500 | — |
| GET | `/users/{…}/certificates` | — | 3572-f1153058a8ebadeb.js#85991 | — |
| POST | `/users/{…}/certificates` | body: (variable) (multipart) | page-4a78d9401a4b88a6.js#40195 | — |
| POST | `/users/{…}/certificates/reorder` | query: certificate_id_1, certificate_id_2 | page-4a78d9401a4b88a6.js#40195 | — |
| DELETE | `/users/{…}/certificates/{…}` | — | page-4a78d9401a4b88a6.js#40195 | — |
| PUT | `/users/{…}/certificates/{…}` | body: (variable) (multipart) | page-4a78d9401a4b88a6.js#40195 | — |
| GET | `/users/{…}/certificates/{…}/download` | — | page-4a78d9401a4b88a6.js#40195 | — |
| GET | `/users/{…}/education` | — | 3572-f1153058a8ebadeb.js#85991 | — |
| POST | `/users/{…}/education` | body: (variable) | page-4a78d9401a4b88a6.js#40195 | — |
| POST | `/users/{…}/education/swap-order` | query: education_id_1, education_id_2 | page-4a78d9401a4b88a6.js#40195 | — |
| DELETE | `/users/{…}/education/{…}` | — | page-4a78d9401a4b88a6.js#40195 | — |
| PUT | `/users/{…}/education/{…}` | body: (variable) | page-4a78d9401a4b88a6.js#40195 | — |
| GET | `/users/{…}/performance` | query: organization_id, start_date, end_date | 3572-f1153058a8ebadeb.js#85991 | — |
| POST | `/users/{…}/resend-verification` | — | page-4a78d9401a4b88a6.js#60500 | — |


---

## Appendix C — Evidence index (key modules)

| Fact | Evidence (`chunk#module`) |
|---|---|
| Runtime config (API_URL, GA id, PostHog token — values redacted) | `270-e54c2606217fcd42.js#27750` |
| Endpoint constants `Sn` / `a7` | `270-e54c2606217fcd42.js` (object literals at offsets 6817 / 6240) |
| axios client, interceptors, refresh queue, `X-Organization-ID` | `270-e54c2606217fcd42.js#20270` |
| `auth-storage` store | `270-e54c2606217fcd42.js#48632` |
| `organization-store` / `dashboard-store` | `270-e54c2606217fcd42.js#22436` / `#53550` |
| Dependency types, motivational message pool | `270-e54c2606217fcd42.js#54354` |
| Roles / permissions enums | `2283-93c220ae16299bad.js#56771` |
| Command palette + shortcut map | `app/layout-d586298ac2238eed.js#56138` |
| Sidebar, subscription states, shadcn demo leftovers | `641-6b758ebb5fb17da3.js#90641` |
| Project dashboard + health thresholds | `1295.0c6a022cd1f4cae0.js#51295` |
| Analytics (charts, PDF, reports, schedules) | `5628.d431a788932baedd.js#85628` |
| List view + saved profiles | `6021.0278a368c4fc7b9d.js#56021` |
| Timeline | `2845.dc51e40aea120161.js#62845` |
| Workload thresholds | `2435.81a7bb0bd2588566.js#82435` |
| Files | `146.7dd08b2c7f6ba4f0.js#90146` |
| Nexus | `7650.9f93396859716c09.js#25269` |
| Roots (React Flow) | `6344.b97c56fcbb89cba1.js`, `1a258343.97db20253f8caf77.js`, `9861.8b1e9323acb4204a.js` |
| Task CRUD / dependencies / attachments / comments | `64-00c2f5b4a74c44a0.js#9550`, `#30064`; custom fields `#23625` |
| Custom statuses | `1763.59dd63492a616cc5.js#43`, `5077.edb3cbfeb151cfa6.js` |
| Forms service | `2478-3ce968856b292224.js#27341` |
| Auth service (login, OTP, Google, signup, refresh, logout) | `3453-edd6a4c42cd00400.js#69176` |
| Settings: PATs, MCP setup snippets, tabs | `app/settings/page-fd09227ba1289f4e.js#3814` |
| Pricing copy | `app/page-1b6208149e385f4b.js#39444` |
| Onboarding + Razorpay subscribe/verify | `app/onboarding/page-1a1b9b7f52884250.js#39345` |
| Superadmin console | `app/superadmin/page-7ad9109a4f91e0c6.js#52993` |
| Member performance widgets | `app/dashboard/team/[id]/performance/page-26595080a762a2de.js#32674` |
| REA application Evidence / summary view | `ev_ab495723de28a7b7159eea8ea72dc1ef5ece3bd9496c5ce955a72ddc94d50e41` / `ev_9134232f99784236e8fe0e42e6e5cc78d768bb4b12bda106922844d1648abea1` |
