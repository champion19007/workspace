import { z } from 'zod';

export const PROMPT_VERSIONS = {
  extraction: 'v1.0.0',
  routing: 'v1.0.0',
  ownerResolution: 'v1.0.0',
  askAi: 'v1.0.0',
} as const;

// 1. Extraction prompt contracts
export const EvidenceSegmentSchema = z.object({
  seq: z.number().int().nonnegative(),
  quote: z.string().min(1),
});
export type EvidenceSegment = z.infer<typeof EvidenceSegmentSchema>;

export const SuggestedActionItemSchema = z.object({
  text: z.string().min(3),
  owner_name: z.string().nullable().optional(),
  due_phrase: z.string().nullable().optional(),
  evidence: z.array(EvidenceSegmentSchema).min(1, 'Every action item must carry at least 1 evidence segment'),
  confidence: z.number().min(0).max(1),
});
export type SuggestedActionItem = z.infer<typeof SuggestedActionItemSchema>;

export const ExtractionOutputSchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()),
  action_items: z.array(SuggestedActionItemSchema),
  open_questions: z.array(z.string()),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

// 2. Routing prompt contracts
export const RoutingOutputSchema = z.object({
  nodeId: z.string().uuid().nullable(),
  nodeName: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
export type RoutingOutput = z.infer<typeof RoutingOutputSchema>;

// 3. Ask AI contracts
export const AskAiOutputSchema = z.object({
  answer: z.string(),
  citations: z.array(z.string()),
  notFound: z.boolean().default(false),
});
export type AskAiOutput = z.infer<typeof AskAiOutputSchema>;
