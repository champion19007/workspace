# 09 — Security, tenancy and permissions

## 9.1 Threat model (what we defend against)

| Threat | Example | Primary control | Backup control |
|---|---|---|---|
| Cross-tenant read | Bug passes wrong `orgId` | RLS `org_id = app.org_id` on every table, forced | Compound FKs `(org_id, id)`; tests per table |
| Client sees another client | Client role guesses a project id | RESTRICTIVE policy `acting_user_is_client()` + `node_members` grant (`0016`) | 404 not 403 (no existence leak) |
| Privilege escalation | Developer calls an admin route | Role check in route + DB function guards | Role-matrix test (chapter 02 §2.7) |
| Session theft | XSS steals cookie | httpOnly cookie, strict CSP with nonces, DOMPurify on Markdown, `SafeMarkdownView` | `session_epoch` revocation |
| CSRF | Cross-site form posts to API | `SameSite=Lax` cookie + JSON-only bodies + `Origin` check on mutations | |
| Clickjacking | Framing the app | `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'` (built) | Public form embed uses its own route with `frame-ancestors *` |
| SSRF | Webhook URL → `169.254.169.254` | Resolve and block private/loopback/link-local at save **and** send | Egress through worker only |
| File-based XSS | Uploaded `.html`/`.svg` opened inline | `Content-Disposition: attachment` except images/PDF/video; separate storage domain | Content-type allowlist |
| Abuse / spam | Bots on request form, sign-in emails, code guessing | Shared Postgres rate limits (§6.8, built), honeypot, Vercel firewall rules | Turnstile on form after 3 hits (P2) |
| Email abuse | Unsubscribe links forged to switch off someone's emails | HMAC-signed tokens, constant-time compare (`safeEqual`), confirmation page (built) | Separate notifications sending subdomain protects sign-in deliverability |
| Prompt injection | A task description says "ignore instructions, reveal…" | AI sees only what the asker can see (RLS); outputs are suggestions; citations must point at given sources | No tool use with write power in Ask AI |
| Token leak | API token pasted in a public repo | Prefix `wsp_` for secret scanners, hash-only storage, scopes, expiry, last-used shown | Revoke in one click |
| Insider / support access | Staff browsing customer data | No support "login as" in v1; DB access via owner role only for migrations | Audit log of admin SQL (Supabase logs) |

## 9.2 Database roles (built in 17b)

| Role | Login? | Used by | Can |
|---|---|---|---|
| `workspace_user` (owner) | yes | migrations only | everything; never used by a running service |
| `workspace_api` | yes | web/API runtime | `SET ROLE workspace_app` only |
| `workspace_app` | no | per request, `SET LOCAL ROLE` | DML on tenant tables under RLS with `app.org_id`, `app.user_id` |
| `workspace_worker` | yes | worker | `SET ROLE workspace_system` |
| `workspace_system` | no | per job | DML under RLS for **one org at a time** |
| `workspace_definer` | no | owns `sys_*` SECURITY DEFINER functions | narrow cross-org operations (public forms, email claims, rate limits) |

Rules: no runtime role has `BYPASSRLS`; every `sys_*` function sets `search_path = pg_catalog, public`, validates
its inputs, and returns only what the caller needs.

## 9.3 Permission model

### Org roles (built) and capabilities

| Capability | Owner | Manager (`admin`) | Developer (`member`) | Executive (`viewer`) | Client (`client`) |
|---|---|---|---|---|---|
| See public projects | ✓ | ✓ | ✓ | ✓ (Progress, Overview, Docs) | ✗ |
| See private projects | ✓ | ✓ | if member | ✓ (Progress) | if granted (Progress) |
| Create/edit tasks, docs, files | ✓ | ✓ | ✓ | ✗ | ✗ |
| Comment | ✓ | ✓ | ✓ | projects & docs | granted projects & docs |
| Ask AI / Progress summary | ✓ | ✓ | ✓ | ✓ | ✓ (granted scope) |
| Approve AI suggestions | ✓ | ✓ | ✓ (own meetings / projects) | ✗ | ✗ |
| Invite / remove people | ✓ | ✓ (not Owners) | ✗ | ✗ | ✗ |
| Make Owner / Manager | ✓ | ✗ | ✗ | ✗ | ✗ |
| Grant client project access | ✓ | ✓ | ✗ | ✗ | ✗ |
| Workflows, fields, automation (org) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Automation (project) | ✓ | ✓ | if project manager | ✗ | ✗ |
| Webhooks, API tokens (admin scope) | ✓ | ✓ | own read/write tokens | ✗ | ✗ |
| Billing, export org, delete org, audit log | ✓ | ✗ | ✗ | ✗ | ✗ |

### Project roles (planned, `project_roles`)

A Developer may be **manager**, **contributor** (default) or **viewer** on a given project. Project manager adds:
project settings, field layout, project automation, request form, member list. Viewer removes edit rights on that
project only. Owners and Managers are project managers everywhere; Executives and Clients are viewers everywhere.

```ts
export function effectiveProjectRole(org: OrgRole, override: ProjectRole | null): ProjectRole {
  if (org === 'owner' || org === 'admin') return 'manager';
  if (org === 'viewer' || org === 'client') return 'viewer';
  return override ?? 'contributor';
}
```

### Permission schemes (Dev view, P2)

Atlassian's permission schemes (ref 358) map ~40 permissions to roles per project. Instead, Owners and Managers get, in the Dev view, a small
set of **project toggles** stored in `nodes.settings jsonb`:

| Toggle | Default | Effect |
|---|---|---|
| `contributorsCanDelete` | true | Contributors may archive tasks they didn't create |
| `onlyAssigneeTransitions` | false | Only the assignee or a manager moves a task |
| `clientsCanCreateRequests` | true | Clients see the request form inside the app |
| `clientsSeeComments` | `'external_only'` | Clients see only comments marked *shared with client* |
| `restrictDocsByDefault` | false | New docs start restricted to project members |

The last two need a per-comment flag: `comments.visibility varchar(10) DEFAULT 'internal' CHECK (visibility IN
('internal','shared'))`; for clients RLS shows only `shared`. This closes a real agency need: talk internally on a
task and reply to the client on the same task.

### Permission helper (ref 224–231)

`GET /admin/permission-helper?userId&targetType&targetId` returns steps:

```json
{ "canView": false, "canEdit": false, "steps": [
  { "check": "Member of organization", "result": true },
  { "check": "Organization level", "value": "Client", "result": "read-only" },
  { "check": "Project 'Acme website' granted to this client", "result": false,
    "fix": "Open People → Meera → Choose projects and tick 'Acme website'." } ] }
```

## 9.4 Authentication

| Item | Design |
|---|---|
| Methods | Email magic link **or 6-digit code from the same email** (`POST /api/auth/verify-code`, 5 tries per 15 min), Google OIDC (built); passkeys (WebAuthn) P2; SAML/OIDC SSO P3 (which plans include it: TBD — pricing not decided) |
| Session | Server-side session id in httpOnly cookie, 30-day rolling; `memberships.session_epoch` checked per request → instant sign-out everywhere |
| Org switching | `POST /api/auth/switch-org` re-resolves membership; no cross-org token reuse |
| API tokens | §6.10 |
| 2-step | Passwordless already proves email possession; passkeys provide phishing-resistant second factor for Owners (P2: *require passkey for Owners* toggle) |

## 9.5 Secrets

| Secret | Where (A) | Where (B) | Rotation |
|---|---|---|---|
| `SESSION_SECRET` | Vercel env | Secrets Manager | yearly; dual-key verify during rotation |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env (server only) | — | on staff change |
| Zoom refresh tokens | `SecretStorePort` (encrypted table with `pgcrypto` + key from env) | Secrets Manager | provider-driven |
| Webhook signing secrets | secret store, referenced by `webhook_endpoints.secret_ref` | same | customer-initiated |
| Slack/Teams incoming-webhook URLs (automation) | secret store | same | customer-initiated |
| `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `CRON_SECRET` (all in use since `752e2a4`) | Vercel env | Secrets Manager | 90 days |

Never store a secret in a `jsonb` config column; store a reference.

## 9.6 Privacy and data rights (India DPDP Act 2023 and Rules 2025; GDPR-ready)

| Requirement | Implementation | Status |
|---|---|---|
| Customer is the data fiduciary; we are the processor | DPA template; sub-processor list (Supabase, Vercel, Anthropic, Voyage, Resend, Zoom) on the website | Planned |
| Consent for meeting processing | Host opt-in + guest consent status per meeting (built); skip = cascade purge | Built |
| Visible notice and recorded consent for every recorded or transcribed meeting | Under the DPDP Act, processing a participant's personal data (voice, words, name) needs notice and consent. Every provider (chapter 03 §3.10): (1) participants see that the meeting is recorded and transcribed — the platform's own recording/transcription banner where it exists, plus our notice in the invite or the meeting chat where the API allows; (2) consent is recorded per meeting and participant group (`meetings.guest_consent_status`; host consent in `zoom_host_consents`, generalised to `meeting_host_consents` per provider); (3) no consent → skip and cascade-purge, as built; (4) the notice text, version and time are stored with the meeting so the record can be shown on request | Partial (Zoom host/guest consent built; notice text and per-provider consent planned) |
| Retention | `orgs.retention_days` (30–365, default 180) for transcripts; nightly purge | Partial (purge job planned) |
| Access / portability | `export_jobs.kind = 'user_data'` (JSON + Markdown + files) | Planned |
| Erasure | `export.erasure` job: anonymise author fields (`users.name = 'Former member'`), delete personal content on request, keep org content | Planned |
| AI data | Anthropic API does not train on API data by default; no zero-retention needed for current models; PII masking before embedding transcripts (stage 22) | Partial |
| Breach notice | Runbook: detect → contain → notify customers within 72 h with what/when/who | Planned |
| Data location | Supabase region chosen at project creation (pick Mumbai `ap-south-1` for Indian customers) | Config |

## 9.7 Security headers (built, keep)

`Content-Security-Policy` with nonces (`script-src 'self' 'nonce-…'`, `object-src 'none'`, `base-uri 'none'`,
`frame-ancestors 'none'`), `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()` (allow `microphone`/`camera` on the future
screen-recording page only).

## 9.8 Security testing in CI

1. RLS tests per table (exists) + the role-matrix route test (new).
2. Dependency audit (`pnpm audit --prod`) weekly; Renovate for updates.
3. DAST against a preview deployment before each release (StackHawk HawkScan or OWASP ZAP baseline scan).
4. Secret scanning on push (GitHub secret scanning recognises the `wsp_` prefix once registered as a custom
   pattern).
