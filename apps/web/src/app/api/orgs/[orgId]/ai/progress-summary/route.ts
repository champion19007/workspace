import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { aiFailed, aiUnavailable, isDemoAi } from '@/lib/ai';
import {
  getLeadershipSummary,
  getProgressSummary,
  listRecentlyDoneTasks,
  progressScopeKey,
  saveProgressSummary,
} from '@workspace/db';
import { getKolkataTodayDateString } from '@workspace/core';
import { PROGRESS_SUMMARY_SYSTEM_PROMPT, PROMPT_VERSIONS, ProgressSummaryOutputSchema } from '@workspace/prompts';

export const maxDuration = 60;

/** A summary is shown for 12 hours, and a new one can be written at most once an hour. */
const SHOW_FOR_MINUTES = 12 * 60;
const REWRITE_AFTER_MINUTES = 60;

async function context(request: NextRequest, params: Promise<{ orgId: string }>) {
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return null;
  const { db, sql, ports } = getServerContext();
  const tenant = await resolveTenantForUser(db, (await params).orgId, session.userId);
  const caller = { orgId: tenant.orgId, userId: session.userId, role: tenant.role };
  const leadership = await getLeadershipSummary(sql, caller);
  return { sql, ports, caller, leadership, scopeKey: progressScopeKey(leadership.projects.map((p) => p.id)) };
}

/** The latest summary written for the caller's projects, or `summary: null`. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const instance = request.nextUrl.pathname;
  try {
    const ctx = await context(request, params);
    if (!ctx) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);
    const summary = await getProgressSummary(ctx.sql, { ...ctx.caller, scopeKey: ctx.scopeKey, maxAgeMinutes: SHOW_FOR_MINUTES });
    return NextResponse.json({ summary });
  } catch (err) {
    return problemFromError(err, instance);
  }
}

/** Writes a new summary from the current numbers (or returns the one written in the last hour). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const instance = request.nextUrl.pathname;
  let ctx;
  try {
    ctx = await context(request, params);
    if (!ctx) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);
    const unavailable = aiUnavailable(ctx.ports, instance);
    if (unavailable) return unavailable;
    const recent = await getProgressSummary(ctx.sql, { ...ctx.caller, scopeKey: ctx.scopeKey, maxAgeMinutes: REWRITE_AFTER_MINUTES });
    if (recent) return NextResponse.json({ summary: recent });
  } catch (err) {
    return problemFromError(err, instance);
  }

  const { sql, ports, caller, leadership, scopeKey } = ctx;
  if (leadership.projects.length === 0) {
    return NextResponse.json({ summary: null });
  }

  try {
    const done = await listRecentlyDoneTasks(sql, caller);
    const projects = leadership.projects.map((p) => {
      const atRisk = leadership.atRiskTasks.filter((t) => t.projectId === p.id);
      return {
        name: p.name,
        health: p.rollup.health,
        percentDone: p.rollup.completionPercentage,
        tasksDone: p.rollup.tasks.completed,
        tasksTotal: p.rollup.tasks.total,
        dueInNextFewDays: p.rollup.dueSoonCount,
        late: atRisk.filter((t) => t.isOverdue).map((t) => t.title),
        stuck: atRisk.filter((t) => t.isBlocked).map((t) => t.title),
        finishedThisWeek: done.filter((t) => t.projectId === p.id).slice(0, 5).map((t) => t.title),
      };
    });
    const { data } = await ports.llm.complete({
      promptId: 'summarize.progress',
      promptVersion: PROMPT_VERSIONS.progressSummary,
      tier: 'fast',
      input: `<project_data>${JSON.stringify({ today: getKolkataTodayDateString(), projects })}</project_data>`,
      schema: ProgressSummaryOutputSchema,
      systemPrefix: PROGRESS_SUMMARY_SYSTEM_PROMPT,
      temperature: 0.3,
    });
    const summary = await saveProgressSummary(sql, { ...caller, scopeKey, body: { ...data, demo: isDemoAi(ports) } });
    return NextResponse.json({ summary });
  } catch (err) {
    return aiFailed(err, instance);
  }
}
