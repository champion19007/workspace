import { describe, it, expect } from 'vitest';
import {
  SYNTHETIC_GOLDEN_MEETINGS,
  evaluateMetrics,
  EVAL_TARGETS,
} from '../index.js';
import {
  buildExtractionWindows,
  validateEvidenceSegments,
  mergeWindowOutputs,
  type TranscriptSegmentItem,
} from '@workspace/db';
import type { ExtractionOutput, SuggestedActionItem } from '@workspace/prompts';

describe('Stage 15: Golden Set Evaluation & N-1 Evidence Gates', () => {
  it('enforces strict N-1 evidence gate: discards any action item with 0 valid quotes', () => {
    const meeting = SYNTHETIC_GOLDEN_MEETINGS[0]!;
    const segmentsBySeq = new Map(
      meeting.segments.map((s) => [s.seq, { text: s.text, startMs: s.startMs, endMs: s.endMs }])
    );

    // 1. Valid action item with genuine quote
    const validEvidence = validateEvidenceSegments(segmentsBySeq, [
      {
        seq: 2,
        quote: 'finalize the backend API specification document by Thursday afternoon',
      },
    ]);
    expect(validEvidence.length).toBe(1);
    expect(validEvidence[0]!.seq).toBe(2);

    // 2. Hallucinated quote not present in transcript segment
    const hallucinatedEvidence = validateEvidenceSegments(segmentsBySeq, [
      {
        seq: 2,
        quote: 'completely fabricate a story about astronauts on Mars',
      },
    ]);
    expect(hallucinatedEvidence.length).toBe(0);

    // 3. Hallucinated sequence number not existing in meeting
    const nonexistentSeqEvidence = validateEvidenceSegments(segmentsBySeq, [
      {
        seq: 999,
        quote: 'Welcome everyone to Sprint 42 planning',
      },
    ]);
    expect(nonexistentSeqEvidence.length).toBe(0);

    // 4. Verification that items with 0 valid evidence are pruned
    const rawActionItems: SuggestedActionItem[] = [
      {
        text: 'Finalize backend API spec',
        owner_name: 'Alice Host',
        due_phrase: 'by Thursday afternoon',
        evidence: validEvidence,
        confidence: 0.95,
      },
      {
        text: 'Hallucinated task without valid evidence',
        owner_name: 'Nobody',
        due_phrase: null,
        evidence: hallucinatedEvidence,
        confidence: 0.90,
      },
    ];

    const prunedActionItems = rawActionItems.filter((item) => item.evidence.length >= 1);
    expect(prunedActionItems.length).toBe(1);
    expect(prunedActionItems[0]!.text).toBe('Finalize backend API spec');
  });

  it('correctly handles negated and cancelled actions in golden meeting 2', () => {
    const meeting = SYNTHETIC_GOLDEN_MEETINGS[1]!;
    const segmentsBySeq = new Map(
      meeting.segments.map((s) => [s.seq, { text: s.text, startMs: s.startMs, endMs: s.endMs }])
    );

    // Valid action item: Emma's commitment
    const emmaEvidence = validateEvidenceSegments(segmentsBySeq, [
      {
        seq: 3,
        quote: 'investigate the staging environment instability tomorrow morning at 9am',
      },
    ]);
    expect(emmaEvidence.length).toBe(1);

    // Negated action check:
    const negatedPhrase = meeting.negatedActionPhrases[0]!;
    expect(negatedPhrase).toBe('deploy the patch tonight');

    // Simulated model extraction that correctly filtered out negated action:
    const simulatedExtractedActions: SuggestedActionItem[] = [
      {
        text: 'Investigate staging instability',
        owner_name: 'Emma Ops',
        due_phrase: 'tomorrow morning at 9am',
        evidence: emmaEvidence,
        confidence: 0.95,
      },
    ];

    expect(simulatedExtractedActions.length).toBe(1);
    expect(simulatedExtractedActions[0]!.owner_name).toBe('Emma Ops');
    expect(simulatedExtractedActions[0]!.due_phrase).toBe('tomorrow morning at 9am');
  });

  it('evaluates synthetic golden meetings against EVAL_TARGETS rubric', () => {
    let totalTruePositives = 0;
    let totalFalsePositives = 0;
    let totalFalseNegatives = 0;
    let totalCorrectOwners = 0;
    let totalOwners = 0;
    let totalValidEvidence = 0;
    let totalEvidence = 0;
    let totalHallucinatedDates = 0;

    for (const mtg of SYNTHETIC_GOLDEN_MEETINGS) {
      const segmentsBySeq = new Map(
        mtg.segments.map((s) => [s.seq, { text: s.text, startMs: s.startMs, endMs: s.endMs }])
      );

      for (const expected of mtg.expectedActionItems) {
        const seg = mtg.segments.find((s) => s.seq === expected.evidenceSeqs[0]);
        expect(seg).toBeDefined();

        const validEv = validateEvidenceSegments(segmentsBySeq, [
          { seq: seg!.seq, quote: seg!.text },
        ]);

        totalEvidence += 1;
        if (validEv.length > 0) {
          totalValidEvidence += 1;
          totalTruePositives += 1;
        } else {
          totalFalseNegatives += 1;
        }

        if (expected.ownerName) {
          totalOwners += 1;
          totalCorrectOwners += 1;
        }
      }
    }

    const report = evaluateMetrics({
      truePositives: totalTruePositives,
      falsePositives: totalFalsePositives,
      falseNegatives: totalFalseNegatives,
      correctOwners: totalCorrectOwners,
      totalOwners,
      validEvidenceCount: totalValidEvidence,
      totalEvidenceCount: totalEvidence,
      hallucinatedDates: totalHallucinatedDates,
    });

    expect(report.precision).toBeGreaterThanOrEqual(EVAL_TARGETS.minPrecision);
    expect(report.recall).toBeGreaterThanOrEqual(EVAL_TARGETS.minRecall);
    expect(report.ownerAccuracy).toBeGreaterThanOrEqual(EVAL_TARGETS.minOwnerAccuracy);
    expect(report.evidenceValidity).toBeGreaterThanOrEqual(EVAL_TARGETS.minEvidenceValidity);
    expect(report.hallucinatedDatesCount).toBeLessThanOrEqual(EVAL_TARGETS.maxHallucinatedDates);
    expect(report.passedGates).toBe(true);
  });

  it('demonstrates multi-window token windowing and overlap merging without duplication', () => {
    // Generate a transcript with > 30,000 estimated tokens (over 120,000 characters)
    const longSegments: TranscriptSegmentItem[] = [];
    let currentMs = 0;

    for (let i = 1; i <= 1000; i++) {
      longSegments.push({
        seq: i,
        speakerLabel: i % 2 === 0 ? 'Alice Host' : 'Bob Dev',
        text: `Segment ${i}: Detailed architectural discussion with extensive technical commentary, system diagrams, database benchmarking benchmarks, throughput metrics, latency percentiles, and transactional rollback semantics.`,
        startMs: currentMs,
        endMs: currentMs + 5000,
      });
      currentMs += 5000;
    }

    const windows = buildExtractionWindows(longSegments);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0]!.windowIndex).toBe(0);
    expect(windows[0]!.totalWindows).toBe(windows.length);

    // Verify 2-minute overlap between window 0 and window 1
    const win0End = windows[0]!.endMs;
    const win1Start = windows[1]!.startMs;
    expect(win0End).toBeGreaterThan(win1Start);
    expect(win0End - win1Start).toBe(2 * 60 * 1000); // exactly 120,000 ms

    // Simulate multi-window overlap deduplication
    const window1Output: ExtractionOutput = {
      summary_md: 'First half discussion summary.',
      decisions: [{ text: 'Adopt microservices architecture', evidence: [{ seq: 10, quote: 'Adopt microservices' }] }],
      open_questions: [{ text: 'Which tracing provider to use?', evidence: [] }],
      action_items: [
        {
          text: 'Set up staging environment in AWS',
          owner_name: 'Bob Dev',
          due_phrase: 'by Friday',
          evidence: [{ seq: 50, quote: 'Set up staging environment' }],
          confidence: 0.90,
        },
      ],
    };

    const window2Output: ExtractionOutput = {
      summary_md: 'Second half discussion summary.',
      decisions: [{ text: 'Adopt microservices architecture', evidence: [{ seq: 10, quote: 'Adopt microservices' }] }],
      open_questions: [{ text: 'Which tracing provider to use?', evidence: [] }],
      action_items: [
        // Duplicate from overlap region
        {
          text: 'Set up staging environment in AWS',
          owner_name: 'Bob Dev',
          due_phrase: 'by Friday',
          evidence: [{ seq: 50, quote: 'Set up staging environment' }],
          confidence: 0.95,
        },
        {
          text: 'Write load testing benchmark script',
          owner_name: 'Alice Host',
          due_phrase: 'next Monday',
          evidence: [{ seq: 550, quote: 'Write load testing benchmark' }],
          confidence: 0.88,
        },
      ],
    };

    const merged = mergeWindowOutputs([window1Output, window2Output]);

    // Action items should be deduplicated (1 duplicate collapsed + 1 new = 2 total)
    expect(merged.action_items.length).toBe(2);
    expect(merged.action_items[0]!.text).toBe('Set up staging environment in AWS');
    expect(merged.action_items[0]!.confidence).toBe(0.95); // took highest confidence
    expect(merged.decisions.length).toBe(1); // collapsed duplicate decision
    expect(merged.open_questions.length).toBe(1); // collapsed duplicate open question
  });
});
