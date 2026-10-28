import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../schema/index.js';
import { findOrCreateUserByEmail, createOrganizationWithOwner } from '../auth-operations.js';
import { insertNotifications } from '../comment-operations.js';
import {
  claimDigestEmails,
  claimInstantEmails,
  getEmailPreferences,
  purgeRateLimits,
  rateLimitHit,
  setEmailPreference,
} from '../email-operations.js';
import { tenantSql } from '../client.js';

// Notifications are the email queue (0021): mentions and requests go out straight away, everything else in a
// daily digest, each at most once and only to people who still want that kind of email.
describe('email queue and rate limits (Real PostgreSQL)', () => {
  const directUrl =
    process.env.DATABASE_DIRECT_URL ||
    'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev?sslmode=disable';

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let orgId: string;
  let ownerId: string;
  let memberId: string;
  let outsiderId: string;
  const stamp = Date.now();
  // The claims cover every organization; other suites may be queueing notifications at the same time.
  const ours = <T extends { orgId: string }>(rows: T[]) => rows.filter((r) => r.orgId === orgId);

  beforeAll(async () => {
    sql = postgres(directUrl, { max: 5 });
    db = drizzle(sql, { schema });
    const mk = async (who: string) => (await findOrCreateUserByEmail(db, { email: `email-${who}-${stamp}@workspace.dev`, name: who })).id;
    [ownerId, memberId, outsiderId] = [await mk('owner'), await mk('member'), await mk('outsider')];
    orgId = (await createOrganizationWithOwner(db, { name: 'Email Org', slug: `email-${stamp}`, userId: ownerId })).org.id;
    await sql`INSERT INTO memberships (org_id, user_id, role) VALUES (${orgId}, ${memberId}, 'member')`;

    const note = (userId: string, kind: 'mention' | 'comment', title: string) => ({
      userId,
      kind,
      title,
      body: 'Hi',
      href: `/orgs/${orgId}`,
      dedupeKey: `${title}:${userId}`,
    });
    await tenantSql(sql, { orgId, userId: ownerId, role: 'owner' }).begin(async (tx) => {
      await insertNotifications(tx, orgId, [
        note(memberId, 'mention', 'Owner mentioned you'),
        note(memberId, 'comment', 'Owner commented'),
        note(ownerId, 'comment', 'Member commented'),
      ]);
    });
  });

  afterAll(async () => {
    if (orgId) await sql`DELETE FROM orgs WHERE id = ${orgId}`;
    await sql.end({ timeout: 5 });
  });

  it('emails a mention straight away, and only once', async () => {
    const sent = ours(await claimInstantEmails(db, 1000));
    expect(sent.map((e) => [e.email, e.orgName, e.payload.title])).toEqual([
      [`email-member-${stamp}@workspace.dev`, 'Email Org', 'Owner mentioned you'],
    ]);
    expect(ours(await claimInstantEmails(db, 1000))).toEqual([]);
  });

  it('gathers the rest into one digest per person, except for people who turned it off', async () => {
    await setEmailPreference(db, { orgId, userId: memberId, kind: 'digest', enabled: false });
    // Nobody outside the organization can be signed up for, or out of, its emails.
    await setEmailPreference(db, { orgId, userId: outsiderId, kind: 'digest', enabled: false });
    const [outsider] = await sql`SELECT count(*)::int AS n FROM notification_preferences WHERE user_id = ${outsiderId}`;
    expect(outsider!.n).toBe(0);
    expect(await getEmailPreferences(db, { orgId, userId: memberId, role: 'member' })).toEqual({
      mentions: true,
      requests: true,
      digest: false,
    });

    const digests = ours(await claimDigestEmails(db, 1000));
    expect(digests.map((d) => [d.userId, d.items.map((i) => i.title)])).toEqual([[ownerId, ['Member commented']]]);
    expect(ours(await claimDigestEmails(db, 1000))).toEqual([]);
  });

  it('counts hits per key in a window, out of sight of the app', async () => {
    const key = `test:${stamp}`;
    const hits: boolean[] = [];
    for (let i = 0; i < 3; i++) hits.push(await rateLimitHit(db, key, 86_400, 2));
    expect(hits).toEqual([true, true, false]);
    expect(await rateLimitHit(db, `${key}:other`, 86_400, 2)).toBe(true);

    const [seen] = await tenantSql(sql, { orgId, userId: ownerId, role: 'owner' })`SELECT count(*)::int AS n FROM rate_limit_counters`;
    expect(seen!.n).toBe(0);

    await sql`UPDATE rate_limit_counters SET window_start = window_start - interval '2 days' WHERE key = ${key}`;
    expect(await purgeRateLimits(db)).toBeGreaterThanOrEqual(1);
    expect(await rateLimitHit(db, key, 86_400, 2)).toBe(true);
  });
});
