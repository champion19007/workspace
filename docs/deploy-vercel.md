# Deploy the web app to Vercel

This puts the Workspace web app online so anyone can sign up, create an organization and use projects,
tasks, the board, calendar and timeline, docs, files, comments, request forms, the inbox and the AI helpers
(notes from a pasted transcript, the Progress summary and Ask AI). Sign-in uses Supabase (email links, and
optionally Google). The database and file storage are Supabase.

What this setup does not include:

- **Zoom meeting import.** It needs the API and worker services (`apps/api`, `apps/worker`), a job queue and
  a secret store, which don't run on Vercel. Settings shows a note instead of a Connect button. Notes from a
  pasted transcript work without it.
- **Invitation emails.** You can invite teammates from **People**, but the app doesn't send the email: it
  gives you the invitation link to send yourself.

You need a GitHub repository with this code, a [Vercel](https://vercel.com) account and a
[Supabase](https://supabase.com) account. Commands below are for PowerShell on Windows; on macOS or Linux
use `export NAME="value"` instead of `$env:NAME = "value"`.

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
   `0017`–`0020` for comments, files, request forms and the Progress summary); it only applies the new ones.
3. In the Supabase **SQL Editor**, give that login a password (any long random string; you'll need it in step 4):

   ```sql
   alter role workspace_api with password '<long random password>';
   ```

4. Turn off the Data API (**Project Settings → Data API**). The app talks to Postgres directly, and this keeps
   your tables off Supabase's public REST endpoint.
5. For files, create a storage bucket: **Storage → New bucket**, name it `workspace-attachments`, and leave
   **Public bucket** off. The app reads and writes it with the service role key (step 4); people only reach
   files through the app, which checks who can see each one.

## 3. Set up sign-in

1. **Authentication → URL Configuration**
   - Site URL: `https://<your-app>.vercel.app` (your Vercel domain, or your own domain later).
   - Redirect URLs: add `https://<your-app>.vercel.app/api/auth/callback`. If you use preview deployments,
     also add `https://*-<your-vercel-team>.vercel.app/api/auth/callback`.
2. **Sign-in emails.** Supabase's built-in email sender only allows a few emails an hour and is meant for
   testing. For real users, set up your own sender under **Authentication → Emails → SMTP Settings**
   (Resend, Postmark, Amazon SES and others work).
3. **Google (optional).** In Google Cloud, create an OAuth client of type *Web application* with the
   authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`. Paste its client ID and
   secret into **Authentication → Providers → Google**.

## 4. Create the Vercel project

1. In Vercel, **Add New → Project** and import the repository.
2. Set **Root Directory** to `apps/web` and keep "Include files outside the root directory" turned on.
   Install and build commands come from `apps/web/vercel.json`.
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

4. Deploy.

## 5. Check it works

1. Open your site, sign in with your email and create your organization.
2. Invite a teammate: **People → Invite people**, enter their email, pick their access level (Manager, Developer,
   Executive or Client) and copy the link. When they open it and sign in with that email address, they join your
   organization. The link works once and expires in 7 days. For a client, then use **Choose projects** on their card
   to pick what they see; until you do, they see nothing.
3. If pages fail to load, open the deployment's logs in Vercel. A message starting with
   *Production configuration is incomplete* lists exactly which variables are missing or wrong. The app
   refuses to run without real sign-in and its own session secret, so it can't be deployed in an unsafe state.

## Troubleshooting

- **"Open the link in the same browser".** For security, an email sign-in link only works in the browser
  where it was requested. Request a new link and open it there.
- **No sign-in email arrives.** Check spam, then Supabase **Authentication → Logs**. The built-in sender's
  hourly limit is the usual cause; set up SMTP (step 3.2).
- **Signing in brings you back to the home page.** The callback URL is missing from Supabase's Redirect URLs.
  Sign-in still completes from the Site URL, but add the callback URL so it goes straight in.
- **The build fails installing packages.** Make sure `ENABLE_EXPERIMENTAL_COREPACK=1` is set; the repository
  pins its pnpm version.
