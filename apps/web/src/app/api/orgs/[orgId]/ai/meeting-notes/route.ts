import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { aiFailed, aiUnavailable, isDemoAi } from '@/lib/ai';
import { getVisibleProjectName } from '@workspace/db';
import { TranscriptNotesRequestSchema, isReadOnlyRole, transcriptToLines, type TranscriptNotesDTO } from '@workspace/core';
import { EXTRACTION_SYSTEM_PROMPT, ExtractionOutputSchema, PROMPT_VERSIONS, buildExtractionPrompt } from '@workspace/prompts';

export const maxDuration = 60;

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Notes and suggested tasks from a pasted transcript, without Zoom. Nothing is saved: the person reviews the
 * suggestions and creates the tasks and the notes doc they want.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier } = await params;
  const { db, sql, ports } = getServerContext();
  const unavailable = aiUnavailable(ports, instance);
  if (unavailable) return unavailable;

  let tenant;
  let projectName: string;
  let lines;
  let input: { title: string };
  try {
    tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    if (isReadOnlyRole(tenant.role)) return problemJson(403, 'FORBIDDEN', 'Executives and clients cannot add meeting notes', instance);
    const parsed = TranscriptNotesRequestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return problemJson(422, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the form and try again', instance);
    }
    input = parsed.data;
    projectName = await getVisibleProjectName(sql, { orgId: tenant.orgId, userId: session.userId, role: tenant.role, projectId: parsed.data.projectId });
    lines = transcriptToLines(parsed.data.transcript);
  } catch (err) {
    return problemFromError(err, instance);
  }

  try {
    const { data } = await ports.llm.complete({
      promptId: 'extract.notes_and_actions',
      promptVersion: PROMPT_VERSIONS.extraction,
      tier: 'strong',
      input: buildExtractionPrompt({ meetingTitle: input.title, projectTitle: projectName, segments: lines }),
      schema: ExtractionOutputSchema,
      systemPrefix: EXTRACTION_SYSTEM_PROMPT,
      temperature: 0,
    });
    // Same rule as meeting notes from Zoom: a suggestion stays only if its quote is really in the line it cites.
    const lineText = new Map(lines.map((l) => [l.seq, normalize(l.text)]));
    const grounded = data.action_items.filter((a) => a.evidence.some((e) => lineText.get(e.seq)?.includes(normalize(e.quote))));
    const notes: TranscriptNotesDTO = {
      summaryMd: data.summary_md,
      decisions: data.decisions.map((d) => d.text),
      openQuestions: data.open_questions.map((q) => q.text),
      actionItems: grounded.map((a) => ({
        text: a.text,
        ownerName: a.owner_name ?? null,
        duePhrase: a.due_phrase ?? null,
        quote: a.evidence[0]!.quote,
      })),
      demo: isDemoAi(ports),
    };
    return NextResponse.json(notes);
  } catch (err) {
    return aiFailed(err, instance);
  }
}
