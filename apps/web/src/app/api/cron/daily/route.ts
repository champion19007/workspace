import { NextResponse, type NextRequest } from 'next/server';
import { purgeOldNotifications, purgeRateLimits } from '@workspace/db';
import { getServerContext } from '@/lib/server-context';
import { appUrl, safeEqual, sendDigests } from '@/lib/email';

// Allowed on every Vercel plan. sendDigests stops starting new batches well before it.
export const maxDuration = 60;

/**
 * The daily job (apps/web/vercel.json "crons"): sends the digest emails and clears old rate-limit counts. Vercel
 * calls it with `Authorization: Bearer $CRON_SECRET`; while CRON_SECRET isn't set, nobody can.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const digests = await sendDigests(appUrl(request), Date.now() + 45_000);
  const { sql } = getServerContext();
  const purged = await purgeRateLimits(sql);
  const notificationsPurged = await purgeOldNotifications(sql);
  return NextResponse.json({ digests, purged, notificationsPurged });
}
