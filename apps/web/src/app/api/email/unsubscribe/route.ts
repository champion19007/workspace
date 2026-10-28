import { NextResponse, type NextRequest } from 'next/server';
import { setEmailPreference } from '@workspace/db';
import { getServerContext } from '@/lib/server-context';
import { readUnsubscribeToken } from '@/lib/email';
import { problemFromError, problemJson } from '@/lib/problem';

/**
 * Turns off the kind of email a link was for. Mail apps POST here when someone presses their own Unsubscribe
 * button (RFC 8058, the List-Unsubscribe header), and so does the /email/unsubscribe page. Only POST: link
 * scanners open every GET link in an email, and would unsubscribe people who never asked.
 */
export async function POST(request: NextRequest) {
  const instance = request.nextUrl.pathname;
  const target = readUnsubscribeToken(request.nextUrl.searchParams.get('token') ?? '');
  if (!target) return problemJson(400, 'INVALID_LINK', "This unsubscribe link isn't valid.", instance);
  try {
    await setEmailPreference(getServerContext().sql, { ...target, enabled: false });
    return NextResponse.json({ ok: true, kind: target.kind });
  } catch (err) {
    return problemFromError(err, instance);
  }
}
