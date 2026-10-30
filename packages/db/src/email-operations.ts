import { loginSql, tenantSql, type DbOrSql, type TenantContext } from './client.js';

/** The emails people can turn off, each on its own (migration 0021). */
export type EmailKind = 'mentions' | 'requests' | 'digest';
export type EmailPreferences = Record<EmailKind, boolean>;

/** What a notification shows; the same fields the bell uses. */
export interface NotificationPayload {
  title?: string;
  body?: string;
  href?: string;
}

export interface InstantEmail {
  /** The notification's id. */
  id: string;
  orgId: string;
  orgName: string;
  userId: string;
  email: string;
  kind: string;
  payload: NotificationPayload;
}

export interface DigestEmail {
  orgId: string;
  orgName: string;
  userId: string;
  email: string;
  /** Newest first. */
  items: NotificationPayload[];
}

/**
 * Takes up to `limit` unread mentions and new requests that haven't been emailed, for people who want them, and
 * marks them emailed. Each goes out at most once, whichever server instance gets to it first.
 */
export async function claimInstantEmails(db: DbOrSql, limit: number): Promise<InstantEmail[]> {
  const rows = await loginSql(db)`SELECT * FROM sys_email_claim_instant(${limit})`;
  return rows.map((r) => ({
    id: r.notification_id,
    orgId: r.org_id,
    orgName: r.org_name,
    userId: r.user_id,
    email: r.email,
    kind: r.kind,
    payload: r.payload,
  }));
}

/** Everything else unread and not yet emailed, as digests for up to `limit` people; marks it all emailed. */
export async function claimDigestEmails(db: DbOrSql, limit: number): Promise<DigestEmail[]> {
  const rows = await loginSql(db)`SELECT * FROM sys_email_claim_digests(${limit})`;
  return rows.map((r) => ({ orgId: r.org_id, orgName: r.org_name, userId: r.user_id, email: r.email, items: r.items }));
}

/** Which emails the signed-in person gets from this organization. Everything is on until they change it. */
export async function getEmailPreferences(db: DbOrSql, ctx: TenantContext): Promise<EmailPreferences> {
  const [row] = await tenantSql(db, ctx)`
    SELECT email_mentions, email_requests, email_digest
    FROM notification_preferences WHERE org_id = ${ctx.orgId} AND user_id = ${ctx.userId!}
  `;
  return {
    mentions: row?.email_mentions ?? true,
    requests: row?.email_requests ?? true,
    digest: row?.email_digest ?? true,
  };
}

/** Turns one kind of email on or off. Callers prove who is asking (a session or a signed unsubscribe link). */
export async function setEmailPreference(
  db: DbOrSql,
  input: { orgId: string; userId: string; kind: EmailKind; enabled: boolean }
): Promise<void> {
  await loginSql(db)`SELECT sys_set_email_preference(${input.orgId}, ${input.userId}, ${input.kind}, ${input.enabled})`;
}

/** Counts one hit on `key` in the current window; false once more than `limit` have landed in it. */
export async function rateLimitHit(db: DbOrSql, key: string, windowSeconds: number, limit: number): Promise<boolean> {
  const [row] = await loginSql(db)`SELECT sys_rate_limit_hit(${key}, ${windowSeconds}, ${limit}) AS allowed`;
  return row!.allowed;
}

/** Drops rate-limit counters older than a day. Returns how many went. */
export async function purgeRateLimits(db: DbOrSql): Promise<number> {
  const [row] = await loginSql(db)`SELECT sys_rate_limit_purge() AS purged`;
  return row!.purged;
}
