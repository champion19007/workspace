import { z } from 'zod';

export const EVAL_TARGETS = {
  minPrecision: 0.80,
  minRecall: 0.70,
  minOwnerAccuracy: 0.85,
  maxHallucinatedDates: 0,
  minEvidenceValidity: 0.98,
} as const;

export const GoldenMeetingSchema = z.object({
  id: z.string(),
  title: z.string(),
  transcriptVtt: z.string(),
  expectedNodeId: z.string(),
  expectedActionItems: z.array(
    z.object({
      text: z.string(),
      ownerName: z.string().optional(),
      duePhrase: z.string().optional(),
      evidenceQuotes: z.array(z.string()),
    })
  ),
});
export type GoldenMeeting = z.infer<typeof GoldenMeetingSchema>;

export interface EvalRunReport {
  precision: number;
  recall: number;
  ownerAccuracy: number;
  evidenceValidity: number;
  hallucinatedDatesCount: number;
  passedGates: boolean;
  totalMeetingsEvaluated: number;
}

export function evaluateMetrics(results: {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  correctOwners: number;
  totalOwners: number;
  validEvidenceCount: number;
  totalEvidenceCount: number;
  hallucinatedDates: number;
}): EvalRunReport {
  const precision =
    results.truePositives + results.falsePositives > 0
      ? results.truePositives / (results.truePositives + results.falsePositives)
      : 0;

  const recall =
    results.truePositives + results.falseNegatives > 0
      ? results.truePositives / (results.truePositives + results.falseNegatives)
      : 0;

  const ownerAccuracy =
    results.totalOwners > 0 ? results.correctOwners / results.totalOwners : 1;

  const evidenceValidity =
    results.totalEvidenceCount > 0 ? results.validEvidenceCount / results.totalEvidenceCount : 1;

  const passedGates =
    precision >= EVAL_TARGETS.minPrecision &&
    recall >= EVAL_TARGETS.minRecall &&
    ownerAccuracy >= EVAL_TARGETS.minOwnerAccuracy &&
    evidenceValidity >= EVAL_TARGETS.minEvidenceValidity &&
    results.hallucinatedDates <= EVAL_TARGETS.maxHallucinatedDates;

  return {
    precision,
    recall,
    ownerAccuracy,
    evidenceValidity,
    hallucinatedDatesCount: results.hallucinatedDates,
    passedGates,
    totalMeetingsEvaluated: 1,
  };
}

export * from './golden-set.js';
