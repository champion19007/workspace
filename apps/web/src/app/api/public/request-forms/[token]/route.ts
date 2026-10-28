import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { problemFromError, problemJson } from '@/lib/problem';
import { emailNotificationsSoon } from '@/lib/email';
import { clientIp, rateLimited } from '@/lib/rate-limit';
import { submitPublicRequest } from '@workspace/db';
import { PublicRequestSchema, REQUEST_FORM_TOKEN_PATTERN } from '@workspace/core';

/** Anyone with the link can send a request; no account needed. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const instance = request.nextUrl.pathname;
  const { token } = await params;
  if (!REQUEST_FORM_TOKEN_PATTERN.test(token)) return problemJson(404, 'NOT_FOUND', "This form isn't available", instance);

  const limited = await rateLimited(
    [{ key: `request-form:${clientIp(request)}:${token}`, limit: 5, windowSeconds: 600 }],
    instance,
    'Too many requests from here. Please try again in a few minutes.'
  );
  if (limited) return limited;

  const parsed = PublicRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return problemJson(422, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the form and try again', instance);
  }
  // The hidden field is only ever filled in by bots: thank them and keep nothing.
  if (parsed.data.website) return NextResponse.json({ ok: true }, { status: 201 });

  try {
    const id = await submitPublicRequest(getServerContext().sql, token, parsed.data);
    if (!id) return problemJson(404, 'NOT_FOUND', "This form isn't taking requests right now", instance);
    emailNotificationsSoon(request);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return problemFromError(err, instance);
  }
}
