# LTD (Live Tracking Dashboard) — Screen-by-Screen UI Reverse Engineering

**Target:** `https://ltd.eshway.com` (signed-in app) · **Evidence:** 32 screenshots `Screenshot (927).png` – `Screenshot (958).png` (captured 2026-10-05 in the user's own session: dark theme, Free plan, 1920×1080 device pixels) and a read-only live-DOM pass on 2026-10-20 · **Companion to:** [LTD_frontend_reverse_engineering.md](LTD_frontend_reverse_engineering.md) (the code-level analysis; chunk ids below refer to its Appendix A).

**Evidence tags:**
- **[shot N]** visible in screenshot N.
- **[pixel N]** colour sampled from screenshot N (lossless PNG, exact rendered sRGB).
- **[dom]** computed style or class list read from the live page.
- **[grep chunk]** string found in the locally saved JS chunks with plain `grep`. This is ordinary shell evidence, not REA Evidence.
- **[report §x]** a claim in the companion report.
- **[inferred]** a reasoned conclusion, with its basis stated. **Unknown** means not established.

---

## 0. Scope, method, limits

| Item | Detail |
|---|---|
| Screenshots | All 32 viewed one by one. UI labels (buttons, tabs, columns, field names, status strings) are transcribed. Taglines, help text and FAQ answers are summarised, not copied. The signed-in member's name, e-mail and avatar are not recorded. |
| Display scale | **[inferred]** 125 % Windows scaling, so a 1920-px screenshot is 1536 CSS px wide. Basis: the built-in browser on the same machine reports `devicePixelRatio` 1.25. The sidebar measures 320 device px = 256 CSS px, which is shadcn's default `16rem`. Screenshot distances below are given in CSS px (device px ÷ 1.25) and marked *approx*. |
| Pixel sampling | 61 element regions sampled with `System.Drawing`. For each region: the dominant colour, its share of the region, and the most saturated, lightest and darkest pixel (separates fill, text and dot colours). |
| Live DOM | Read-only pass at a 1536×780 viewport. Covered: computed styles and class lists of the app shell, the Nexus upsell, the empty Projects page and My Tasks. One popover was opened and closed. Nothing was created, edited or submitted, and no API call was replayed. The live account has **no projects**, so the project views are documented from screenshots only. |
| Static cross-check | `grep` over the 106 chunk files saved in the main checkout (`chunks/`, `common_chunks/`, `public_app_chunks/`). The ~52 protected route-page chunks of the original 158-file corpus are not present locally. |
| REA | Not available this session (§12). |
| Coverage limits | A single-member, empty, subscription-restricted workspace: no populated cards, rows or charts, and no Professional screens beyond the Nexus upsell. Login, onboarding, standups, My Assistant, team performance, project detail and forms were not captured (§11). |

---

## 1. What this pass adds to the code report

1. **Calendar view:** modes **Month · Week · Day · Agenda · Year**, plus Pick date / Today / "Focus off" and four stat tiles. It lives in chunk **7329**, where `week` and `agenda` share a week range [shot 933][grep 7329]. This resolves report §10 ("calendar grid chunk not identified") and §9 ("Month / Workweek / Day — Unverified").
2. **The subscription-restricted ("read-only") workspace** and its UI treatment, page by page (§8).
3. **Plan limits** (members, projects, storage, analytics tier, support) and live seat-based totals (§5.8).
4. **The complete shortcut map**, including keys the report lacked: Shift+S Settings, Shift+U Upgrade to Pro, Alt+Shift+Z dark mode, and Timeline-scoped T / D / M (§6.3) [shots 952–954][grep 3453].
5. **Exact rendered colours.** The `--primary` token renders **`#dd6efc`**, not `#d86dfc`. Both orchids are in use (§7.1).
6. **The shell is the stock shadcn sidebar block** with stock shadcn Button / Card / Badge / Tabs / Input. LTD's own patterns on top: `rounded-full` view tabs, eyebrow-headed cards and a gradient page title (§3, §7.2) [dom].
7. **Screen details the code report lacks:** Roots legend colours, Goals' Project/Personal scopes, the Workload member row, the default Analytics widget set, the Nexus upsell, the account-menu items, and Settings drawer vs Settings page tabs.
8. **Observed defects** and inconsistent states to avoid in a rebuild (§9).

---

## 2. Screen index

| Shot | Screen | Route | Code chunk | § |
|---|---|---|---|---|
| 927 | Workspace · Dashboard view | `/dashboard` | `app/dashboard/page`, `1295` | 4.1 |
| 928 | List view | `/dashboard` | `6021`, `9155` | 4.2 |
| 929 | Board view | `/dashboard` | page + `602dbae6` (DnD) | 4.3 |
| 930 | Timeline view | `/dashboard` | `2845` [grep] | 4.4 |
| 931 | Roots view | `/dashboard` | `6344`, `1a258343` | 4.5 |
| 932 | Workload view | `/dashboard` | `2435` [grep] | 4.6 |
| 933 | Calendar view | `/dashboard` | `7329` [grep] | 4.7 |
| 934 | Files view | `/dashboard` | `146` [grep] | 4.8 |
| 935–937 | Analytics view | `/dashboard` | `5628` | 4.9 |
| live | Nexus view (upsell) | `/dashboard` | `7650` | 4.10 |
| 938 | My Tasks | `/dashboard/my-tasks` | route page | 5.1 |
| 939 | Goals | `/dashboard/goals` | route page | 5.2 |
| 940 | Team | `/dashboard/team` | route page | 5.3 |
| 941 | Projects | `/dashboard/projects` | route page | 5.4 |
| 942 | Groups | `/dashboard/groups` | route page | 5.5 |
| 943 | Ask Your Project (chat) | `/dashboard/chat` | route page | 5.6 |
| 944 | External Apps | `/dashboard/external-apps` | route page | 5.7 |
| 945 | Subscription | `/subscription` | route page | 5.8 |
| 946–948 | Settings drawer | overlay | — | 6.1 |
| 949–951 | FAQ drawer | overlay | — | 6.2 |
| 952–954 | Keyboard Shortcuts modal | overlay | `3453` [grep] | 6.3 |
| 955 | Account menu | overlay | `641` (sidebar) | 6.4 |
| 956–957 | Profile · Billing | `/profile` | profile layout + page | 6.5 |
| 958 | Settings page | `/settings` | route page | 6.6 |

---

## 3. App shell [dom unless noted]

### 3.1 Frame

- **Desktop** (≥ 768 px, `md:`): a fixed 256 px sidebar (shadcn `--sidebar-width: 16rem`) beside the shadcn `SidebarInset` main (`bg-background`, inner `flex h-screen flex-col overflow-hidden`).
- **Below `md`:** the sidebar is hidden and an "Open navigation menu" button appears in the top bar.
- **Workspace top bar:** `min-h-12`, measured **52 px**, `px-4`.
  - The view-tab row is `flex-1 gap-1.5 overflow-x-auto px-3 py-2`, so it scrolls horizontally on narrow screens.
  - The right cluster is `gap-2 pl-4`.
- **Project bar** (workspace views only), left to right:
  - the sidebar trigger (32 px, `rounded-lg`);
  - the **project switcher**: a 280 × 36 `rounded-full` outline pill, 12 px medium text, chevrons-up-down icon. With no projects it reads "Select a project…";
  - a round "+" button for a new project [shot 927].
- **Body:** Arial 16 / 24, `#f1f2f4` on `#1d1d20`. `next/font` faces load, but body text computes to Arial [report §7].

### 3.2 Sidebar (shadcn sidebar block)

| Part | Spec |
|---|---|
| Container | `bg-sidebar` = `#27272b` (the card colour), 256 px wide. Structure uses `data-sidebar` = header, content, two groups, 15 menu items, footer, rail, trigger. |
| Header | `p-2 gap-2`. **Org switcher** (`lg` menu button, 48 px): square org-icon tile, org name (truncated), plan label under it ("Free"), chevrons. **Search trigger** (32 px, `bg-sidebar-accent/40`, 1 px border, 70 % text): "Search…" + key chip "Ctrl K" (10 px mono, `bg-sidebar`, bordered). |
| Group labels | "Personal", "Company": `h-8 px-2 text-xs font-medium`, foreground at 70 %. |
| Items | Menu buttons `h-8 p-2 gap-2 rounded-md`, 14 px, lucide icon. Shortcut hint chip at right: `ml-auto font-mono text-xs bg-muted/50 border rounded px-1.5 py-0.5`, muted text at 70 %. |
| Personal | Home (Shift+D) · My Tasks (Alt+M) · Goals (Alt+G) · My Assistant (no hint) |
| Company | Teams (Alt+Shift+T) · Projects (chevron; expands the project list) · Groups (Shift+G) · Chat (Alt+C) · Upgrade to Pro (Shift+U) · External Apps (Alt+E) · More [shot 927, live] |
| Motivational card | Rounded card with a thick primary left bar [pixel 927] and an italic multi-line message that changes with the time of day. The screenshots show an "Evening reminder…"; the live session showed "Afternoon slump?…". The pool is 184 strings in `270#54354` [report §3.3]. |
| Footer | User pill (`lg` menu button, 48 px): round initial avatar, name (truncated), e-mail, chevrons. It opens the account menu (§6.4). |

### 3.3 Workspace top bar

- **View tabs:** shadcn `Button`, `h-9 px-3 rounded-full text-xs font-medium`, 16 px icon, `gap-2`. Order: Dashboard · List · Board · Timeline · Roots · Workload · Calendar · Files · Nexus · More (muted, "+" icon).
- **Active tab:** background `#dd6efc` with white text (2.72 : 1, below WCAG AA; §7.4). Inactive tabs are transparent with foreground text.
- **Right cluster:**
  - "?": 36 px ghost button → FAQ drawer;
  - "⇧ + ?": outline `sm` button, 32 px → shortcuts modal;
  - gear → Settings drawer;
  - moon, `aria-label="Theme Toggle"` → light/dark.
- **Analytics** (shots 935–937) has no active tab. **[inferred]** It is reached through a control other than the nine tabs, most likely **More**. Unknown: what More contains.

### 3.4 Pages outside the workspace bar

- **Sidebar pages without the tab bar:** My Tasks, Goals, Team, Projects, Groups, Chat and External Apps show a "← Back to Dashboard" header instead (a ghost `sm` button, 12 px medium) [shots 938–944][dom].
- **Full-width pages without the sidebar:**
  - `/subscription` ("← Dashboard" plus "Manage subscription");
  - `/profile` (its own left nav: Profile · Billing);
  - `/settings` (tabs) [shots 945, 956–958].

### 3.5 Overlays

| Overlay | Opened by | Spec |
|---|---|---|
| Settings drawer | gear | Right sheet about 384 px wide with a dimmed backdrop; title "Settings" + subtitle; segmented tabs Appearance · Integrations · Shortcuts [shots 946–948]. **[inferred]** shadcn `Sheet` at `sm:max-w-sm`. |
| FAQ drawer | "?" | The same sheet; title "FAQ" + subtitle; collapsible groups (§6.2). |
| Shortcuts modal | "⇧ + ?", Shift+? | Centred dialog about 672 px wide (≈ `max-w-2xl`), scrolling body, close button with a primary ring [shots 952–954]. |
| Account menu | user pill | Dropdown opening above the pill (§6.4). |
| Shortcut-hint toast | early visits | `fixed bottom-4 right-4 rounded-lg border bg-background p-3 shadow-lg animate-in slide-in-from-bottom-2`, dismiss × [dom]. Flag `keyboardShortcutHintSeen` [report §3.3]. |
| Subscription banner | lapsed plan | Full-width red-bordered alert at the top with dismiss × and "Upgrade Now" (primary) [shot 941]. Its string lives in the root layout [grep `layout-d586…`]. |

---

## 4. Project workspace views

Common pattern: each view sits under the project bar. Most open with a **header card**:
- an eyebrow (`text-xs font-semibold uppercase tracking-[0.22em]`);
- a title (`text-2xl font-semibold tracking-tight`);
- a one-line muted subtitle;
- on the right, four stat tiles (icon, small label, large number) [shots 930, 932, 933]. The recipe was measured on the Projects page [dom].

### 4.1 Dashboard (927)

- **Hero card** with a primary left border (≈ 4 px) [pixel]:
  - chips "OPS BRIEF" (letter-spaced primary text on a ~10 % primary tint, `#3a2e41`) and a state chip ("No tasks yet", primary text on `#302b36`);
  - the project name as title, plus a one-line subtitle;
  - a completion ring on the right ("0% COMPLETE").
- **Metric strip:** one card split into four columns. Each label has a colour dot: primary, primary, emerald-500 `#10b981`, primary [pixel].
  - TOTAL TASKS: count, "n completed";
  - IN PROGRESS: count, "% of total tasks";
  - DUE SOON: count in emerald `#34d399`, "Next 7 days";
  - HEALTH: label, sub-label.
- **Health rule:** progress > 70 % → Good, > 30 % → Watch, otherwise At risk; "No tasks yet" when empty [report §6.1].
- **Two-column row:**
  - "Project Progress" card: "Guidance" badge; a "Completion path" bar with %; Completed / Remaining sub-tiles; a quote callout with a "Go to task list →" button.
  - "Recent movement" card: "Open list →" link; dashed-border empty state.

### 4.2 List (928)

- **Toolbar, left to right:**
  - task search (flexible width);
  - "…" (more actions; Unknown);
  - saved-view selector "Default View" (sliders icon; the list-view profiles API, [report §6.1]);
  - "Group" (group-by);
  - "Task Type" (Unknown semantics);
  - "+ Add Task" (primary; disabled when restricted);
  - refresh.
- **Table:**
  - Columns: select-all checkbox (primary border), TITLE (sortable ↑↓), Status ▾, Priority ▾, Assignee ▾, Due Date ▾, Perspective ▾.
  - Each column header opens a menu.
  - The table scrolls horizontally and has a footer bar (pagination).
- **Empty state:** tinted icon tile, "No tasks found", one-line hint.
- Settings → "Show task descriptions in list view" adds a description line to each row [shot 958].

### 4.3 Board (929)

- **Header bar:** "Board" with a count summary ("0 active tasks across 3 columns"), "Search board…", refresh.
- **Default columns:** To Do (dot `#d86dfc`), In Progress (dot `#eab308`), Completed (dot `#22c55e`) [pixel]. Custom statuses replace these [report §6.3].
- **Column anatomy:** count badge (`#36363a`, foreground text), tall drop area (`#26262a`), and a ghost "+ Add Task" button at the foot.

### 4.4 Timeline (930)

- **Header card** "TIMELINE" with tiles In view · Done · Late · Due soon.
- **Controls:**
  - scale select ("Daily"; key M switches to monthly);
  - two eye toggles with red `#ef4444` and blue `#3b82f6` icons. Purpose Unknown; **[inferred]** they show/hide overdue and dependency overlays, since the code has "Dependent on previous task" markers [report §6.1];
  - ‹ Today ›, and the month label.
- **Grid:** a left "Tasks" column, then day columns (date + weekday). Today is a blue `#2563eb` vertical line with a `#1d4ed8` "Today" pill [pixel]. The empty state is per year.
- **Keys:** T today, D daily, M monthly [shot 954].

### 4.5 Roots (931)

- **Toolbar:** "Add Task" (primary; disabled `#7d458e` when restricted) and a "Pro Tip" card (create hierarchy by dragging from a parent node to a child).
- **Floating Filters panel:**
  - hide-panel toggle, "Clear All";
  - task search, and a "Find & Highlight" field;
  - selects All Perspectives / All Statuses / All Priorities;
  - Show Completed (Yes/No button, primary when Yes), Show Archived;
  - "Showing x of y tasks".
- **Canvas:** React Flow with a dotted grid (`#515157` dots on `#1d1d20`). Controls bottom-left: zoom in, zoom out, fit view, lock.
- **Legend panel** (hideable) [pixel 931]:
  - Priority: High `#ef4444` · Medium `#eab308` · Low `#22c55e`;
  - Connections: Parent-Child `#3b82f6` · Perspective `#d86dfc`;
  - Status = node border colour; Overdue = red date.

  This resolves report §9 ("Roots node colours: Unverified"). Perspective colours the *links*, not the nodes.

### 4.6 Workload (932)

- **Header** "WORKLOAD" with tiles Members · Open · Overloaded · Unassigned.
- **Highlight banner:** full-width, emerald-tinted (`#243533`, ≈ emerald-500 at 10 % over the card). It names the member with the highest load, with their score and state ("0.0 · Available").
- **Controls:** people search, sort-direction toggle, task filter ("All Tasks"), metric select ("Workload Score").
- **Member row:**
  - avatar, name, task count;
  - state label (Available in emerald), "% load" with a bar, next-due line;
  - score pill (primary, one decimal);
  - Open / Done / Late counters (primary / emerald / foreground);
  - expand chevron.
- **Thresholds:** ≥ 4 Over capacity, ≥ 2 At pace, otherwise Available [report §6.1].

### 4.7 Calendar (933) — chunk 7329 [grep]

- **Header** "CALENDAR" with tiles In view · Late · High priority · No date.
- **Controls:**
  - ‹ month ›;
  - segmented **Month · Week · Day · Agenda · Year** (active = primary pill);
  - Pick date, Today, a "Focus off" toggle;
  - filters All statuses / All priorities.
- **Month grid:** Sun–Sat. Adjacent-month days are dimmed. Today gets a primary ring (≈ 2 px) and a primary date number.
- **Mode logic:** `week` and `agenda` compute the same week range; `year` uses a year range [grep 7329]. Agenda is therefore a week-scoped list.

### 4.8 Files (934)

- **Header** "FILES" (muted eyebrow) / "Project library". On the right: "Showing n of m" and storage used ("0.0B").
- **Controls:** search (files, uploaders or types), type filter "All types", sort "Newest first".
- **Drop zone:** upload icon and "Browse files". When restricted it reads *"Workspace is read-only: renew your subscription to upload files."* and the button is disabled [shot 934][grep 146].
- **Empty state:** folder icon, title, one-line hint.

### 4.9 Analytics (935–937)

- **Toolbar:** dashboard-config select ("Default"), an as-of date input (dd/mm/yyyy), "Options" ▾, "Edit" (primary), "PDF", "Send", "Schedule". This matches report §6.1 (PDF export, e-mailed and scheduled reports).
- **Default widgets, in order:**
  1. Task status overview
  2. Priority breakdown (bar chart; axes Count × Priority)
  3. Completions by day
  4. Open overdue tasks (KPI, "TASKS")
  5. Avg. time to complete (KPI, "DAYS")
  6. Perspective distribution
  7. Assignee workload

  Layout: row 1 holds three charts. Row 2 holds the two KPI tiles on the right, with an empty gap on the left (Unknown: possibly an empty slot). Then one full-width chart and one half-width chart. Empty charts read "No data for this chart".

### 4.10 Nexus (live; not in the screenshots)

- **On Free / Starter it is an upsell:**
  - a full-width card titled "Premium Feature" with a Professional-only notice and a product description;
  - locked preview artwork;
  - "Upgrade to Professional" (primary) [dom 2026-10-20].
- The card is shadcn `rounded-xl border bg-card shadow` with `hover:shadow-lg`.

---

## 5. Company and personal pages

### 5.1 My Tasks (938)

- **Title** "My Tasks": `text-3xl font-bold bg-gradient-to-r from-primary to-primary-foreground bg-clip-text text-transparent`, which renders a gradient from `#dd6efc` to white [dom]. Below it, a muted subtitle; a refresh button sits at the right.
- **Filter card:** search (`h-9`, left icon), All Projects / All Statuses / All Priorities, "Reset Filters".
- **Tabs:** shadcn Tabs in a `bg-muted/50 p-1 rounded-xl` list. My Tasks · Pending · Overdue · Due Today · Upcoming. Each has a count `Badge` with `bg-primary text-white`; Overdue uses `bg-destructive` and an alert icon [dom].
- **Empty state:** a card.

### 5.2 Goals (939)

- **Header:** "GOALS" / "Execution goals".
  - Summary line: n active · n at risk (red) · n due soon · n completed.
  - "+ Add goal" (primary).
- **Scope switch** (segmented): Project (n) · Personal (n).
- **Goal card:**
  - trend icon tile; title with a status badge ("On Track"); description;
  - progress bar with % and a mood emoji; current / target ("0/1");
  - overdue days in red ("40d overdue");
  - actions: an "Overdue" label, Update (pencil), delete (×).
- **[inferred]** The badge is a stored status and the summary is computed. Basis: the same goal showed "On Track" while being counted at risk and 40 days overdue [shot 939].

### 5.3 Team (940)

- **Hero card** "TEAM COMMAND CENTER" / "Team Members", with buttons Import and "+ Invite" (both disabled when restricted).
- **Stat row:**
  - PLAN: plan name and a state tag ("Free · Expired");
  - SEATS: used / total, an Upgrade button, a primary bar, "n seats available";
  - NEXT BILLING: amount and date.
- **Active members list**, one row per member:
  - avatar, name, e-mail, role badge (outline, e.g. "Admin");
  - actions: edit, remove (red), performance (chart icon → `/dashboard/team/:id/performance`).

### 5.4 Projects (941; empty variant live)

- **Header** "ALL PROJECTS" / "Projects" with "+ New Project".
- **Controls:**
  - a "Showing n of m projects" strip;
  - search (projects or owners), an "All owners" select, sort "Name A–Z";
  - a selection strip with a checkbox ("n visible") for bulk actions.
- **Project card** (≈ 300 px wide):
  - letter tile (primary text on `#392d40`), name;
  - badges "Owned" (emerald-300 text on an emerald tint) and "ID #…";
  - "…" menu;
  - footer: lead avatar + "Project lead", and an open-arrow button.
- **Empty variant (live):** eyebrow "Portfolio", title "No projects yet", centred muted text (`mx-auto max-w-sm text-sm`) [dom].

### 5.5 Groups (942)

- **Two-pane layout.**
- **Left panel**, "DIRECTORY / Team map":
  - project select;
  - "+ New group" (disabled, with an amber notice, when restricted);
  - stat tiles Groups · Members · Empty;
  - search;
  - filter list All / Needs members / Staffed with counts (active row tinted `#332839`).
- **Right panel**, "Group workspace": a counts line, and an empty state with "Create first group" (disabled when restricted).

### 5.6 Ask Your Project — `/dashboard/chat` (943)

- **Left history rail** (collapsible): "HISTORY", "New chat", a PROJECT select, the conversation list or its empty state.
- **Main area, top to bottom:**
  - back chevron, title "Ask Your Project", project chip (primary outline) at top right;
  - a centred dashed empty-state card: brain icon, intro line, four suggested-question pills;
  - a bottom "Try asking:" pill row;
  - a multi-line composer with a primary send button, and the hint "Enter to send • Shift+Enter for newline".
- A faint purple radial glow sits behind the header [shot 943].

### 5.7 External Apps (944)

- **Header:** "External Integrations" + subtitle.
- **Tabs:** Integrations · Data Migration.
- **Integration cards:** logo, name, one-line description, and a primary button ("Connect" for Slack, "Connect to GitHub" for GitHub).

### 5.8 Subscription — `/subscription` (945)

- **Left column:**
  - "WORKSPACE SETUP" card: organisation select, seats input with "Use recommended", a members/recommendation line, and a "SEAT BASELINE" tile;
  - "TEAM FIT" card listing members with their roles.
- **Right column:**
  - "PLANS" header card with a "Current: Free" chip;
  - a trust strip: a Razorpay-checkout note, a cancel-anytime note, and UPI / VISA / Mastercard marks;
  - three plan cards. **Starter** is highlighted (primary border, "Recommended" badge, sparkle icon, primary "Switch plan"). **Free** shows "Current" and a disabled "Current plan" button. Each paid card shows the per-seat price, the total for the chosen seats before taxes, and an "Estimated recurring subtotal" note.

| Plan | Price | Members | Projects | Storage | Analytics | Support |
|---|---|---|---|---|---|---|
| Free | ₹0 (covers up to 3 seats) | 3 | 5 | 2 GB | Basic | Email |
| Starter | ₹749 / seat / month | 20 | 50 | 50 GB | Advanced | Priority |
| Professional | ₹1,399 / seat / month | Unlimited | Unlimited | 100 GB | Enterprise | 24/7 |

For 3 seats: Starter ₹2,247 / month and Professional ₹4,197 / month, before taxes [shot 945]. Nexus, AI Standups and My Assistant are Professional-only [report §3.4].

---

## 6. Settings, help and account

### 6.1 Settings drawer (946–948)

- **Appearance:** a "Primary Color" swatch with a hex input (default `#d86dfc`), "Reset to Default", and a hint line. There are **no colour presets**.
- **Integrations:** a Google Calendar card with "Connect Calendar" (primary).
- **Shortcuts:** a link card, "View and manage shortcuts" (external-link icon), pointing to the Settings page tab.

### 6.2 FAQ drawer (949–951)

- **Structure:** title "FAQ" + subtitle, then collapsible sections.
- **Observed sections:**
  - "General FAQs": who LTD is for, industries, differentiators, technical expertise needed;
  - "Features and Functionality", with sub-headings Project Management (AI task creation, dependencies, sprints/backlogs), Agile Methodologies (Scrum/Kanban) and Custom Dashboards and Views (role-based dashboards).
- The answers are marketing copy and are not reproduced.
- **[inferred]** Treat FAQ text as marketing, not as evidence of features. Some of its claims (sprint planning, Scrum boards) have no matching code in the companion report.

### 6.3 Keyboard Shortcuts modal (952–954)

| Global navigation | Keys | Global navigation | Keys |
|---|---|---|---|
| Show keyboard shortcuts help | Shift+? | Switch to My Tasks | Alt+M |
| Switch to Board tab | Shift+B | Switch to Nexus tab | Shift+N |
| Switch to Calendar tab | Shift+C | Switch to Roots tab | Shift+R |
| Switch to Chat | Alt+C | Switch to Settings | Shift+S |
| Switch to Dashboard overview | Shift+D | Switch to Teams | Alt+Shift+T |
| Switch to External Apps | Alt+E | Switch to Timeline tab | Shift+T |
| Switch to Files tab | Shift+F | Go to Upgrade to Pro | Shift+U |
| Switch to Goals | Alt+G | Switch to Workload tab | Shift+W |
| Switch to Groups | Shift+G | Toggle dark mode | Alt+Shift+Z |
| Switch to List tab | Shift+L | | |

- **Timeline view** (scoped): Go to today **T** · daily view **D** · monthly view **M**.
- **Layout:** rows are sorted alphabetically by action; keys are mono key chips; a closing "Tips" box covers shortcuts being suspended while typing, customising them in Settings → Keyboard Shortcuts, the Shift+key convention, and Shift+? to reopen.
- **Source:** chunk `3453`, with the dark-mode toggle also in the root layout [grep].

### 6.4 Account menu (955)

Header (avatar, name, e-mail) · Profile · Upgrade to Pro · *divider* · Billing · Settings · *divider* · Log out.

### 6.5 Profile and Billing — `/profile` (956–957)

- **Left nav** "Profile Settings": Profile · Billing (the active row has a primary tint).
- **Profile tab:**
  - large initial avatar, name, "View Public Profile" (outline, external-link icon), "Edit Profile" (primary);
  - fields, read-only until Edit: Username (helper: the public display name), Email, Full Name, Bio (textarea), Skills (input + "Add" + chip list).
- **Billing tab:**
  - "Billing & Subscription" with "Manage Plans";
  - a plan card with a primary border: plan name, "Active until <date>", shield icon;
  - meters Users · Projects · Storage (used / limit, primary bars);
  - a "Plan Features" list with shield icons;
  - a status line, and "Cancel Subscription" (destructive).

### 6.6 Settings page — `/settings` (958)

- **Tabs:** General · Keyboard Shortcuts · Integrations · API tokens. Appearance is a section inside General, not a tab.
- **General → Appearance:**
  - Theme: swatch, hex input, "Reset to Default";
  - a "Show task descriptions in list view" switch;
  - a live "Preview" table (Title, Status, Priority, Assignees) with demo rows themed on Stark Industries: In Progress status pill (`#eab308`, black text), priority dot + label, initials avatar on `#e53935`.

---

## 7. Design system (measured)

### 7.1 Tokens and rendered colours

| Role | Rendered | Source | Evidence |
|---|---|---|---|
| Background | `#1d1d20` | `--background: 240 6% 12%` | pixel 927/929, dom |
| Card, sidebar | `#27272b` | `--card`, `--sidebar-background: 240 5% 16%` | pixel, dom |
| Border, input | `#36363a` | `--border: 240 4% 22%` | dom |
| Foreground | `#f1f2f4` | `--foreground: 220 13% 95%` | dom |
| Muted foreground | `#9aa2b1` | `--muted-foreground: 220 13% 65%` | dom |
| **Primary (token)** | **`#dd6efc`** | `--primary: 287 96% 71%` | active tab, buttons, badges, accent borders (pixel, dom) |
| Primary (literal) | `#d86dfc` | hard-coded hex; Settings default | To Do dot, Perspective link, billing border (pixel); shots 946, 958 |
| Primary tints | `#302b36`, `#392d40`, `#3a2e41`, `#332839` | primary at ≈ 5–12 % opacity | chips, tiles, active rows (pixel) |
| Disabled | `#7d458e` | primary at exactly 50 % over background (`disabled:opacity-50`) | pixel 931, dom class |
| Destructive | `#a92727` | dark `--destructive: 0 62.8% 40.6%` | pixel, dom |
| In Progress / Medium | `#eab308` | Tailwind yellow-500 | pixel 929, 931, 958 |
| Completed / Low | `#22c55e` | green-500 | pixel 929, 931 |
| Emerald accents | `#10b981` dot, `#34d399` text, `#6ee7b7` badge text, `#243533` tint | emerald-500 / 400 / 300 | pixel 927, 932, 941 |
| High / overdue | `#ef4444` | red-500 | pixel 931 |
| Today, links | `#2563eb` line, `#1d4ed8` pill, `#3b82f6` icons and parent-child links | blue-600 / 700 / 500 | pixel 930, 931 |
| Amber notices | `#fcd34d` text on `#362d21`; `#d97706` text | amber-300 / 600 | pixel 942 |
| Avatar colour | `#e53935` (demo row) | per-user colour | pixel 958 |

### 7.2 Component recipes [dom]

| Component | Classes / values |
|---|---|
| Card | `rounded-xl border bg-card shadow` (12 px radius, 1 px `#36363a`) + `hover:shadow-lg`. Measured on the Nexus card; the other cards match visually. |
| Primary button | shadcn default: `h-9 px-4 py-2 rounded-md text-sm font-medium`, primary background, white text |
| View tab / segmented pill | shadcn Button `h-9 px-3 rounded-full text-xs font-medium`, 16 px icon |
| Small outline button | `h-8 px-3 rounded-md border bg-background text-xs font-medium` (e.g. "⇧ + ?") |
| Icon button | 36 × 36 ghost, `rounded-md` |
| Badge | `rounded-md border px-2.5 py-0.5 text-xs font-semibold` with `bg-primary text-white` or `bg-destructive text-white` |
| Tabs | list `h-9 bg-muted/50 p-1 rounded-xl`; trigger `px-3 py-1 text-sm font-medium rounded-lg`; active trigger `bg-background` with foreground text, inactive muted |
| Input | `h-9 rounded-md border border-input px-3 py-1 shadow-sm`; 40 px left padding when it has an icon |
| Popover | `rounded-md border bg-popover shadow-md`, fade / zoom animate-in |
| Key chip | `font-mono text-[10px]`–`text-xs px-1.5 py-0.5 rounded border bg-muted/50` |
| Section header | eyebrow `text-xs font-semibold uppercase tracking-[0.22em] text-primary` (Files, Goals and Groups use a muted eyebrow; shots 934, 939, 942); title `text-2xl font-semibold tracking-tight`; subtitle `text-sm text-muted-foreground` |
| Gradient page title | `text-3xl font-bold bg-gradient-to-r from-primary to-primary-foreground bg-clip-text text-transparent` |
| Empty state | centred icon in a tinted tile or circle, semibold title, muted one-liner; often inside a dashed-border box |
| Toast | `fixed bottom-4 right-4 rounded-lg border bg-background p-3 shadow-lg animate-in slide-in-from-bottom-2 duration-300` |

### 7.3 Type, radii, heights

- **Type:** Arial throughout. Sizes 12 px (labels, tabs, badges), 14 px (UI text), 16 px (body), 24 px (section titles), 30 px (page titles). Weights 400 / 500 / 600 / 700. Mono for keys.
- **Radii:**
  - 4 px: key chips
  - 6 px: buttons, inputs, menu items, badges
  - 8 px: toast, sidebar trigger, tab triggers
  - 12 px: cards, tab lists
  - full: view tabs, project switcher, pills
- **Heights:**
  - 32 px: sidebar items and search
  - 36 px: controls
  - 48 px: org switcher and user pill
  - 52 px: top bar

### 7.4 Contrast (WCAG 2.x, from the measured colours)

| Pair | Ratio | AA (4.5 : 1) |
|---|---|---|
| White on primary `#dd6efc` (active tab, primary buttons, count badges) | 2.72 : 1 | **fails** |
| Destructive `#a92727` text on background (expired banner) | 2.41 : 1 | **fails** |
| Muted `#9aa2b1` on background / card | 6.55 / 5.79 : 1 | passes |
| Primary `#dd6efc` text on background / card | 6.17 / 5.46 : 1 | passes |
| Foreground on background / card | 15.01 / 13.28 : 1 | passes |
| Black on yellow In Progress pill | 10.95 : 1 | passes |
| White on destructive / on Today pill | 6.98 / 6.70 : 1 | passes |
| Amber notice text on its box | 9.37 : 1 | passes |

---

## 8. Subscription-restricted ("read-only") state

The screenshot account's Free plan is marked Expired. Observed effects:

| Surface | Effect | Evidence |
|---|---|---|
| Any page | Red "Subscription Expired" banner (dismissible) with "Upgrade Now" | shot 941; root layout [grep] |
| Team | PLAN tag "Expired"; Import and Invite disabled | shot 940 |
| Files | Read-only notice in the upload zone; "Browse files" disabled | shot 934; chunk 146 [grep] |
| Groups | Amber notice box and amber empty-state line; "New group" and "Create first group" disabled | shot 942 |
| List, Roots | "Add Task" disabled | shots 928, 931; chunk 6021 [grep] |
| Task dialogs, Calendar | read-only string present in code | chunks 3700, 7329 [grep] |
| Profile | skill "Add" disabled | shot 956 |

- **Disabled styling:** shadcn `disabled:opacity-50` + `disabled:pointer-events-none` [dom].
- **What stays available:** reading, navigation and analytics [shots 927–937].
- **[inferred]** When the organisation's subscription lapses, LTD keeps all data visible and blocks creation and uploads. Server-side enforcement is not observable.

---

## 9. Defects and inconsistencies observed (do not replicate)

1. **Contradictory subscription state.**
   - Team shows "Free · Expired" with next billing Sep 11, 2026, and Projects shows the expired banner.
   - Billing shows "Active until 4/11/2026" and "You have an active subscription" [shots 940, 941, 957].
   - **[inferred]** Billing reads the user's own subscription record, while Team and the banner read the organisation's (report §6.9 has both `my-subscription` and `{org}` endpoints). The date `4/11/2026` is also ambiguous (4 Nov or 11 Apr).
2. **"Users 1 / undefined"** on Billing: a missing user limit is rendered as `undefined` [shot 957].
3. **Trailing colons with no value** in the plan feature list ("Basic analytics:", "Email support:") [shot 957].
4. **Plural errors:** "1 members", "1 active members" [shot 945].
5. **Contradictory goal status:** "On Track" while counted at risk and 40 days overdue [shot 939].
6. **FAQ claims features** (sprints/backlogs, Scrum boards) that the code does not show [shots 950–951; report].
7. **Two contrast failures** (§7.4).
8. **shadcn template leftovers** in the sidebar module [report §3.3].

---

## 10. Corrections

### 10.1 To `LTD_frontend_reverse_engineering.md`

| Report says | This pass shows | Evidence |
|---|---|---|
| Upgrade to Pro: no shortcut | Shift+U | shots 927, 954 |
| "Go to today": no shortcut | T (Timeline scope); also D daily, M monthly | shot 954; grep 3453 |
| — (missing) | Switch to Settings Shift+S; Toggle dark mode Alt+Shift+Z | shots 953–954; grep 3453, root layout |
| Calendar grid chunk not identified; "Month / Workweek / Day" unverified | Calendar is chunk 7329; modes Month, Week, Day, Agenda, Year (no Workweek) | shot 933; grep 7329 |
| `--primary 287 96% 71%` (= `#d86dfc`) | the token renders `#dd6efc`; `#d86dfc` is a separate literal | pixel, dom |
| Settings tabs: General, Appearance, Keyboard Shortcuts, Integrations, API tokens | four tabs; Appearance is inside General | shot 958 |
| Roots node colours unverified | legend: priority and status colours on nodes; links coloured (parent-child blue, perspective `#d86dfc`) | shot 931 |
| My Tasks tabs: Pending / Overdue / Due Today / Upcoming | plus an all-tasks "My Tasks" tab | shot 938 |
| Goals: title, target, deadline | plus Project vs Personal scopes and summary counts | shot 939 |
| Plans: prices only | limits per plan (§5.8) | shot 945 |
| `--sidebar-*`: "dedicated sidebar palette" | the sidebar background equals the card colour `#27272b` | pixel, dom |

### 10.2 To `docs/ui-reference.md`

`ui-reference.md` is Workspace v1's own design spec, so deliberate departures from LTD are expected. Only its statements about **what the screenshots show** are corrected here.

| ui-reference says | The screenshot shows |
|---|---|
| Canvas `#0d0f12`, sidebar `#0b0d10`, panel `#14171e` | LTD renders background `#1d1d20`, sidebar and cards `#27272b` |
| Accent buttons use dark text `#0d0614` | LTD uses white text on `#dd6efc` (2.72 : 1) |
| Accent presets Orchid / Sky / Emerald / Rose / Amber | LTD has a colour picker, hex input and Reset only (946, 958) |
| 940: "3 / 10 seats" | 1 / 3 seats on Free |
| 941: project cards with key badge and task metrics | cards show Owned and ID badges and the project lead; no task metrics |
| 942: Teams / org-tree split pane | Groups "Team map" directory with filters; no tree |
| 943: Ask AI (P1) with citation chips | "Ask Your Project" chat with suggested-question pills; no citations |
| 949–951: FAQs on AI notes, approvals, retention | general product, features, agile and dashboard FAQs |
| 955: Profile, Settings, Sign out | Profile, Upgrade to Pro, Billing, Settings, Log out |
| 956: timezone and notification preferences | Username, Email, Full Name, Bio, Skills |
| 958: organisation controls | Theme, list-description toggle, list preview |
| 930–937, 939, 944, 945, 957 not mapped | mapped in §2 |

---

## 11. Unknowns and gaps

- **Unexplained controls:** the contents of "More" and how Analytics is opened; the List "…" menu and "Task Type" control; the Timeline eye toggles; Calendar "Focus" mode; the gap in the Analytics widget grid.
- **Populated states:** task cards, rows and nodes; charts with data; the goal mood-emoji scale; workload bars at other loads.
- **Screens not captured:** login / sign-up / verify / onboarding, My Assistant, Standups, team performance, project detail `/dashboard/projects/:id` (plus custom fields and forms), Nexus with data, superadmin, public profile, support.
- **Interaction:** hover, focus and pressed states, and motion (framer-motion variants exist, report §7).
- **Other themes and sizes:** the light theme (only dark was observed), and mobile layout below 768 px beyond the hidden sidebar.
- **Fonts:** the italic face on the motivational card is unverified (body text computes to Arial).
- **Live-DOM coverage:** only the shell, the Nexus upsell, the empty Projects page and My Tasks. Class-level detail for the workspace views comes from screenshots, not the DOM.

---

## 12. REA status and investigation checklist

**REA status.**
- **Registration:** the REA MCP server is registered in `~/.claude.json` as `npx -y rea-agents@6.5.0 mcp`. It failed to connect this session (startup timeout).
- **Diagnosis:** running `rea doctor` through the same npx spec fails with `ERR_MODULE_NOT_FOUND`.
  - In npx cache folder `_npx/ad9a3fdbcad992c6`, `@jridgewell/sourcemap-codec@1.6.0` declares `exports.import → ./dist/sourcemap-codec.mjs`, but that file is missing.
  - Two sibling installs of the same version (`af752b90…`, `9b980929…`, created minutes earlier on 2026-10-15) are complete, so this is an interrupted extraction.
- **Fix:** delete that cache folder (≈ 110 MB) and reconnect the `rea` server. Not done here, because it is outside the repository.
- **Effect on this report:** REA has no route for images. Its browser tools would only add Evidence IDs to runtime captures. Evidence in this document is therefore labelled screenshot, pixel, DOM or grep, never REA Evidence.

**Investigation checklist.**

| Question | Status | Where |
|---|---|---|
| What each page and view looks like | Answered for 23 screens + Nexus | §4–6 |
| Shell layout and structure | Answered (DOM-measured) | §3 |
| Colours, type, spacing, components | Answered: exact for the shell and headers, approximate inside views | §7 |
| What each page does | Answered at UI level; populated behaviour partly | §4–6, companion report |
| Behaviour under plan limits | Answered for the expired-Free state | §8 |
| Remaining screens and states | Unresolved | §11 |
