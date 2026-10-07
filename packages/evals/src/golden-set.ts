export interface SyntheticMeeting {
  id: string;
  title: string;
  segments: Array<{
    seq: number;
    speakerLabel: string;
    text: string;
    startMs: number;
    endMs: number;
  }>;
  expectedDecisions: string[];
  expectedOpenQuestions: string[];
  expectedActionItems: Array<{
    text: string;
    ownerName?: string | null;
    duePhrase?: string | null;
    evidenceSeqs: number[];
  }>;
  negatedActionPhrases: string[];
  exploratoryPhrases: string[];
}

export const SYNTHETIC_GOLDEN_MEETINGS: SyntheticMeeting[] = [
  {
    id: 'golden-mtg-01',
    title: 'Product Sprint Planning - Sprint 42',
    segments: [
      {
        seq: 1,
        speakerLabel: 'Alice Host',
        text: 'Welcome everyone to Sprint 42 planning. We have a lot to cover today.',
        startMs: 0,
        endMs: 5000,
      },
      {
        seq: 2,
        speakerLabel: 'Alice Host',
        text: 'I will finalize the backend API specification document by Thursday afternoon.',
        startMs: 6000,
        endMs: 12000,
      },
      {
        seq: 3,
        speakerLabel: 'Bob Developer',
        text: 'Sounds good. I will implement the user authentication endpoint by next Tuesday.',
        startMs: 13000,
        endMs: 20000,
      },
      {
        seq: 4,
        speakerLabel: 'Charlie Architect',
        text: 'We could maybe rewrite the entire database layer in Rust at some point next year.',
        startMs: 21000,
        endMs: 28000,
      },
      {
        seq: 5,
        speakerLabel: 'Alice Host',
        text: 'No, let us keep our existing PostgreSQL stack. We agreed to stick with PostgreSQL for v1.',
        startMs: 29000,
        endMs: 36000,
      },
      {
        seq: 6,
        speakerLabel: 'Bob Developer',
        text: 'Should we migrate to Redis Cluster or single instance for session cache?',
        startMs: 37000,
        endMs: 44000,
      },
    ],
    expectedDecisions: ['Stick with PostgreSQL for v1'],
    expectedOpenQuestions: ['Should we migrate to Redis Cluster or single instance for session cache?'],
    expectedActionItems: [
      {
        text: 'Finalize backend API specification document',
        ownerName: 'Alice Host',
        duePhrase: 'by Thursday afternoon',
        evidenceSeqs: [2],
      },
      {
        text: 'Implement user authentication endpoint',
        ownerName: 'Bob Developer',
        duePhrase: 'by next Tuesday',
        evidenceSeqs: [3],
      },
    ],
    negatedActionPhrases: [],
    exploratoryPhrases: ['rewrite the entire database layer in Rust'],
  },
  {
    id: 'golden-mtg-02',
    title: 'Incident Postmortem & Mitigation',
    segments: [
      {
        seq: 1,
        speakerLabel: 'David Lead',
        text: 'Reviewing yesterday incident. I was going to deploy the patch tonight.',
        startMs: 0,
        endMs: 6000,
      },
      {
        seq: 2,
        speakerLabel: 'David Lead',
        text: 'Actually wait, scratch that. Do not deploy the patch tonight because staging is unstable.',
        startMs: 7000,
        endMs: 14000,
      },
      {
        seq: 3,
        speakerLabel: 'Emma Ops',
        text: 'Understood. I will investigate the staging environment instability tomorrow morning at 9am.',
        startMs: 15000,
        endMs: 22000,
      },
      {
        seq: 4,
        speakerLabel: 'David Lead',
        text: 'We officially decided to freeze production releases until staging tests pass.',
        startMs: 23000,
        endMs: 30000,
      },
    ],
    expectedDecisions: ['Freeze production releases until staging tests pass'],
    expectedOpenQuestions: [],
    expectedActionItems: [
      {
        text: 'Investigate the staging environment instability',
        ownerName: 'Emma Ops',
        duePhrase: 'tomorrow morning at 9am',
        evidenceSeqs: [3],
      },
    ],
    negatedActionPhrases: ['deploy the patch tonight'],
    exploratoryPhrases: [],
  },
];
