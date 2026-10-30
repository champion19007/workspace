import { z } from 'zod';
import { parseWebVtt } from '../zoom/vtt-normalizer.js';

// ============================================================================
// AI helpers: notes from a pasted transcript, a plain-words progress summary, Ask AI
// ============================================================================

/** About an hour of conversation; longer transcripts would need the windowed meeting pipeline. */
export const MAX_TRANSCRIPT_CHARS = 60_000;

export const TranscriptNotesRequestSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1, 'Give the meeting a name').max(200),
  transcript: z
    .string()
    .trim()
    .min(40, 'Paste a longer transcript or notes')
    .max(MAX_TRANSCRIPT_CHARS, `Paste up to ${MAX_TRANSCRIPT_CHARS.toLocaleString('en')} characters`),
});
export type TranscriptNotesRequest = z.infer<typeof TranscriptNotesRequestSchema>;

export interface SuggestedTaskDTO {
  text: string;
  ownerName: string | null;
  duePhrase: string | null;
  /** The words in the transcript the suggestion comes from. */
  quote: string;
}

export interface TranscriptNotesDTO {
  summaryMd: string;
  decisions: string[];
  openQuestions: string[];
  actionItems: SuggestedTaskDTO[];
  /** True when no AI key is set and the notes are placeholders made from the text. */
  demo: boolean;
}

export interface TranscriptLine {
  seq: number;
  speakerLabel: string | null;
  text: string;
}

const SPEAKER_LINE = /^([\p{L}][\p{L}\p{M} .'-]{0,39}):\s+(.+)$/u;

/** Numbered lines from a WebVTT file or plain text, with "Name: words" read as a speaker. */
export function transcriptToLines(transcript: string): TranscriptLine[] {
  if (/^WEBVTT/.test(transcript.trimStart())) {
    return parseWebVtt(transcript).map((cue, i) => ({ seq: i + 1, speakerLabel: cue.speakerLabel || null, text: cue.text }));
  }
  return transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const m = SPEAKER_LINE.exec(line);
      return { seq: i + 1, speakerLabel: m ? m[1]!.trim() : null, text: m ? m[2]!.trim() : line };
    });
}

export const AskAiRequestSchema = z.object({
  question: z.string().trim().min(3, 'Ask a question').max(500),
});

export interface AskAiSourceDTO {
  n: number;
  kind: 'project' | 'task' | 'doc';
  title: string;
  href: string;
}

export interface AskAiAnswerDTO {
  answer: string;
  /** Only the sources the answer cites. */
  sources: AskAiSourceDTO[];
  notFound: boolean;
  demo: boolean;
}

export interface ProgressSummaryDTO {
  headline: string;
  paragraphs: string[];
  /** Things worth asking the team about. */
  watch: string[];
  createdAt: string;
  demo: boolean;
}

// ============================================================================
// Monthly AI budget (orgs.ai_budget_inr; docs/system-design/08-ai-and-cost.md §8.6)
// ============================================================================

/**
 * Whether an organization may start another AI call this month, given what it has spent (`usedInr`) and its
 * monthly budget (`budgetInr`), both in rupees. The web AI helpers answer 429 AI_BUDGET_EXCEEDED when false.
 */
export function aiBudgetAllows(usedInr: number, budgetInr: number): boolean {
  // TODO(human): decide when an organization is out of AI budget.
  void usedInr;
  void budgetInr;
  return true;
}
