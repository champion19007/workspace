import { createHash } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { rateLimitHit } from '@workspace/db';
import { getServerContext } from './server-context';
import { problemJson } from './problem';

export interface RateRule {
  /** What is being counted, e.g. `sign-in-email:${email}`. Stored hashed, so emails and addresses aren't kept. */
  key: string;
  limit: number;
  windowSeconds: number;
}

/** The caller's address as Vercel (or another proxy in front of the app) reports it. */
export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Counts this attempt against each rule, in Postgres so every server instance shares the count. Returns a 429 with
 * Retry-After once a rule is over its limit, or null while all are within them.
 */
export async function rateLimited(rules: RateRule[], instance: string, message: string): Promise<NextResponse | null> {
  const { sql } = getServerContext();
  for (const rule of rules) {
    let allowed = true;
    try {
      const key = createHash('sha256').update(rule.key).digest('base64url');
      allowed = await rateLimitHit(sql, key, rule.windowSeconds, rule.limit);
    } catch (err) {
      // A broken counter must not lock everyone out (of signing in, above all): let the attempt through.
      console.error('Rate limit check failed', { rule: rule.key.split(':')[0], message: (err as Error).message });
    }
    if (!allowed) {
      const response = problemJson(429, 'RATE_LIMITED', message, instance);
      // Windows are aligned to the clock, so the current one ends at the next multiple of its length.
      const retryAfter = rule.windowSeconds - (Math.floor(Date.now() / 1000) % rule.windowSeconds);
      response.headers.set('Retry-After', String(retryAfter));
      return response;
    }
  }
  return null;
}
