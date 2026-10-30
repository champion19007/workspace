# Product and architecture review (October 2026)

A pass over the web app as a project manager and as a solo freelancer would use it, plus a review of the code
for bugs and design faults. Fixes are on branch `claude/upbeat-jemison-2f0f25`; what's left is listed with a
recommendation.

## Can a PM or a freelancer use it?

**Yes, for planning and tracking work.** Projects grouped in teams, tasks with owners, priorities, due dates,
labels and subtasks, list and board views, docs with version history, My tasks, and Insights (which projects
are at risk, what's overdue or blocked). Sign-in is by email link or Google, anyone can sign up and create
an organization, and Owners and Managers invite people from People at one of five access levels.

## Access levels

| Level | Stored role | Can do | Sees |
|---|---|---|---|
| Owner | `owner` | Everything, including making other Owners and Managers | Everything |
| Manager | `admin` | Invite and remove people, choose which projects each client sees, all project work | Everything |
| Developer | `member` | Create and update projects, tasks and docs | Public projects, and private ones they're on |
| Executive | `viewer` | Nothing (read-only) | The **Progress** page for every project, each project's Overview and Docs |
| Client | `client` | Nothing (read-only) | The same Progress view, for only the projects an Owner or Manager ticked under **Choose projects** |

Executives and Clients are locked to the Progress view: any other page sends them back to it, and the sidebar,
search and project tabs only offer what they can open. The real enforcement is on the server: every change is
refused for both levels, and for clients the database itself (row-level security, migration `0016`) hides other
projects, their tasks, docs and activity, plus meetings, task comments and the member list. A level changes only when an
Owner or Manager changes it on People. The server reads the level on every request, so a change applies at once,
and the person's screens follow on their next page load.

Added since this review (migrations `0017`–`0020`): comments with @mentions on tasks, docs and each project's
Discussion (executives and clients can comment on projects and docs); an in-app notification bell; project files and
task attachments; Calendar and Timeline tabs with task start dates; public request forms that feed the Inbox; and AI
helpers (notes from a pasted transcript, a plain-words summary on Progress, and Ask AI with cited sources).

What they will still miss, most important first:

1. **Emails.** Invitations, notifications and replies to request-form senders all stay inside the app: the app
   gives you links to send yourself.
2. **Who hears about a comment.** `commentRecipients()` in `packages/core/src/comments/index.ts` decides it and
   is still a placeholder, so comments notify no one yet (mentions included).
3. **Reminders** before due dates.
4. **Bigger files.** Uploads pass through the web server, so the limit is 4 MB per file (Vercel's request body
   limit). Signed direct-to-storage uploads would lift it.
5. **Time tracking and invoicing**, which many freelancers expect.

## Fixed in this pass

| Problem | Effect | Fix |
|---|---|---|
| A new organization had no team, and projects must belong to one | The first "New project" said *Create a team first* | New organizations start with a **General** team |
| Project health in lists was read from a stored summary that only a background worker updates | On Vercel (no worker) the sidebar, Home and project header kept saying "No tasks" after tasks were added | `listProjects` now repairs stale summaries when it reads them, as Insights and the project overview already did (test: `project-list-health.test.ts`) |
| The app shell didn't reload project health after task changes | Header and sidebar lagged until a reload | Creating, editing, completing, moving or archiving a task refreshes it |
| Meetings and Home told people to connect Zoom on deployments where Zoom import can't run | A dead end for every new user on Vercel | They say plainly that meeting import isn't set up |
| "Today" was fixed to India time everywhere | Outside India, tasks turned overdue during their due day | `NEXT_PUBLIC_APP_TIME_ZONE` sets the zone for server and browser alike (default unchanged) |
| No security headers | Other sites could frame the app (clickjacking) | `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, HSTS and a permissions policy |
| `zoom-journey.test.ts` deleted every organization's Zoom data | Running tests broke local demo data and hid all review suggestions | Cleanup is limited to the suite's own organizations |
| No guidance for first-time users | People had to discover teams, projects, the board and docs on their own | A **Get started** checklist on Home that ticks itself off from real data, and a short guide at the top of Help |
| Viewers saw every create, edit and move control, and the doc editor (its read-only flag was never passed) | Non-technical people got a builder's interface whose every action failed | Executives and Clients get the read-only Progress view described above |
| A client could only join as a viewer, which sees every public project | Agencies couldn't let one client follow their project without showing them the others | The Client level, scoped in the database to chosen projects |
| Any member could add anyone to any public project's member list | Project membership wasn't controlled | Read-only levels can't, and only Owners and Managers can add a client |

## Design and architecture findings still open

1. **Two backends for the same data.** The Next.js routes in `apps/web/src/app/api` and the Fastify API in
   `apps/api` both implement organizations, members and tasks on top of `@workspace/db`, and they have already
   drifted once (invitations existed only in the API until the web got its own routes). Pick one backend for the web app: either keep the Next.js routes
   and retire the overlapping API routes, or have the web call the API.
2. **Background features need a worker that Vercel can't host.** Meeting intake, AI notes and suggestions, the
   outbox relay and scheduled rollups run in `apps/worker`. Project health now repairs itself on read, but
   meetings can't. To turn them on, host the worker (Railway, Fly.io, Render or similar) with a session-mode
   database URL and a durable secret store for Zoom tokens.
3. **One time zone per deployment.** Now configurable, but a team spread across time zones still shares one
   definition of "today". A per-user (or per-organization) time zone would fix that.
4. **No live updates.** Other people's changes appear on reload. Conflicting edits are caught by version checks
   and a "keep mine / use theirs" prompt, so nothing is lost, but teams would benefit from polling or Supabase
   Realtime on the board and task lists.
5. **No rate limiting on the API.** Sign-in emails rely on Supabase's limits; other routes have none. The public
   request form has a honeypot and a per-server-instance limit, which slows a single bot but not a determined one.
   Add Vercel firewall rules or a shared rate limiter before a public launch. The AI routes have no per-organization
   spending cap yet (the summary is reused for an hour per person).
6. **The rollup repair logic exists three times** (`getPermissionSafeRollup`, `getLeadershipSummary` and the new
   `ensureFreshProjectRollup`). Move the first two onto the helper.
7. **Doc list previews show raw Markdown** (`- [ ]`, table pipes) because the excerpt is cut from the source text
   on the server. Strip Markdown when building the excerpt.
