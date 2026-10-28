import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appUrl,
  digestEmail,
  invitationEmail,
  notificationEmail,
  readUnsubscribeToken,
  unsubscribeToken,
} from '@/lib/email';

const orgId = '0190a000-0000-7000-8000-000000000001';
const userId = '0190a000-0000-7000-8000-000000000002';
const base = 'https://app.example.com';

describe('emails', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('escapes what people typed, and keeps a plain-text version', () => {
    const email = invitationEmail({
      id: 'inv-1',
      to: 'asha@example.com',
      orgName: '<b>Acme</b> & Co',
      invitedBy: 'ravi@example.com',
      role: 'client',
      link: `${base}/invitations/accept?token=abc`,
    });
    expect(email.html).toContain('&#60;b&#62;Acme&#60;/b&#62; &#38; Co');
    expect(email.html).not.toContain('<b>Acme');
    expect(email.text).toContain('as a Client');
    expect(email.text).toContain(`${base}/invitations/accept?token=abc`);
    expect(email.stream).toBe('transactional');
    // Sign-in and invitation emails can't be unsubscribed from.
    expect(email.headers).toBeUndefined();
  });

  it('lets a notification be turned off from the email, and only with an untampered link', () => {
    const email = notificationEmail(base, {
      id: 'n-1',
      orgId,
      orgName: 'Acme',
      userId,
      email: 'asha@example.com',
      kind: 'mention',
      // A link that leaves the app falls back to the organization's home page.
      payload: { title: 'Ravi mentioned\r\nyou on Launch', body: 'Can you check this?', href: '//evil.example.com' },
    });
    expect(email.subject).toBe('Ravi mentioned you on Launch');
    expect(email.text).toContain(`Open in Workspace: ${base}/orgs/${orgId}`);
    expect(email.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    const token = decodeURIComponent(/token=([^>]+)>/.exec(email.headers!['List-Unsubscribe']!)![1]!);
    expect(readUnsubscribeToken(token)).toEqual({ orgId, userId, kind: 'mentions' });
    expect(readUnsubscribeToken(token.replace('.mentions.', '.digest.'))).toBeNull();
    expect(readUnsubscribeToken(`${unsubscribeToken(orgId, userId, 'digest')}x`)).toBeNull();
    expect(readUnsubscribeToken('not-a-token')).toBeNull();
  });

  it('lists up to 20 updates in a digest and points to the rest', () => {
    const items = Array.from({ length: 23 }, (_, i) => ({ title: `Update ${i}`, href: `/orgs/${orgId}/inbox` }));
    const email = digestEmail(base, { orgId, orgName: 'Acme', userId, email: 'asha@example.com', items }, '2026-10-28');
    expect(email.subject).toBe('23 updates in Acme');
    expect(email.text).toContain('Update 19');
    expect(email.text).not.toContain('Update 20');
    expect(email.text).toContain(`See 3 more in Workspace: ${base}/orgs/${orgId}`);
    expect(email.idempotencyKey).toBe(`digest:${orgId}:${userId}:2026-10-28`);
  });

  it('links to APP_URL when it is set, else the host that was asked', () => {
    const request = new Request('http://internal/x', { headers: { host: 'team.example.com', 'x-forwarded-proto': 'https' } });
    expect(appUrl(request)).toBe('https://team.example.com');
    vi.stubEnv('APP_URL', 'https://work.example.com/');
    expect(appUrl(request)).toBe('https://work.example.com');
  });
});
