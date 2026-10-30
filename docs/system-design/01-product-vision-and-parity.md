# 01 — Product vision and Atlassian parity

## 1.1 The product in one paragraph

**One workspace for every role: developers, non-technical PMs, founders, freelancers and their clients work on
the same tasks, each in a view built for how they work, so teams don't need two tools or someone copying
updates between them. The easy, affordable starting point before (or instead of) Atlassian.**

It covers what Jira (tasks, boards, timelines, workflows, dashboards, automation), Confluence (docs with version
history and comments), Atlassian Goals and Teams, and Jira Service Management's request forms do, in one product.
It also turns meetings into work: a recording's transcript becomes notes and suggested tasks, and a person
approves each one before it lands in the right project.

## 1.2 Why one product for every role

Small teams that mix developers and non-developers usually end up with two tools:

- **Developers dislike manager-style tools.** They want the keyboard, Markdown, Git links and an API; boards full
  of colour and forms slow them down.
- **Non-technical people dislike Jira-style tools.** Issue types, schemes, JQL and sprint jargon make a simple
  "what's late and who's on it" hard to answer.

So the developers live in Linear or GitHub Issues, everyone else in Asana, Notion or a spreadsheet, and someone
(usually the PM or the founder) copies status between them. That copying is the cost this product removes.

**The rule: one data model, many views.** Every role edits the same task, project and status records. Views
differ in vocabulary, density, defaults and which fields show; **data never forks**. When a developer's pull
request is merged and the task moves to Done, the PM's board, the founder's progress page and the client's
shared page all show it, with no one updating anyone by hand.

## 1.3 Personas

| Persona | Default view | Org role (stored) | What they need | What they must never see |
|---|---|---|---|---|
| **Startup team (2–15 people, devs and non-devs together)** — *first target group for launch* | Dev view for engineers, PM view for everyone else | Owner / Manager / Developer | One place for the backlog and the plan; Git activity moving tasks; a board non-devs can read; meetings turning into tasks | — |
| **Solo developer** | Dev view | Owner | Keyboard-first task list, Markdown, GitHub links, MCP from the editor, no ceremony | — |
| **Freelancer (with clients)** | Dev or PM view; clients get the Client view | Owner; clients as `client` | Projects per client, time tracking, a shared progress page per client, decisions and files the client can see | Client sees only items marked *shared* |
| **Non-technical PM** | PM view | Manager (`admin`) | Board, list, timeline, "what's at risk", meeting notes → approved tasks, plain-language statuses | Schemes, WQL (unless they switch to Dev view) |
| **Founder** | Founder view | Owner or Executive (`viewer`) | Progress summary, goals, at-risk projects; no task-level noise | Edit controls they don't need |

The first launch focuses on **startup teams with both developers and non-developers**; the other personas are
served by the same views and get their extras in later phases (chapter 12).

## 1.4 Design principles

1. **One data model, many views.** No view has data the others can't see in their own words.
2. **Plain words in the PM and client views.** "Task", not "work item". "Who can see this", not "permission
   scheme". The Dev view may use technical names.
3. **Defaults that work on day one.** A new org starts with a *General* team (built), a project set up by AI from
   a description or a template, one workflow, the five built-in roles, and email notifications on.
4. **Progressive disclosure.** Power features exist, but behind *More options*, in the Dev view, or in admin
   settings, never in the main flow of someone who doesn't need them.
5. **Humans approve AI.** AI suggests; a person decides. No task, doc or status change is written by AI without
   a click (invariant 2 in the README; enforced in `packages/db/src/approval-operations.ts`).
6. **No fake data.** Empty states explain what to do next; they never show sample numbers (invariant 1).
7. **Cheap to run.** Every feature has a running-cost line (chapter 08). A feature that needs an always-on server
   or a paid third party must say so and degrade gracefully when that service is off.

## 1.5 Role-based views (replaces the Simple/Pro switch of revision B)

Revision B had a two-way Simple/Pro switch. Revision C replaces it with **views named after roles**. A view is a
presentation preference, stored per person per org; it never grants or removes access (the org role and project
role do that, chapter 09).

| Aspect | **Dev view** | **PM view** (non-technical) | **Founder view** | **Client view** |
|---|---|---|---|---|
| Home | My issues, sorted by priority; recent PRs | For you: my tasks, what's at risk, approvals waiting | Progress summary, goals, at-risk projects | Shared progress page of their project(s) |
| Main surfaces | List with keyboard navigation, backlog, sprints, command palette | Board, list, timeline, calendar, meeting notes → approved tasks | Progress, Goals, Insights | Milestones, decisions, shared files, request form, comments marked *shared* |
| Text | Markdown everywhere (descriptions, comments, docs) | Same Markdown, rendered; toolbar for formatting | Read-only | Read-only, plus comments |
| Statuses | The workflow's own names | Plain-language translation (§1.6) | Category only: Not started / In progress / Done, plus *at risk* | Not started / In progress / Done / On hold |
| Filtering | WQL with autocomplete, saved filters | Chips (*Mine*, *Overdue*, *This week*) and "Ask in words" | none | none |
| Status changes | Driven by Git activity (branch → In progress, PR open → In review, merge → Done) plus keyboard | Drag on the board, status button | none | none |
| AI | MCP from Claude Code / Cursor / VS Code; AI project setup | AI project setup, Ask AI, meeting notes | Plain-words progress summary, Ask AI | Progress summary for their project, Ask AI within it |
| Admin screens | Workflows, fields, automation, webhooks, API tokens (if the role allows) | Members, projects, templates, recipes (if the role allows) | none | none |
| Density | Compact rows (32 px) | Comfortable rows (44 px) | Cards | Cards |

**Rules**

- Stored as `memberships.view varchar(10) NOT NULL` with `CHECK (view IN ('dev','pm','founder','client'))`
  (chapter 04 §4.4). It lives on the membership because one person can be a developer in their own company and a
  client in someone else's.
- Defaults by role: Owner and Manager → `pm`, Developer → `dev` if they connect GitHub during onboarding,
  otherwise `pm`; Executive → `founder`; Client → `client`.
- Owners, Managers and Developers may switch between Dev, PM and Founder views at any time (account menu). The
  Executive and Client roles are locked to their view, as the Executive/Client Progress lock already works today.
- Switching never changes data. Something created in the Dev view (a custom status "In review", a WQL filter)
  appears in the PM view through its translation or as a saved view with a plain name.

## 1.6 Status translation

Each workflow status has a **category** (`todo | in_progress | done`, what all counting uses, chapter 04 §4.5)
and a **stage** that says what the status means. Each view turns the stage into its own words; custom status
names show as-is only in the Dev view.

| Stage (stored) | Category | Dev view (default name) | PM view | Founder view | Client view |
|---|---|---|---|---|---|
| `backlog` | todo | Backlog | Later | Not started | (hidden unless shared) |
| `todo` | todo | Todo | To do | Not started | Not started |
| `in_progress` | in_progress | In progress | Doing | In progress | In progress |
| `in_review` | in_progress | In review | Almost done | In progress | In progress |
| `blocked` | in_progress | Blocked | Waiting on {owner of the blocking task, or "someone"} | In progress, counted as *at risk* | On hold |
| `done` | done | Done | Done | Done | Done |
| `cancelled` | done | Cancelled | Dropped | (not counted) | (hidden) |

```ts
export const Stage = z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled']);
export type View = 'dev' | 'pm' | 'founder' | 'client';

/** One function, used by every view and by email/notification text, so the words never drift apart. */
export function statusLabel(status: { name: string; stage: Stage }, view: View, ctx: { blockerOwner?: string }): string;
```

A workflow template sets the stage of each status; an admin who adds a custom status picks its stage from this
list (default: same as its category). "Waiting on Meera" comes from the open `blocks` link (chapter 04 §4.8),
which is why `blocked` is a stage and not just a word.

## 1.7 Before Atlassian, or instead of it

- **Easy to start.** Sign up, describe the project, approve the AI's proposed setup, invite the team. No schemes
  to configure first.
- **Easy to leave.** A full export at any time: JSON + Markdown + files, and a **Jira-compatible CSV export**
  (columns named as Jira's CSV importer expects: Summary, Description, Issue Type, Status, Priority, Assignee,
  Reporter, Labels, Due Date, Parent, Sprint) so a team that outgrows us can move without retyping. Chapter 06
  §6.5 `/exports` gains `kind = 'jira_csv'`.
- **Good enough that most small teams never need to move.** The parity catalogue below decides, screen by screen,
  what to build, simplify or skip so that stays true.

## 1.8 How the screenshots were read (Atlassian parity catalogue)

The 456 screenshots (`C:\Users\champ\Pictures\atlassian\Screenshot (4).png` to `(459).png`) were grouped by
screen. The table below gives each group, what it shows, and the decision for this product. The *Ref* column
gives the screenshot numbers so a developer can look at the original.

### 1.8.1 Jira onboarding and first project

| Ref | Atlassian screen | What it does | Decision | Priority | Status here |
|---|---|---|---|---|---|
| 4–13 | "What kind of work do you do?" | Pick Software, Marketing, Design, Operations, Project/Product management, Customer service, Other; the preview image changes per choice | **Build, simplified.** Describe the project in a sentence or two and the AI proposes its structure, statuses and starter tasks for approval (fast tier); or pick a job template | P0 | Partial: onboarding creates an org and a General team; no template choice |
| 14 | Name your first project | Name + generated key, examples | **Build.** Key (`ENG`, `MKT`) is generated from the name and editable in the Dev view only | P0 | Built (`nodes.key_prefix`, `project_key_counters`) |
| 15 | Select work types | Feature, Task, Story, Request, Bug, Epic… | **Simplify.** PM view has one type, *Task*, plus *Milestone*. Dev view enables types | P1 | Missing |
| 16 | How do you track work? | Editable list of statuses (To Do, In Progress, In Review, Done) | **Build.** This is the workflow template step | P0 | Missing (statuses are fixed) |
| 17 | Setting up your project… | Progress spinner | Build (trivial) | P0 | — |
| 18–20 | Welcome to Jira carousel | Free plan limits, unlimited spaces, multiple views | **Build** as a 3-card *What you can do* intro, skippable | P2 | Built differently: *Get started* checklist on Home |

### 1.8.2 The project ("space") and its views

| Ref | Screen | What it does | Decision | Priority | Status |
|---|---|---|---|---|---|
| 21, 24–26 | Space header with tabs **Summary, List, Board, Calendar, Timeline, Docs, Forms, +** | One project, many views of its tasks | **Build all.** Add *Files* and *Requests* tabs (already built) and *Progress* | P0 | Built: Overview(dashboard), List(tasks), Board, Calendar, Timeline, Docs, Files; Forms built as request form settings |
| 24 | List: Search work, people filter avatars, Filter, Group, column picker, inline **+ Create** row | Spreadsheet-like list | **Build:** grouping (by status, owner, priority, due week, label), column picker, inline create | P0 | Partial: list with filters and sort; no grouping or column picker; no inline create |
| 24 | Share, Automation (⚡), Feedback, Full screen buttons | Header actions | **Build** Share (copy link; for clients, *Share progress link*) and Automation shortcut | P1 | Missing |
| 25 | Starred | Star a project or filter | **Build** (per-person favourites) | P1 | Missing |
| 22–23 | **For you** home: greeting, *Find a space*, Recent, Recommended, *Assigned to me / Starred / Worked on / Viewed* tabs | Personal landing page | **Build.** Home already has Get started + My work; add Recent and Starred tabs | P0 | Partial |

### 1.8.3 Apps, sidebar, personal settings

| Ref | Screen | What it does | Decision | Priority | Status |
|---|---|---|---|---|---|
| 27–33 | Explore apps (marketplace) | Third-party apps (ScriptRunner, Tempo, draw.io, Xray…) | **Skip a marketplace.** Instead: a fixed *Integrations* page (Zoom, Google Calendar, Slack, Google Drive, GitHub, email) and outbound webhooks + public API for everything else | P3 (marketplace) / P1 (integrations page) | Partial: Zoom only |
| 34–36 | Spaces directory with templates panel | List of projects with key, type, lead; create from template | **Build:** Projects page with template gallery | P0 | Partial: Projects page without templates |
| 37–40 | Customize sidebar | Show/hide/reorder sidebar entries | **Build, small:** per-person hide/reorder stored in `user_preferences.sidebar` | P2 | Missing |
| 41–42 | App switcher (Home, Jira, Loom, Bitbucket, Goals, Teams, Projects…) | Cross-product launcher | **Not needed** — one product. The sidebar sections play this role | — | — |
| 43 | Settings menu (Personal settings, Jira admin settings, Atlassian admin) | Entry points | **Build** as account menu → *My settings*, *Organization settings* | P0 | Built (settings page + drawer) |
| 44 | Personal settings → General: time zone, language, *watch your own work items*, home page, **theme (Light/Dark/Match browser)** | Per-person preferences | **Build:** time zone per person (fixes the open finding "one time zone per deployment"), language (later), theme (built), default home page | P0 (time zone), P2 (language) | Partial: theme built; time zone per deployment only |
| 45 | Jira labs | Opt-in previews | **Skip** — use feature flags internally | P3 | — |
| 46–48 | Email and notifications: per event type, *in product* vs *email*, batching ("group emails every 5 minutes"), HTML/text | Notification preferences | **Build, simplified:** three switches (mentions, requests, daily digest) — already in `0021`; later a per-event matrix in the Dev view | P0 | Built (`notification_preferences`, `0021`; switches on Profile; one-click unsubscribe) |
| 49 | Digest notifications: due/overdue items daily, weekly update | Digests | **Build:** daily digest at the person's 09:00 local time; weekly summary for Executives | P0/P1 | Daily digest built at a fixed 09:00 IST (03:30 UTC); per-person time and weekly summary missing |

### 1.8.4 Organization admin ("Jira admin settings")

| Ref | Screen | What it does | Decision | Priority | Status |
|---|---|---|---|---|---|
| 50 | System → General configuration: title, mode, internationalization, indexing language | Org-level settings | **Build:** org name, logo, default time zone, week start, date format, default language | P1 | Partial (name only) |
| 51–52 | Options: voting, watching, unassigned items, max space name length, *allow sharing filters and dashboards with public*, comment visibility, inline edit, time-tracking, JQL autocomplete, **contact administrator form**, @mention suggestions, reactions | Many toggles | **Build only:** watching (yes), reactions on comments (yes), public sharing of dashboards (Owner toggle, default off). Skip voting | P1–P2 | Missing |
| 53 | Beta features | New list view, etc. | Skip (feature flags) | P3 | — |
| 54 | Audit log (paid) | Admin change history | **Build** (we already have `activity_log`); expose an *Audit log* page to Owners | P1 | Partial (table exists, no page) |
| 55–59 | Access: space roles, Manage options, *Default permission scheme*, filter by space/role/user | Who has which role in each project | **Build simplified:** per-project member list with role override (Manager / Contributor / Viewer). Dev view: permission schemes (chapter 09) | P1 | Partial: `node_members` for private projects only, no per-project role |
| 60 | Space roles (Administrators, atlassian-addons, Member, Viewer…) | Role definitions | **Build** fixed project roles; custom roles P3 | P1 | Missing |
| 61–67 | Global permissions (Administer Jira, browse users, share dashboards, bulk change, create team-managed spaces…) with Grant Permission | Org-wide abilities per group | **Build as role capabilities**, not editable grants; the matrix is in chapter 09 | P1 | Built as fixed role checks (`packages/core/src/auth/roles.ts`) |
| 68 | Work item collectors | Embeddable feedback widget | **Build** as the existing public **request form**, embeddable via `<iframe>` or script | P1 | Partial: public form page `/r/[token]` built; no embed snippet |
| 69–85 | **Automation**: flows, templates by category (Rovo AI agents, Loom, Strategy, Service management, Manage completed tasks, Organize tasks, Issue transitioning, Productivity, Release management, Developer tools, Design), filters by apps and triggers, **Usage** (automation steps per month, credits), **Audit log** with statuses | Rule-based automation | **Build** — chapter 07. Start with ~15 triggers and ~20 actions; gallery of recipes | P1 | Missing |
| 84–183 | Automation audit log filters listing **~500 actions** (AWS, Azure, GCP, Docker, PagerDuty, Salesforce, Zendesk, Teams…) and **~60 triggers** | Connector catalogue | **Skip almost all.** Keep: send email, send Slack/Teams message, send web request (webhook), create/update task, comment, assign, transition, create doc page, ask AI. The web-request action covers the long tail | P1 (core) / P3 (connectors) | Missing |
| 186–188 | Audit log statuses: Config change, Success, No actions performed, In progress, Waiting, Queued for retry, Loop, Throttled, Some errors, Failure | Execution outcome enum | **Adopt this enum exactly** for `automation_runs.status` | P1 | Missing |
| 189–197 | Flows list, *AI-created flows built in Studio*, *Create with Rovo* | Rule list, AI builder | **Build** rule list; AI builder = "Describe what should happen" → draft rule for a human to save | P2 | Missing |
| 198 | User default settings: email format, items per page, default sharing for filters, autowatch | Org defaults for new people | **Build** inside org settings | P2 | Missing |
| 199–207 | Default dashboard with **gadgets**: Introduction, Assigned to me, Activity stream, Projects, Your company; *Add gadget* gallery (Activity stream, Assigned to me, Average age chart, Created vs resolved, Filter results, Heat map, Pie chart, Recently created, Resolution time, Sprint burndown, Sprint health, Time since chart, Two-dimensional statistics, Watched items, Work item statistics, Voted items…) | Configurable dashboards | **Build** dashboards with ~10 gadgets (chapter 04 §4.11, chapter 05 §5.8). Insights page is the built default dashboard | P1 | Partial: Insights (leadership) page and project dashboard, fixed layout |
| 208–209 | Look and feel: logo, site title, favicon, navigation colours, date/time formats | Branding | **Build:** logo + accent colour (accent is built per person; make it org-level), date format | P2 | Partial |
| 210 | Announcement banner | Org-wide message | **Build** (tiny: one row in `org_settings`) | P2 | Missing |
| 211 | Backup manager | Export everything | **Build** as *Export my data* (JSON + Markdown + files ZIP); also covers the DPDP export right | P1 | Missing (planned stage 22) |
| 212–218 | Import (CSV, Trello, Asana, monday, ClickUp, Notion, Linear, Wrike, Smartsheet, Jira Server…) | Migration in | **Build:** CSV import first (with column mapping), then Trello and Asana (JSON exports) and Jira Cloud (CSV). These bring customers | P1 | Missing |
| 219–223 | Mail: global mail settings, outgoing mail, incoming mail handlers (create items from email), DMARC | Email in/out | **Build outgoing** (in progress in `0021`). **Incoming email → request** P2 via provider inbound parse | P0 / P2 | Outgoing built (Resend, two streams, SPF/DKIM/DMARC in deploy guide); incoming missing |
| 224–231 | Permission helper | "Why can't X see Y?" | **Build** — cheap and very useful for non-technical admins: pick person + project/task → explanation in words | P2 | Missing |
| 232–233 | Admin email audit | Which notifications bounced | **Build** from the email log (`email_deliveries`) | P2 | Missing |
| 234–237 | Admin search ("Search actions, settings…") | Command palette for admin | **Built** as the command launcher; extend with settings entries | P2 | Partial |
| 238–239 | Manage filters / dashboards (admin) | Find and reassign shared filters/dashboards | **Build** when filters and dashboards exist | P2 | Missing |
| 240–241 | Attachments settings: size limit, ZIP support | File limits | **Build:** per-plan size limit; direct-to-storage uploads (fixes the 4 MB Vercel limit) | P0 | Partial (4 MB) |
| 242–245 | Events: system events (Issue created, updated, assigned, resolved, closed, commented…) mapped to notification schemes | Event catalogue | **Adopt** as the `domain_events` catalogue (chapter 05 §5.10) used by notifications, automation and webhooks | P1 | Partial (`activity_log` verbs, outbox topics) |
| 246 | LexoRank management | Rebalancing the rank field | **Build** an internal job, not a screen: rebalance when a rank string passes 64 chars (chapter 05 §5.4) | P2 | Missing (ranks grow unbounded) |
| 247–257 | **WebHooks**: name, URL, secret, events (work item, comment, entity property, attachment, link, worklog, sprint, board, version, project, user, filter, configuration), JQL filter, exclude body | Outbound webhooks | **Build** (chapter 06 §6.9) | P1 | Missing |
| 258 | Space configuration: parallel sprints, store data on device, public forms toggles | Misc | Partial skip; keep *public forms allowed* toggle | P2 | — |
| 259 | Storage management | Usage per space | **Build** a storage meter per org and per project (needed for plan limits) | P1 | Missing |
| 260 | Custom onboarding (Loom link) | Admin-provided welcome | **Build:** Owner can add a welcome message + video link shown to new members | P3 | Missing |
| 261–262 | Application links, DVCS accounts (Bitbucket) | Dev integrations | **Build GitHub** in Phase 1 (branches/PRs linked by task key, PR status on the task, status moves on PR open/merge); GitLab and Bitbucket as later adapters. Skip generic application links | P0 (GitHub) / P3 (others) | Missing |
| 263–318 | Manage spaces, **Space templates** gallery by category: Software development (Kanban, Scrum, Top-level planning, Bug tracking, Cross-team planning), Service management (IT, HR, Facilities, Legal, Finance, Marketing, Analytics, Design, Sales), Work management (Project management, Task tracking, Process control, Go-to-market, UX design, Document management, Campaign management, Recruitment tracking, Budget planning, Procurement, Content management, Personal task planner, Financial close, Policy management, RFP process, Email campaign, Sales lead tracking, IP infringement, Employee review, Grant application, Nonprofit, Community), Product management (Product discovery, Roadmap, Prioritization, Portfolio, Hierarchy), plus space categories, Trash, Archive | Templates by job | **Build ~20 templates** as JSON seeds (workflow + fields + sample tasks + docs) — chapter 04 §4.15. This is the single most important onboarding feature for non-technical teams | P0 | Missing |
| 319 | Space categories | Group projects | Already covered by **teams** in the org tree (`nodes.kind = 'team'`) | — | Built |
| 320–323 | Trash, Archived spaces | Soft delete with restore | **Build:** archive (exists as `archived_at`) + Trash page with 30-day restore | P1 | Partial (archive only) |
| 324–335 | Work types, work type hierarchy (Epic > Story > Subtask), work type schemes, sub-tasks | Types and levels | **Build** `work_types` with levels 1 (milestone/epic), 0 (task), −1 (subtask) (chapter 04 §4.7) | P1 | Partial: subtasks (one level) built |
| 325–326 | Workflows, workflow schemes | Status flows per type | **Build** (chapter 04 §4.5, chapter 05 §5.3) | P0 | Missing |
| 327–335 | Screens, screen schemes, work type screen schemes | Which fields show on create/edit/view | **Simplify:** one *field layout* per project (ordered list of field ids + required flags). No separate screen schemes | P2 | Missing |
| 336–345 | Fields (87 system and custom fields: Approvals, Change reason/risk/type, Components, Development, Due date, Environment, Epic link/name/status, Flagged, Goals, Impact, Labels, Original estimate, Organizations, Parent, Priority, Progress, Remaining estimate, Request type, Satisfaction, Security level, Sentiment, Sprint, Start date, Story points, Team, Time spent, Vulnerability, Watchers…), field schemes | Field catalogue | **Build** built-in fields: start date, due date, priority, labels, parent, estimate, time spent, story points (Pro), team, watchers, flagged; plus custom fields (chapter 04 §4.6) | P1 | Partial (core fields) |
| 346–349 | Priorities (Highest, High, Medium, Low, Lowest with colours and icons), priority schemes | Priority list | **Keep fixed 4 levels** (`low, medium, high, urgent`) — enough; renaming allowed in the Dev view | P3 (customise) | Built (fixed) |
| 350–351 | Time tracking: provider, working hours per day (8) and days per week (5), display format, default unit | Time settings | **Build** with worklogs (chapter 04 §4.9); freelancers need it for invoicing | P1 | Missing |
| 352–353 | Work item linking: Blocks, Clones, Duplicate, Relates; add link type | Task relations | **Build** `task_links` with these four types | P1 | Missing (there is a `blocked` status instead) |
| 354 | Statuses: Open, In Progress, Reopened, Resolved, Closed, Building, Build Broken with category and workflows | Status list | Covered by workflow statuses | P0 | — |
| 355 | Resolutions | Why something is done (Fixed, Won't do, Duplicate…) | **Build small:** optional `resolution` on done tasks; PM view hides it | P2 | Missing |
| 356 | Work item security schemes | Hide specific tasks | **Skip** for now; private projects and the Client role cover most needs | P3 | — |
| 357 | Notification schemes | Which events notify whom | **Simplify** to per-person preferences + per-project watchers | P2 | Partial |
| 358 | Permission schemes | Per-project grant tables | Dev view only, P2 (chapter 09) | P2 | Missing |
| 359–360 | Apps management, OAuth credentials | App install and OAuth clients | **Build** OAuth/API tokens for the public API (chapter 06 §6.10) | P2 | Missing |

### 1.8.5 Create, feedback and help

| Ref | Screen | What it does | Decision | Priority | Status |
|---|---|---|---|---|---|
| 361–367 | Quick **Create** modal: space · type, Summary, description, chips for Automatic(type)/Parent/Labels/Due date/Team, *Create another*; tooltip "A simpler way to create" | Fast task creation | **Build** this exact pattern — it is the right one for non-technical users. Add *AI: split into subtasks* | P0 | Partial: `CreateTaskDialog` with full form |
| 368–369 | Share your thoughts (feedback) | In-app feedback | **Build** (post to an internal inbox) | P3 | Missing |
| 370–372 | Full create form (status, assignee, labels, start date, team, attachment drop zone, linked work items, reporter, flagged) | Full form | Behind *More options* | P1 | Partial |
| 373 | Help panel (what's changed, docs, community, keyboard shortcuts, feedback) | Help | Built (`help-drawer.tsx`) | — | Built |

### 1.8.6 Teams, people and Goals

| Ref | Screen | What it does | Decision | Priority | Status |
|---|---|---|---|---|---|
| 374–378 | Person profile: header image, overview, *Working with me*, recent work, teams, goals, projects, **kudos** | Profile page | **Build** profile with *about me*, working hours, time zone, current work, teams. Kudos P3 | P1 | Partial: profile page |
| 379–380 | Teams directory, *Bring everyone together onto one team*, create team | Teams | Built as org-tree teams; add team page with members | P1 | Built (tree) |
| 381 | People you work with | Directory | Built (People page) | — | Built |
| 382 | Kudos | Recognition | Skip | P3 | — |
| 383–394 | **Goals**: directory, following, status updates feed (On track / At risk / Off track / Pending), create goal (name, type objective/key result, target date by quarter/month, owner, access open/restricted), goal detail tabs: Overview (why it matters, how measured, key results), Updates (weekly status with target date change), Jira (linked work), Projects, Learnings, Risks, Decisions | OKRs and status updates | **Build** goals and goal updates (chapter 04 §4.12). It is exactly what executives want, and it pairs with the Progress view | P1 | Missing |

### 1.8.7 Atlassian account

| Ref | Screen | What it does | Decision | Priority | Status |
|---|---|---|---|---|---|
| 399–401 | Profile and visibility: photo, header, name, public name, job title, department, organization, based in, local time, *who can see* each field | Profile | **Build:** name, photo, job title, time zone, working hours; visibility = org members only | P1 | Partial |
| 402 | Email: change address, Google-connected account | Login email | Supabase/Cognito handle it; show read-only + *change via Google* note | P2 | — |
| 403–404 | Security: password, **two-step verification, passkeys**, **API tokens**, recent devices | Account security | Passwordless already; add **passkeys** (P2), **API tokens** (P1 for Pro), sessions list with *sign out everywhere* (bump `session_epoch`, already supported) | P1–P2 | Partial |
| 405 | Privacy, cookie preferences | Consent | Build cookie notice only if analytics cookies are added; today the app sets only first-party session cookies | P3 | — |
| 406 | Account preferences: language, time zone, delete account | Account | Time zone (P0, see above); delete account = DPDP erasure | P1 | Missing |
| 407 | Connected apps | OAuth grants | With API tokens/OAuth | P2 | — |
| 408 | Link preferences (URL/inline/card/embed display) | Smart links | **Build** link unfurl in docs/comments as *card* (title + favicon) — P2 | P2 | Missing |
| 409 | Product settings | Per-product prefs | Not needed | — | — |

### 1.8.8 Loom and Bitbucket

| Ref | Screen | What it does | Decision | Priority | Status |
|---|---|---|---|---|---|
| 410–418 | Loom library: videos, screenshots, archive, filters, 25-video free limit | Async video | **Do not rebuild Loom.** Allow **video files** in Files with browser playback, and **record a quick screen video** later (P3, `MediaRecorder` → direct upload). Transcribe uploaded videos with the same meeting pipeline (stage 21 "manual upload") | P2 | Missing |
| 419 | Meetings: connect Google/Outlook calendar, notetaker | Meeting recordings | **Our core feature.** Providers in order: Zoom (built, polish) → Google Meet → Microsoft Teams → Webex on demand (chapter 03 §3.4, chapter 12). Calendar mapping to projects later | P0 (Zoom) / P1 (Meet) | Built for Zoom (needs worker) |
| 420–421 | Watch later, Recent | Lists | Skip | P3 | — |
| 422–437 | Loom personal settings: profile, meeting recordings, push notifications matrix, integrations (link embedding in GitHub, Gmail, Docs, Jira, Notion, Slack…), quick record, keyboard shortcuts | Settings | Keyboard shortcuts page exists; integrations → see Integrations page | — | Partial |
| 438–454 | Loom workspace admin: users & groups (Creators, Viewers), workspace settings (general, security: public links, default permissions, private thumbnails; data retention, export activity log; integrations: Salesforce, Zoom, Slack; meeting recording access; language) | Admin | Map: **public link permission** (Owner toggle), **data retention** (exists: `orgs.retention_days`), **export activity log** (Audit log export) | P2 | Partial |
| 457–459 | Atlassian home, Bitbucket "join a workspace" | Launcher, code hosting | Skip | — | — |

## 1.9 What Atlassian has that we will *not* build

Saying no keeps the product simple and the bill small. The full "decided not to build yet" list, including
meeting-related items, is in chapter 12 §12.6.

- A third-party **app marketplace** and its ~500 connector actions. Outbound webhooks, a public API, the MCP
  server and a *Send web request* automation action cover the same ground for the few who need it.
- **Work item security levels**, **issue-level screens per transition**, **field contexts per work type**.
  Private projects, the Client role and one field layout per project are enough.
- **Voting**, **kudos**, **labs** and **application links**. (Git hosting links are no longer skipped: GitHub
  integration is Phase 1, chapter 12.)
- **Velocity charts** come late; sprints and a backlog are part of the Dev view.
- Rebuilding **Loom**. Video files and transcripts reuse the meeting pipeline.

## 1.10 What we do differently

Atlassian does offer meeting → notes → tasks: **Loom** records meetings and writes AI notes through a meeting bot
(from its Rewatch acquisition), notes can be stored in **Confluence**, action items can be turned into **Jira**
work items, and a **Rovo** agent answers questions. It takes several paid Atlassian products used together.

Our differences:

1. **One product instead of four.** Tasks, docs, meetings, goals and requests live in one place with one bill.
2. **Human approval before any task is created.** Every suggested task quotes the transcript lines it came from
   (`action_items.evidence` = `[{seq, quote}]`), is checked for duplicates against open tasks by vector similarity
   (cosine ≥ 0.85), and is written only after a person approves it.
3. **Tasks routed straight into the right project.** The routing step proposes the project from the meeting's
   topic and attendees; the host confirms only when confidence is low.
4. **Built for small mixed teams.** Role-based views (§1.5) and status translation (§1.6) let developers and
   non-developers share one plan.
5. **Client view scoped in the database.** A client sees only projects an Owner or Manager ticked, enforced by RLS
   (`0016_client_role.sql`), not by hiding buttons.
6. **Request forms that feed an Inbox**, open to the public with abuse limits, without a separate service-desk
   product.

## 1.11 Competitive landscape

Facts below are limited to what the product owner has confirmed; anything else is marked for verification before
it is used outside this document.

### LTD by Eshway (ltd.eshway.com) — direct competitor

- AI project manager, in beta. AI sets up projects and tasks from a description.
- List, board, timeline and dashboard views; AI delay and workload insights.
- A live MCP server (beta).
- Advertised integrations with Google, Microsoft and Atlassian. Per-user pricing.
- Targets PMs, business analysts and agile teams. No meeting features shown.

**What we must match:** fast AI project setup from a description (Phase 1, §12.4) and an MCP server (Phase 1).
Both are table stakes, not differentiators. **Where we differ:** meetings → approved tasks, role-based views for
mixed dev/non-dev teams, the client view, and docs.

### Atlassian

Covered in §1.10 and the screen-by-screen catalogue in §1.8. Our position: the easy starting point before
Atlassian, with a Jira-compatible export for teams that outgrow us (§1.7).

### Others (one line each; verify positioning before external use)

| Product | Side | Why a mixed team might still choose us |
|---|---|---|
| ClickUp | non-dev | One shared plan with a Dev view that developers accept, plus meetings → approved tasks |
| Notion | non-dev | Real task workflows and Git-driven status on top of docs, instead of docs with task tables |
| Asana | non-dev | Developers get Markdown, keyboard, Git and MCP in the same tool the PM uses |
| Monday | non-dev | Same as Asana; plus a client view scoped in the database |
| Zoho Projects | non-dev | Simpler start; meetings → tasks; role-based views |
| Linear | dev | Non-developers, founders and clients get views in their own language on the same issues |
| Plane | dev | Same as Linear; plus docs, meetings and a client view in one product |
