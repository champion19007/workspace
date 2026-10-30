import type { ZodType } from 'zod';

export type PromptId =
  | 'extract.notes_and_actions'
  | 'route.project'
  | 'resolve.speakers'
  | 'resolve.owner_and_due'
  | 'ask_ai.rewrite'
  | 'ask_ai.answer'
  | 'summarize.progress';

export type ModelTier = 'fast' | 'strong';

export interface LLMCompletionRequest<T> {
  promptId: PromptId;
  promptVersion: string;
  tier: ModelTier;
  input: unknown;
  schema: ZodType<T, any, any>;
  systemPrefix?: string;
  orgGlossary?: Record<string, string>;
}

export interface LLMCompletionResult<T> {
  data: T;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costInr: number;
  durationMs: number;
}

export interface EmbedRequest {
  texts: string[];
}

export interface EmbedResult {
  embeddings: number[][]; // 1024-dimensional vectors
  model: string;
  inputTokens: number;
  costInr: number;
}

export interface LLMPort {
  readonly provider: string;
  complete<T>(req: LLMCompletionRequest<T>): Promise<LLMCompletionResult<T>>;
  embed(req: EmbedRequest): Promise<EmbedResult>;
  checkHealth(): Promise<{ healthy: boolean; details?: unknown }>;
}
