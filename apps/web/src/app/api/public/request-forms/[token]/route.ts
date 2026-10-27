import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { problemFromError, problemJson } from '@/lib/problem';
import { submitPublicRequest } from '@workspace/db';
import { PublicRequestSchema, REQUEST_FORM_TOKEN_PATTERN } from '@workspace/core';

// ponytail: per-server-instance memory, so on serverless it only slows a single bot down. Move the counts to
// Postgres or a shared cache if forms start getting spam.
const recent = new Map<string, number[]>();
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 5;

function tooMany(key: string): boolean {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 10_000) recent.clear();
  return hits.length > MAX_PER_WINDOW;
}

/** Anyone with the link can send a request; no account needed. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const instance = request.nextUrl.pathname;
  const { token } = await params;
  if (!REQUEST_FORM_TOKEN_PATTERN.test(token)) return problemJson(404, 'NOT_FOUND', "This form isn't available", instance);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (tooMany(`${ip}:${token}`)) {
    return problemJson(429, 'RATE_LIMITED', 'Too many requests from here. Please try again in a few minutes.', instance);
  }

  const parsed = PublicRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return problemJson(422, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the form and try again', instance);
  }
  // The hidden field is only ever filled in by bots: thank them and keep nothing.
  if (parsed.data.website) return NextResponse.json({ ok: true }, { status: 201 });

  try {
    const id = await submitPublicRequest(getServerContext().sql, token, parsed.data);
    if (!id) return problemJson(404, 'NOT_FOUND', "This form isn't taking requests right now", instance);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return problemFromError(err, instance);
  }
}
