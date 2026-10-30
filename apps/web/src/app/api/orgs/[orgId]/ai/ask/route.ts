import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { aiBudgetExceeded, aiFailed, aiRateLimited, aiUnavailable, completeAndRecord, isDemoAi } from '@/lib/ai';
import { getLeadershipSummary, searchWorkspace } from '@workspace/db';
import { AskAiRequestSchema, isReadOnlyRole, type AskAiAnswerDTO, type AskAiSourceDTO } from '@workspace/core';
import { ASK_AI_SYSTEM_PROMPT, AskAiOutputSchema, PROMPT_VERSIONS } from '@workspace/prompts';

export const maxDuration = 60;

const STATUS_WORDS: Record<string, string> = { todo: 'to do', in_progress: 'in progress', blocked: 'stuck', done: 'done' };

/**
 * Answers a question from what the caller can see: every project's numbers, what's late or stuck, and the tasks
 * and docs whose words match. The model may only use those numbered sources and must cite them.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier } = await params;
  const { db, sql, ports } = getServerContext();
  const unavailable = aiUnavailable(ports, instance);
  if (unavailable) return unavailable;
  const limited = await aiRateLimited(session.userId, instance);
  if (limited) return limited;

  let orgId: string;
  let question: string;
  let sources: Array<AskAiSourceDTO & { text: string }>;
  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    orgId = tenant.orgId;
    const overBudget = await aiBudgetExceeded(orgId, instance);
    if (overBudget) return overBudget;
    const parsed = AskAiRequestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return problemJson(422, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Ask a question', instance);
    question = parsed.data.question;
    const caller = { orgId: tenant.orgId, userId: session.userId, role: tenant.role };
    const [leadership, matches] = await Promise.all([getLeadershipSummary(sql, caller), searchWorkspace(sql, { ...caller, question })]);

    const base = `/orgs/${tenant.orgId}`;
    // Executives and Clients can't open task pages, so their task links go to the project's Overview.
    const taskHref = (projectId: string, taskId: string) =>
      isReadOnlyRole(tenant.role) ? `${base}/projects/${projectId}/dashboard` : `${base}/projects/${projectId}/tasks?task=${taskId}`;
    const items: Array<Omit<AskAiSourceDTO, 'n'> & { text: string }> = [
      ...leadership.projects.slice(0, 25).map((p) => ({
        kind: 'project' as const,
        title: p.name,
        href: `${base}/projects/${p.id}/dashboard`,
        text: `Project "${p.name}": ${p.rollup.completionPercentage}% done (${p.rollup.tasks.completed} of ${p.rollup.tasks.total} tasks), health ${p.rollup.health.replace('_', ' ')}, ${p.rollup.overdueCount} late, ${p.rollup.tasks.blocked} stuck, ${p.rollup.dueSoonCount} due in the next few days.`,
      })),
      ...leadership.atRiskTasks.slice(0, 10).map((t) => ({
        kind: 'task' as const,
        title: t.title,
        href: taskHref(t.projectId, t.id),
        text: `Task "${t.title}" in ${t.projectName}: ${[t.isOverdue && `late (due ${t.dueDate})`, t.isBlocked && 'stuck'].filter(Boolean).join(' and ')}, ${t.assignee ? `with ${t.assignee.name || t.assignee.email.split('@')[0]}` : 'no one assigned'}.`,
      })),
      ...matches.tasks
        .filter((t) => !leadership.atRiskTasks.some((r) => r.id === t.id))
        .map((t) => ({
          kind: 'task' as const,
          title: t.title,
          href: taskHref(t.projectId, t.id),
          text: `Task "${t.title}" in ${t.projectName}: ${STATUS_WORDS[t.status] ?? t.status}${t.dueDate ? `, due ${t.dueDate}` : ''}, ${t.assignee ? `with ${t.assignee}` : 'no one assigned'}.${t.description ? ` Details: ${t.description}` : ''}`,
        })),
      ...matches.docs.map((d) => ({
        kind: 'doc' as const,
        title: d.title,
        href: d.nodeKind === 'project' ? `${base}/projects/${d.nodeId}/docs/${d.id}` : `${base}/docs/${d.id}`,
        text: `Doc "${d.title}" in ${d.nodeName}: ${d.excerpt}`,
      })),
    ];
    sources = items.map((s, i) => ({ ...s, n: i + 1 }));
  } catch (err) {
    return problemFromError(err, instance);
  }

  if (sources.length === 0) {
    const empty: AskAiAnswerDTO = { answer: "There's nothing here to answer from yet: no projects you can see.", sources: [], notFound: true, demo: isDemoAi(ports) };
    return NextResponse.json(empty);
  }

  try {
    const { data } = await completeAndRecord(ports, orgId, {
      promptId: 'ask_ai.answer',
      promptVersion: PROMPT_VERSIONS.askAi,
      tier: 'fast',
      input: `<sources>\n${sources.map((s) => `[${s.n}] ${s.text}`).join('\n')}\n</sources>\n\nQuestion: ${question}`,
      schema: AskAiOutputSchema,
      systemPrefix: ASK_AI_SYSTEM_PROMPT,
    });
    const cited = new Set(data.citations.map(Number));
    const answer: AskAiAnswerDTO = {
      answer: data.answer,
      sources: sources.filter((s) => cited.has(s.n)).map(({ n, kind, title, href }) => ({ n, kind, title, href })),
      notFound: data.notFound,
      demo: isDemoAi(ports),
    };
    return NextResponse.json(answer);
  } catch (err) {
    return aiFailed(err, instance);
  }
}
