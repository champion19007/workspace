import { createHmac, timingSafeEqual } from 'node:crypto';
import { after } from 'next/server';
import { INVITATION_EXPIRY_DAYS, type EmailMessage, type EmailPort } from '@workspace/core';
import {
  claimDigestEmails,
  claimInstantEmails,
  type DigestEmail,
  type EmailKind,
  type InstantEmail,
} from '@workspace/db';
import { getServerContext } from './server-context';
import { getSessionSecret, safeReturnTo } from './session';

export const EMAIL_KINDS: readonly EmailKind[] = ['mentions', 'requests', 'digest'];

/** This app's public address, for links in emails: APP_URL, else Vercel's production domain, else this request's host. */
export function appUrl(request?: Request): string {
  const configured =
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  if (configured) return configured.replace(/\/+$/, '');
  const host = request?.headers.get('host') || 'localhost:3000';
  return `${request?.headers.get('x-forwarded-proto') || 'http'}://${host}`;
}

/** Compares secrets without giving away, through timing, how much of them matched. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const sign = (payload: string) =>
  createHmac('sha256', getSessionSecret()).update(`unsubscribe:${payload}`).digest('base64url');

/** Lets a link in an email turn off one kind of email for one person in one organization, without signing in. */
export function unsubscribeToken(orgId: string, userId: string, kind: EmailKind): string {
  const payload = `${orgId}.${userId}.${kind}`;
  return `${payload}.${sign(payload)}`;
}

export function readUnsubscribeToken(token: string): { orgId: string; userId: string; kind: EmailKind } | null {
  const [orgId, userId, kind, signature, ...rest] = token.split('.');
  if (!orgId || !userId || !signature || rest.length > 0 || !EMAIL_KINDS.includes(kind as EmailKind)) return null;
  return safeEqual(signature, sign(`${orgId}.${userId}.${kind}`)) ? { orgId, userId, kind: kind as EmailKind } : null;
}

// ---------------------------------------------------------------------------------------------------------
// Templates: plain, readable on any mail app, with a text version of everything.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface Content {
  subject: string;
  paragraphs: string[];
  items?: Array<{ title: string; body?: string; url: string }>;
  action?: { label: string; url: string };
  /** Why they got it. */
  reason: string;
  /** Notifications can be turned off from the email itself; sign-in and invitation emails can't. */
  unsubscribe?: { pageUrl: string; postUrl: string };
}

function render(c: Content): Pick<EmailMessage, 'subject' | 'html' | 'text' | 'headers'> {
  const p = (inner: string, style = '') => `<p style="margin:0 0 12px;${style}">${inner}</p>`;
  const body = [
    ...c.paragraphs.map((t) => p(esc(t))),
    ...(c.items ?? []).map((i) =>
      p(
        `<a href="${esc(i.url)}" style="color:#3a5bc7;font-weight:600;text-decoration:none">${esc(i.title)}</a>` +
          (i.body ? `<br><span style="color:#4b5563">${esc(i.body)}</span>` : '')
      )
    ),
    c.action
      ? p(
          `<a href="${esc(c.action.url)}" style="display:inline-block;background:#3e63dd;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(c.action.label)}</a>`,
          'margin-top:20px'
        )
      : '',
    p(
      esc(c.reason) + (c.unsubscribe ? ` <a href="${esc(c.unsubscribe.pageUrl)}" style="color:#6b7280">Unsubscribe</a>` : ''),
      'margin-top:24px;color:#6b7280;font-size:12px'
    ),
  ].join('');
  const text = [
    ...c.paragraphs,
    ...(c.items ?? []).map((i) => [i.title, i.body, i.url].filter(Boolean).join('\n')),
    c.action ? `${c.action.label}: ${c.action.url}` : '',
    c.reason,
    c.unsubscribe ? `Unsubscribe: ${c.unsubscribe.pageUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    subject: c.subject.replace(/\s+/g, ' ').trim().slice(0, 200),
    html:
      '<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f5f6f8">' +
      '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;' +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111827\">" +
      `${body}</div></body></html>`,
    text,
    // RFC 8058: mail apps show their own Unsubscribe button and POST to this address, no page involved.
    headers: c.unsubscribe
      ? { 'List-Unsubscribe': `<${c.unsubscribe.postUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      : undefined,
  };
}

const ROLE_NAMES: Record<string, string> = {
  owner: 'an Owner',
  admin: 'a Manager',
  member: 'a Developer',
  viewer: 'an Executive',
  client: 'a Client',
};

export function invitationEmail(input: {
  id: string;
  to: string;
  orgName: string;
  invitedBy: string;
  role: string;
  link: string;
}): EmailMessage {
  return {
    to: input.to,
    stream: 'transactional',
    idempotencyKey: `invitation:${input.id}`,
    ...render({
      subject: `${input.invitedBy} invited you to ${input.orgName} on Workspace`,
      paragraphs: [
        `${input.invitedBy} invited you to join ${input.orgName} on Workspace as ${ROLE_NAMES[input.role] ?? 'a member'}.`,
        `Sign in with this email address to join. The link works once and expires in ${INVITATION_EXPIRY_DAYS} days.`,
      ],
      action: { label: `Join ${input.orgName}`, url: input.link },
      reason: "If you weren't expecting this invitation, you can ignore this email.",
    }),
  };
}

const linkTo = (base: string, href: string | undefined, orgId: string) => base + (safeReturnTo(href) ?? `/orgs/${orgId}`);

function unsubscribeLinks(base: string, orgId: string, userId: string, kind: EmailKind) {
  const token = encodeURIComponent(unsubscribeToken(orgId, userId, kind));
  return { pageUrl: `${base}/email/unsubscribe?token=${token}`, postUrl: `${base}/api/email/unsubscribe?token=${token}` };
}

/** A mention or a new request, sent as it happens. */
export function notificationEmail(base: string, n: InstantEmail): EmailMessage {
  const isRequest = n.kind === 'request';
  return {
    to: n.email,
    stream: 'notifications',
    idempotencyKey: `notification:${n.id}`,
    ...render({
      subject: n.payload.title ?? `New activity in ${n.orgName}`,
      paragraphs: n.payload.body ? [n.payload.body] : [],
      action: { label: 'Open in Workspace', url: linkTo(base, n.payload.href, n.orgId) },
      reason: isRequest
        ? `You're getting this because you look after requests in ${n.orgName}.`
        : `You're getting this because someone mentioned you in ${n.orgName}.`,
      unsubscribe: unsubscribeLinks(base, n.orgId, n.userId, isRequest ? 'requests' : 'mentions'),
    }),
  };
}

const DIGEST_ITEMS = 20;

/** Once a day: everything still unread. `day` (YYYY-MM-DD) keeps a retried run from sending it twice. */
export function digestEmail(base: string, d: DigestEmail, day: string): EmailMessage {
  const shown = d.items.slice(0, DIGEST_ITEMS);
  const more = d.items.length - shown.length;
  return {
    to: d.email,
    stream: 'notifications',
    idempotencyKey: `digest:${d.orgId}:${d.userId}:${day}`,
    ...render({
      subject: `${d.items.length} ${d.items.length === 1 ? 'update' : 'updates'} in ${d.orgName}`,
      paragraphs: [`Here's what happened in ${d.orgName} that you haven't seen yet.`],
      items: shown.map((i) => ({ title: i.title ?? 'Update', body: i.body, url: linkTo(base, i.href, d.orgId) })),
      action: { label: more > 0 ? `See ${more} more in Workspace` : 'Open Workspace', url: `${base}/orgs/${d.orgId}` },
      reason: `You're getting this daily summary because you're a member of ${d.orgName}.`,
      unsubscribe: unsubscribeLinks(base, d.orgId, d.userId, 'digest'),
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Sending. A notification is marked emailed before it goes out, so a failure is logged and never retried:
// it still waits in the app's bell.

async function deliver(email: EmailPort, message: EmailMessage): Promise<boolean> {
  try {
    await email.send(message);
    return true;
  } catch (err) {
    console.error('Email failed', { stream: message.stream, message: (err as Error).message });
    return false;
  }
}

/** Emails the mentions and new requests that are waiting, once the response has gone out. */
export function emailNotificationsSoon(request: Request): void {
  const base = appUrl(request);
  const task = async () => {
    try {
      const { sql, ports } = getServerContext();
      for (const n of await claimInstantEmails(sql, 50)) await deliver(ports.email, notificationEmail(base, n));
    } catch (err) {
      console.error('Notification emails failed', { message: (err as Error).message });
    }
  };
  try {
    after(task);
  } catch {
    // Outside a request (tests and scripts) there's no "after the response": start now in the background.
    void task();
  }
}

/** The daily digests, 25 people at a time, until done or `deadline` (ms since the epoch) is near. */
export async function sendDigests(base: string, deadline: number): Promise<number> {
  const { sql, ports } = getServerContext();
  const day = new Date().toISOString().slice(0, 10);
  let sent = 0;
  while (Date.now() < deadline) {
    const batch = await claimDigestEmails(sql, 25);
    if (batch.length === 0) break;
    for (const d of batch) if (await deliver(ports.email, digestEmail(base, d, day))) sent++;
  }
  return sent;
}
