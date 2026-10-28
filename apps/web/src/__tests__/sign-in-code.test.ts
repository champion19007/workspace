import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '../lib/session';
import { POST as verifyCode } from '../app/api/auth/verify-code/route';

// The 6-digit code from the sign-in email works in any browser. Five tries per email per 15 minutes, right or
// wrong, then a pause (counted in Postgres, so every server instance agrees).
describe('Web BFF: sign in with the code from the email', () => {
  const email = `code-${Date.now()}@example.com`;
  const attempt = (code: string, returnTo?: string) =>
    verifyCode(
      new NextRequest('http://localhost/api/auth/verify-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code, returnTo }),
      })
    );

  beforeAll(() => {
    process.env.SESSION_SECRET = 'a-super-secret-key-that-is-at-least-32-chars-long!';
  });

  it('signs in and goes where the person was heading', async () => {
    const res = await attempt('123456', '/invitations/accept?token=abc');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectTo: '/invitations/accept?token=abc' });
    expect(verifyAndRefreshSession(res.cookies.get(SESSION_COOKIE_NAME)?.value).session?.email).toBe(email);
  });

  it('turns wrong codes away, then stops checking for a while', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await attempt('000000')).status);
    // The sign-in above was the first of the five tries.
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    const paused = await attempt('123456');
    expect(paused.status).toBe(429);
    expect(Number(paused.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
