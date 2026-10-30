import type { LLMCompletionRequest } from '@workspace/core';

const COMMITMENT = /\b(i'll|i will|we'll|we will|will (send|share|do|fix|call|write|update|check))\b/i;

/**
 * Stand-in answers for local development without an AI key, built from the request itself so the AI screens
 * can be tried end to end. Every answer says it is a demo. Production never uses this (see server-context).
 */
export function demoLlm(req: LLMCompletionRequest<unknown>): unknown {
  const input = typeof req.input === 'string' ? req.input : JSON.stringify(req.input);

  if (req.promptId === 'extract.notes_and_actions') {
    const lines = [...input.matchAll(/^\[seq: (\d+)\] (?:\[([^\]]+)\] )?(.+)$/gm)].map((m) => ({
      seq: Number(m[1]),
      speaker: m[2] ?? null,
      text: m[3]!,
    }));
    return {
      summary_md: `**Demo notes.** No AI key is set, so these are placeholders picked from ${lines.length} lines of your transcript.`,
      decisions: lines.filter((l) => /\b(decided|agreed|let's go with)\b/i.test(l.text)).slice(0, 5).map((l) => l.text),
      open_questions: lines.filter((l) => l.text.endsWith('?')).slice(0, 5).map((l) => l.text),
      action_items: lines
        .filter((l) => COMMITMENT.test(l.text))
        .slice(0, 8)
        .map((l) => ({
          text: l.text.slice(0, 200),
          owner_name: l.speaker,
          due_phrase: /\bby [\w ]{3,20}/i.exec(l.text)?.[0] ?? null,
          evidence: [{ seq: l.seq, quote: l.text }],
          confidence: 0.5,
        })),
    };
  }

  if (req.promptId === 'summarize.progress') {
    const data = JSON.parse(/<project_data>([\s\S]*)<\/project_data>/.exec(input)?.[1] ?? '{"projects":[]}');
    const projects = data.projects as Array<{ name: string; percentDone: number; late: string[] }>;
    const late = projects.filter((p) => p.late.length > 0);
    return {
      headline: `Demo summary (no AI key is set): ${projects.length} projects, ${late.length} with late work.`,
      paragraphs: projects.slice(0, 4).map((p) => `${p.name} is ${p.percentDone}% done.`),
      watch: late.slice(0, 3).map((p) => `Ask about ${p.name}: ${p.late.length} late.`),
    };
  }

  if (req.promptId === 'ask_ai.answer') {
    const numbers = [...input.matchAll(/^\[(\d+)\] /gm)].map((m) => m[1]!).slice(0, 4);
    return numbers.length > 0
      ? {
          answer: `Demo answer (no AI key is set): these items match your question ${numbers.map((n) => `[${n}]`).join(' ')}.`,
          citations: numbers,
          notFound: false,
        }
      : { answer: 'Demo answer: nothing matched your question.', citations: [], notFound: true };
  }

  return {};
}
