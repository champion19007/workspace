import {
  type LLMPort,
  type EvidenceSegmentDTO,
  APP_TIME_ZONE,
} from '@workspace/core';

export interface ProjectMemberCandidate {
  userId: string;
  name: string;
  email: string;
}

export interface SpeakerContext {
  seq: number;
  speakerLabel: string;
  resolvedUserId?: string | null;
  displayName?: string | null;
}

export interface ResolveOwnerParams {
  actionText: string;
  ownerName?: string | null;
  evidence: EvidenceSegmentDTO[];
  speakersBySeq?: Map<number, SpeakerContext>;
  projectMembers: ProjectMemberCandidate[];
  llmPort?: LLMPort;
}

export interface ResolveOwnerResult {
  suggestedOwnerId: string | null;
  resolutionMethod: string;
  confidence: number;
  explanation: string;
}

/**
 * Resolves suggested owner for an action item using conservative rules:
 * 1. Speaker commitment in evidence ("I will...", "I'll...", "Let me...") matched to resolved speaker ID.
 * 2. Explicit verified identity / owner_name matching against permitted project members:
 *    - Exact email match.
 *    - Exact full name match.
 *    - Unique first name match.
 *    - Disambiguation for ambiguous candidates via fast LLM tier with finite candidate set.
 * 3. Text mention of unique permitted member name.
 * 4. Default: Ambiguous / Unresolved.
 */
export async function resolveActionItemOwner(
  params: ResolveOwnerParams
): Promise<ResolveOwnerResult> {
  const { actionText, ownerName, evidence, speakersBySeq, projectMembers, llmPort } = params;

  if (projectMembers.length === 0) {
    return {
      suggestedOwnerId: null,
      resolutionMethod: 'unresolved',
      confidence: 0,
      explanation: 'No permitted active project members available for owner assignment',
    };
  }

  // 1. Speaker Commitment Rule:
  // First-person statements ("I will", "I'll", "I can", "Let me", "I am going to", "I'll take")
  const commitmentRegex = /^(?:i\s+will|i'll|i\s+can|let\s+me|i\s+am\s+going\s+to|i'm\s+going\s+to|i\s+promise|i'll\s+take)\b/i;
  for (const ev of evidence) {
    const quote = (ev.canonicalExcerpt || ev.quote || '').trim();
    if (commitmentRegex.test(quote) && speakersBySeq) {
      const speaker = speakersBySeq.get(ev.seq);
      if (speaker?.resolvedUserId) {
        // Confirm resolved user is an active permitted project member
        const matchedMember = projectMembers.find((m) => m.userId === speaker.resolvedUserId);
        if (matchedMember) {
          return {
            suggestedOwnerId: matchedMember.userId,
            resolutionMethod: 'speaker_commitment',
            confidence: 0.95,
            explanation: `Speaker ${speaker.displayName || speaker.speakerLabel} made first-person commitment in cue #${ev.seq}`,
          };
        }
      }
    }
  }

  // 2. Explicit Name Matching:
  if (ownerName && ownerName.trim()) {
    const cleanName = ownerName.trim().toLowerCase();

    // 2a. Exact email match
    const emailMatch = projectMembers.find((m) => m.email.toLowerCase() === cleanName);
    if (emailMatch) {
      return {
        suggestedOwnerId: emailMatch.userId,
        resolutionMethod: 'explicit_email_exact',
        confidence: 0.95,
        explanation: `Explicit email match for "${ownerName}"`,
      };
    }

    // 2b. Exact full name match
    const fullNameMatches = projectMembers.filter(
      (m) => m.name.trim().toLowerCase() === cleanName
    );
    if (fullNameMatches.length === 1) {
      return {
        suggestedOwnerId: fullNameMatches[0]!.userId,
        resolutionMethod: 'explicit_name_exact',
        confidence: 0.90,
        explanation: `Exact full name match for "${ownerName}"`,
      };
    }

    // 2c. Unique first name match
    const firstNameMatches = projectMembers.filter((m) => {
      const firstName = m.name.trim().split(/\s+/)[0]?.toLowerCase();
      return firstName === cleanName;
    });

    if (firstNameMatches.length === 1) {
      return {
        suggestedOwnerId: firstNameMatches[0]!.userId,
        resolutionMethod: 'explicit_first_name_unique',
        confidence: 0.85,
        explanation: `Unique first name match for "${ownerName}" (${firstNameMatches[0]!.name})`,
      };
    }

    // 2d. Ambiguous candidate set (multiple matches for first name)
    if (firstNameMatches.length > 1 && llmPort) {
      try {
        const candidateIds = new Set(firstNameMatches.map((c) => c.userId));
        const disambiguationPrompt = {
          task: 'Select the best matching user ID from the candidate list based on the action text.',
          actionText,
          ownerName,
          candidates: firstNameMatches.map((c) => ({ id: c.userId, name: c.name, email: c.email })),
        };

        const result = await llmPort.complete<{ userId: string }>({
          promptId: 'resolve.owner_and_due',
          promptVersion: '1.0.0',
          tier: 'fast',
          input: disambiguationPrompt,
          schema: {
            parse: (val: unknown) => {
              if (val && typeof val === 'object' && 'userId' in val && typeof (val as any).userId === 'string') {
                return val as { userId: string };
              }
              throw new Error('Missing valid userId in LLM response');
            },
          } as any,
          temperature: 0,
        });

        if (result.data?.userId && candidateIds.has(result.data.userId)) {
          return {
            suggestedOwnerId: result.data.userId,
            resolutionMethod: 'llm_candidate_disambiguation',
            confidence: 0.75,
            explanation: `Fast LLM disambiguated among ${firstNameMatches.length} candidates for "${ownerName}"`,
          };
        }
      } catch {
        // Fall back to ambiguous
      }

      return {
        suggestedOwnerId: null,
        resolutionMethod: 'ambiguous_name',
        confidence: 0,
        explanation: `Multiple project members match "${ownerName}" (${firstNameMatches.map((m) => m.name).join(', ')})`,
      };
    }
  }

  // 3. Text Mention of Unique Project Member
  const lowerText = actionText.toLowerCase();
  const mentionedMembers = projectMembers.filter((m) => {
    const fullName = m.name.trim().toLowerCase();
    const firstName = fullName.split(/\s+/)[0]!;
    return (
      (fullName.length >= 4 && lowerText.includes(fullName)) ||
      (firstName.length >= 3 && new RegExp(`\\b${firstName}\\b`, 'i').test(lowerText))
    );
  });

  if (mentionedMembers.length === 1) {
    return {
      suggestedOwnerId: mentionedMembers[0]!.userId,
      resolutionMethod: 'text_name_unique',
      confidence: 0.80,
      explanation: `Unique project member mention in action text (${mentionedMembers[0]!.name})`,
    };
  }

  // 4. Default: Unresolved
  return {
    suggestedOwnerId: null,
    resolutionMethod: 'unresolved',
    confidence: 0,
    explanation: 'No unambiguous permitted project member could be resolved',
  };
}

export interface KolkataDate {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  dateStr: string;   // YYYY-MM-DD
}

/**
 * Computes meeting date components in the deployment's time zone (APP_TIME_ZONE, Asia/Kolkata by default).
 * Never uses server processing date or client browser local timezone.
 */
export function getMeetingDateInKolkata(meetingTimestampIso: string): KolkataDate {
  const date = new Date(meetingTimestampIso);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }
  const year = parseInt(partMap.year!, 10);
  const month = parseInt(partMap.month!, 10);
  const day = parseInt(partMap.day!, 10);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayOfWeek = weekdays.indexOf(partMap.weekday!);

  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${year}-${pad(month)}-${pad(day)}`;

  return { year, month, day, dayOfWeek, dateStr };
}

/**
 * Adds an integer number of calendar days to a YYYY-MM-DD date string.
 * Accurately handles month boundaries, year boundaries, and leap years.
 */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export interface ResolveDueDateParams {
  duePhrase?: string | null;
  meetingStartIso: string;
}

export interface ResolveDueDateResult {
  suggestedDue: string | null; // YYYY-MM-DD
  status: 'resolved' | 'ambiguous' | 'none';
  explanation: string;
}

const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/**
 * Resolves due date from spoken due phrase relative to the meeting start date in the deployment's time zone.
 * Calendar policy:
 * - Ambiguous phrases ("soon", "asap", "tbd") are left null with status='ambiguous'.
 * - "today", "tomorrow", relative day counts ("in 3 days", "in 2 weeks").
 * - Weekday expressions ("by Friday", "this Tuesday", "next Monday").
 * - Explicit dates ("May 15th", "2026-05-15", "March 1st").
 */
export function resolveActionItemDueDate(params: ResolveDueDateParams): ResolveDueDateResult {
  const { duePhrase, meetingStartIso } = params;

  if (!duePhrase || !duePhrase.trim()) {
    return {
      suggestedDue: null,
      status: 'none',
      explanation: 'No due date phrase mentioned',
    };
  }

  const clean = duePhrase.trim().toLowerCase();
  const ref = getMeetingDateInKolkata(meetingStartIso);

  // 1. Ambiguous relative expressions: leave null
  if (/\b(?:soon|asap|whenever|next\s+time|in\s+the\s+future|sometime|tbd|later|eventually|at\s+some\s+point)\b/i.test(clean)) {
    return {
      suggestedDue: null,
      status: 'ambiguous',
      explanation: `Ambiguous phrase "${duePhrase}" cannot be mapped to a calendar date`,
    };
  }

  // 2. ISO date match (YYYY-MM-DD)
  const isoMatch = clean.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return {
      suggestedDue: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`,
      status: 'resolved',
      explanation: `Explicit ISO date ${isoMatch[0]}`,
    };
  }

  // 3. Today expressions
  if (/\b(?:today|end\s+of\s+today|eod\s+today|by\s+today)\b/i.test(clean)) {
    return {
      suggestedDue: ref.dateStr,
      status: 'resolved',
      explanation: `Today in ${APP_TIME_ZONE} (${ref.dateStr})`,
    };
  }

  // 4. Tomorrow expressions
  if (/\b(?:tomorrow|end\s+of\s+tomorrow|eod\s+tomorrow|by\s+tomorrow)\b/i.test(clean)) {
    const due = addDaysToDateStr(ref.dateStr, 1);
    return {
      suggestedDue: due,
      status: 'resolved',
      explanation: `Tomorrow in ${APP_TIME_ZONE} (${due})`,
    };
  }

  // 5. Relative day count: "in N days", "N days from now"
  const inDaysMatch = clean.match(/\bin\s+(\d+)\s+days?\b/i) || clean.match(/\b(\d+)\s+days?\s+from\s+now\b/i);
  if (inDaysMatch) {
    const days = parseInt(inDaysMatch[1]!, 10);
    const due = addDaysToDateStr(ref.dateStr, days);
    return {
      suggestedDue: due,
      status: 'resolved',
      explanation: `In ${days} days from meeting date in ${APP_TIME_ZONE} (${due})`,
    };
  }

  // 6. Relative week count: "in a week", "in 1 week", "in 2 weeks"
  if (/\bin\s+(?:a|1)\s+week\b/i.test(clean)) {
    const due = addDaysToDateStr(ref.dateStr, 7);
    return {
      suggestedDue: due,
      status: 'resolved',
      explanation: `In 1 week from meeting date in ${APP_TIME_ZONE} (${due})`,
    };
  }
  const inWeeksMatch = clean.match(/\bin\s+(\d+)\s+weeks?\b/i);
  if (inWeeksMatch) {
    const weeks = parseInt(inWeeksMatch[1]!, 10);
    const due = addDaysToDateStr(ref.dateStr, weeks * 7);
    return {
      suggestedDue: due,
      status: 'resolved',
      explanation: `In ${weeks} weeks from meeting date in ${APP_TIME_ZONE} (${due})`,
    };
  }

  // 7. Weekday expressions ("by Friday", "this Friday", "next Monday", "on Tuesday")
  for (const [dayName, dayIndex] of Object.entries(WEEKDAY_NAMES)) {
    const weekdayRegex = new RegExp(`\\b(?:by|this|on|next)?\\s*${dayName}\\b`, 'i');
    if (weekdayRegex.test(clean)) {
      let diff = (dayIndex - ref.dayOfWeek + 7) % 7;
      if (diff === 0) {
        diff = 7; // e.g. "by Friday" or "next Friday" on Friday means next Friday (+7)
      }
      const due = addDaysToDateStr(ref.dateStr, diff);
      return {
        suggestedDue: due,
        status: 'resolved',
        explanation: `${duePhrase} in ${APP_TIME_ZONE} (+${diff} days -> ${due})`,
      };
    }
  }

  // 8. Explicit Month and Day: "May 15th", "15 May", "May 15, 2026"
  for (const [monthName, monthNum] of Object.entries(MONTH_NAMES)) {
    const monthRegex = new RegExp(`(?:${monthName})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'i');
    const dayMonthRegex = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${monthName})(?:,?\\s+(\\d{4}))?`, 'i');

    const match = clean.match(monthRegex) || clean.match(dayMonthRegex);
    if (match) {
      const day = parseInt(match[1]!, 10);
      let year = match[2] ? parseInt(match[2], 10) : ref.year;

      // If the month/day is in the past relative to the meeting in the same year, assume next year
      if (!match[2] && (monthNum < ref.month || (monthNum === ref.month && day < ref.day))) {
        year += 1;
      }

      const pad = (n: number) => String(n).padStart(2, '0');
      const due = `${year}-${pad(monthNum)}-${pad(day)}`;
      return {
        suggestedDue: due,
        status: 'resolved',
        explanation: `Explicit calendar date ${duePhrase} (${due})`,
      };
    }
  }

  return {
    suggestedDue: null,
    status: 'ambiguous',
    explanation: `Could not parse due phrase "${duePhrase}" into a specific date`,
  };
}
