# Deploy the web app to Vercel

This puts the Workspace web app online so anyone can sign up, create an organization and use projects,
tasks, the board, calendar and timeline, docs, files, comments, request forms, the inbox and the AI helpers
(notes from a pasted transcript, the Progress summary and Ask AI). Sign-in uses Supabase (an email link or
6-digit code, and optionally Google). The database and file storage are Supabase. Email goes out through
Resend: invitations, @mentions, new requests and a daily summary.

What this setup does not include:

- **Zoom meeting import.** It needs the API and worker services (`apps/api`, `apps/worker`), a job queue and
  a secret store, which don't run on Vercel. Settings shows a note instead of a Connect button. Notes from a
  pasted transcript work without it. See [Later: the Zoom worker](#later-the-zoom-worker).

You need a GitHub repository with this code, a [Vercel](https://vercel.com) account, a
[Supabase](https://supabase.com) account, a [Resend](https://resend.com) account and a domain whose DNS you
can edit. Commands below are for PowerShell on Windows; on macOS or Linux use `export NAME="value"` instead of
`$env:NAME = "value"`.

## 1. Create the Supabase project

1. In Supabase, create a new project. Pick the region closest to your users and save the database password.
2. Check **Project Settings → Infrastructure**: Postgres must be **16 or newer** (new projects use 17).

## 2. Set up the database (once, from your computer)

1. In Supabase, open **Connect** and copy the **Session pooler** connection string. Its user is
   `postgres.<project-ref>` and its port is `5432`.
2. In the repository folder, run the migrations as the database owner:

   ```powershell
   $env:DATABASE_MIGRATION_URL = "postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
   pnpm install
   pnpm --filter "@workspace/db..." run build
   pnpm --filter @workspace/db run migrate
   ```

   The migrations create the tables, row-level security and a restricted login, `workspace_api`, that the
   app uses at runtime. **Run this step again after every update** that adds a migration (for example
   `0017`–`0021` for comments, files, request forms, the Progress summary, and email and rate limits); it only
   applies the new ones.
3. In the Supabase **SQL Editor**, give that login a password (any long random string; you'll need it in step 5):

   ```sql
   alter role workspace_api with password '<long random password>';
   ```

4. Turn off the Data API (**Project Settings → Data API**). The app talks to Postgres directly, and this keeps
   your tables off Supabase's public REST endpoint.
5. For files, create a storage bucket: **Storage → New bucket**, name it `workspace-attachments`, and leave
   **Public bucket** off. The app reads and writes it with the service role key (step 5); people only reach
   files through the app, which checks who can see each one.

## 3. Set up email

Use a subdomain for sending, such as `mail.yourcompany.com`, so email reputation problems can't touch the mail
you send from your main domain.

1. In Resend, **Domains → Add domain** and enter the subdomain.
2. Add the DNS records Resend shows at your DNS provider: an SPF record (TXT), a DKIM key (TXT on
   `resend._domainkey`) and an MX record for bounces. Wait until Resend shows the domain as **Verified**.
3. Add a DMARC record for your main domain if it doesn't have one. Gmail and Yahoo turn away bulk mail without
   it. Start in monitoring mode and tighten it once the reports look clean:

   | Type | Name | Value |
   |---|---|---|
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc-reports@yourcompany.com` |

4. Optional, for the best delivery of sign-in emails: verify a second subdomain (say `updates.yourcompany.com`)
   for notifications and set `EMAIL_FROM_NOTIFICATIONS` (step 5). If people mark a daily summary as spam, it
   then never slows down anyone's sign-in email.
5. **API Keys → Create API key** with *Sending access*. You need it twice: for Supabase (step 4) and for the
   app (step 5).

## 4. Set up sign-in

1. **Authentication → URL Configuration**
   - Site URL: `https://<your-app>.vercel.app` (your Vercel domain, or your own domain later).
   - Redirect URLs: add `https://<your-app>.vercel.app/api/auth/callback`. If you use preview deployments,
     also add `https://*-<your-vercel-team>.vercel.app/api/auth/callback`.
2. **Sign-in emails.** Supabase's built-in sender only allows a few emails an hour and is meant for testing.
   Send through Resend instead, under **Authentication → Emails → SMTP Settings**:

   | Setting | Value |
   |---|---|
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | the Resend API key |
   | Sender email | `no-reply@mail.yourcompany.com` |
   | Sender name | `Workspace` |

3. **Sign-in codes.** Under **Authentication → Emails → Templates → Magic Link**, add the code to the email, so
   people who open it on another device (or in an app's built-in browser) can type it instead:

   ```html
   <h2>Sign in to Workspace</h2>
   <p><a href="{{ .ConfirmationURL }}">Sign in</a></p>
   <p>Or enter this code: <strong>{{ .Token }}</strong></p>
   <p>The link and code work once. If you didn't ask to sign in, ignore this email.</p>
   ```

4. **Google (optional).** In Google Cloud, create an OAuth client of type *Web application* with the
   authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`. Paste its client ID and
   secret into **Authentication → Providers → Google**.

## 5. Create the Vercel project

1. In Vercel, **Add New → Project** and import the repository.
2. Set **Root Directory** to `apps/web` and keep "Include files outside the root directory" turned on.
   Install and build commands, and the daily job, come from `apps/web/vercel.json`.
3. Add these environment variables (for Production, and Preview if you use previews):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | Supabase **Connect → Transaction pooler** string, with the user changed to `workspace_api.<project-ref>` and the password from step 2.3. Port `6543`. |
   | `SESSION_SECRET` | 32 or more random characters. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
   | `AUTH_PROVIDER` | `supabase` |
   | `SUPABASE_URL` | **Project Settings → API**: Project URL |
   | `SUPABASE_ANON_KEY` | **Project Settings → API**: the public anon key (called the publishable key in newer projects) |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` (builds with the pnpm version pinned in `package.json`) |
   | `NEXT_PUBLIC_APP_TIME_ZONE` | Optional. Your team's time zone, for example `America/New_York` or `Europe/London`. It decides when a task counts as due today or overdue. Defaults to `Asia/Kolkata`. |
   | `STORAGE_PROVIDER` | `supabase`, for files. Without it, uploads are refused instead of being lost. |
   | `SUPABASE_SERVICE_ROLE_KEY` | **Project Settings → API**: the service role (secret) key. Server only: never put it in a `NEXT_PUBLIC_` variable. |
   | `LLM_PROVIDER` | `anthropic`, to turn on the AI helpers. Without it they answer "AI isn't set up". |
   | `ANTHROPIC_API_KEY` | An API key from [console.anthropic.com](https://console.anthropic.com). Notes use Claude Sonnet 5; Ask AI and summaries use Claude Haiku 4.5. |
   | `EMAIL_PROVIDER` | `resend`. Without it, no email goes out: invitations give you a link to send yourself. |
   | `RESEND_API_KEY` | The Resend API key from step 3.5. |
   | `EMAIL_FROM` | Who emails come from, on your verified domain: `Workspace <no-reply@mail.yourcompany.com>` |
   | `EMAIL_FROM_NOTIFICATIONS` | Optional (step 3.4): `Workspace <updates@updates.yourcompany.com>`. Defaults to `EMAIL_FROM`. |
   | `CRON_SECRET` | 32 or more random characters (same command as `SESSION_SECRET`). Vercel sends it to the daily job, which refuses to run without it. |
   | `APP_URL` | Optional. The address links in emails point to, such as `https://work.yourcompany.com`. Defaults to your project's production domain. |

4. Deploy.

The daily job (`/api/cron/daily`) emails each person a summary of what they haven't seen in the app, and clears
old rate-limit counts. It's scheduled for 03:30 UTC; on the Hobby plan Vercel runs it once a day at some point in
that hour. **Settings → Cron Jobs** shows its runs, and **Run** starts one now.

## 6. Check it works

1. Open your site, sign in with your email and create your organization. Try the code from the email as well as
   the link.
2. Invite a teammate: **People → Invite people**, enter their email and pick their access level (Manager,
   Developer, Executive or Client). They get an email with a link; you also see the link, in case the email goes
   astray. When they open it and sign in with that email address, they join your organization. The link works
   once and expires in 7 days. For a client, then use **Choose projects** on their card to pick what they see;
   until you do, they see nothing.
3. @mention the teammate in a comment: they get an email within a few seconds. Everyone can choose which emails
   they get on their **Profile** page, and every notification email has an unsubscribe link.
4. If pages fail to load, open the deployment's logs in Vercel. A message starting with
   *Production configuration is incomplete* lists exactly which variables are missing or wrong. The app
   refuses to run without real sign-in and its own session secret, so it can't be deployed in an unsafe state.

## 7. Before you invite customers

These run outside the code, in the services' dashboards.

- **Your own domain.** Vercel **Settings → Domains**. Then update Supabase's Site URL and Redirect URLs
  (step 4.1), and `APP_URL` if you set it.
- **Backups.** Supabase's Pro plan keeps daily backups for 7 days; add Point-in-Time Recovery if losing up to a
  day of work is too much. On the Free plan there are no backups you can restore, so take your own every week
  and keep them somewhere else:

  ```powershell
  pg_dump "$env:DATABASE_MIGRATION_URL" --format=custom --file "workspace-$(Get-Date -Format yyyy-MM-dd).dump"
  ```

  Files in the `workspace-attachments` bucket aren't in database backups. Restore a backup into a scratch
  project once, so you know the steps work before you need them.
- **Error alerts.** Errors already land in Vercel's logs, each with a code. To be emailed when they happen, add
  Sentry: create a Next.js project in Sentry, run `npx @sentry/wizard@latest -i nextjs` in `apps/web` (it adds
  its own config files), and set the `SENTRY_DSN` and `SENTRY_AUTH_TOKEN` variables it asks for.
- **Limits.** The app limits, per hour: 5 sign-in emails per address and 20 per network, 30 AI answers and 60
  uploads per person. Codes allow 5 tries per address every 15 minutes, request forms 5 requests per visitor
  every 10 minutes, and invitations 100 per organization per day. A visitor over a limit is told when to try
  again. The limits are in the API routes (`rateLimited`), if yours need to differ.

## Later: the Zoom worker

Zoom import needs `apps/api` and `apps/worker` running all the time, which Vercel doesn't do. Host them as two
services on a container platform such as Railway, Render or Fly.io, from this repository, with the same
database. The worker connects as `workspace_worker` (give it a password the same way as step 2.3) and needs
`SECRET_STORE_PROVIDER=aws_secrets_manager` plus Zoom OAuth credentials. Until then, the rest of the app works
without them.

## Troubleshooting

- **"Open the link in the same browser".** For security, an email sign-in link only works in the browser
  where it was requested. Type the 6-digit code from the same email instead, or request a new link and open it
  there.
- **No sign-in email arrives.** Check spam, then Supabase **Authentication → Logs**. The built-in sender's
  hourly limit is the usual cause; set up SMTP (step 4.2). If the app says *Too many sign-in emails*, the last
  one is still on its way; the limit resets within the hour.
- **The email has no code.** The Magic Link template is missing `{{ .Token }}` (step 4.3).
- **Invitations, mentions or summaries don't arrive.** Check **Emails** in Resend: if nothing is listed, check
  `EMAIL_PROVIDER` and `RESEND_API_KEY`; if they're listed as failed, the domain isn't verified yet (step 3.2).
  The daily summary only covers what people haven't already seen in the app, and isn't sent at all to people who
  turned it off on their Profile.
- **Signing in brings you back to the home page.** The callback URL is missing from Supabase's Redirect URLs.
  Sign-in still completes from the Site URL, but add the callback URL so it goes straight in.
- **The build fails installing packages.** Make sure `ENABLE_EXPERIMENTAL_COREPACK=1` is set; the repository
  pins its pnpm version.
