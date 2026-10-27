# Product and architecture review (October 2026)

A pass over the web app as a project manager and as a solo freelancer would use it, plus a review of the code
for bugs and design faults. Fixes are on branch `claude/upbeat-jemison-2f0f25`; what's left is listed with a
recommendation.

## Can a PM or a freelancer use it?

**Yes, for planning and tracking work.** Projects grouped in teams, tasks with owners, priorities, due dates,
labels and subtasks, list and board views, docs with version history, My tasks, and Insights (which projects
are at risk, what's overdue or blocked). Sign-in is by email link or Google, anyone can sign up and create
an organization, and owners and admins invite teammates (or a client, as a viewer) from People.

What they will miss, most important first:

1. **Invitation emails.** Inviting works, but the app gives you the link to send yourself.
2. **Comments and @mentions on tasks.** Discussion has to happen elsewhere.
3. **Notifications and reminders.** Nothing emails people about assignments or due dates.
4. **File attachments** on tasks and docs.
5. **Timeline or calendar views** for planning by date.
6. **Time tracking and invoicing**, which many freelancers expect.

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
5. **No rate limiting on the API.** Sign-in emails rely on Supabase's limits; other routes have none. Add Vercel
   firewall rules or a small rate limiter in middleware before a public launch.
6. **The rollup repair logic exists three times** (`getPermissionSafeRollup`, `getLeadershipSummary` and the new
   `ensureFreshProjectRollup`). Move the first two onto the helper.
7. **Doc list previews show raw Markdown** (`- [ ]`, table pipes) because the excerpt is cut from the source text
   on the server. Strip Markdown when building the excerpt.
