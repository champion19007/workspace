import crypto from 'crypto';

export interface NormalizedTranscriptSegment {
  seq: number;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
  checksum: string;
  sourceCueId?: string;
}

export interface TranscriptSourceFile {
  filename?: string;
  fileOffsetMs?: number;
  byteCount: number;
  checksum: string;
  cueCount: number;
}

export interface TranscriptManifest {
  files: TranscriptSourceFile[];
  totalCues: number;
  totalSegments: number;
  durationMs: number;
  rawTranscriptObjectKey?: string;
  rawTranscriptChecksum: string;
  rawTranscriptByteCount: number;
  processedAt: string;
}

export interface RawCue {
  sourceCueId?: string;
  startMs: number;
  endMs: number;
  speakerLabel: string;
  text: string;
}

/**
 * Converts WebVTT timestamp (HH:MM:SS.mmm or MM:SS.mmm) to milliseconds.
 */
export function parseVttTimestampToMs(timestampStr: string): number {
  const clean = timestampStr.trim();
  const parts = clean.split(':');

  if (parts.length === 3) {
    const hours = parseInt(parts[0] ?? '0', 10);
    const minutes = parseInt(parts[1] ?? '0', 10);
    const secPart = parts[2] ?? '';
    const secParts = secPart.split('.');
    const seconds = parseInt(secParts[0] ?? '0', 10);
    const ms = parseInt(secParts[1] ?? '0', 10);
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
      throw new Error(`Invalid WebVTT timestamp format: "${timestampStr}"`);
    }
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
  } else if (parts.length === 2) {
    const minutes = parseInt(parts[0] ?? '0', 10);
    const secPart = parts[1] ?? '';
    const secParts = secPart.split('.');
    const seconds = parseInt(secParts[0] ?? '0', 10);
    const ms = parseInt(secParts[1] ?? '0', 10);
    if (isNaN(minutes) || isNaN(seconds) || secParts.length < 2) {
      throw new Error(`Invalid WebVTT timestamp format: "${timestampStr}"`);
    }
    return minutes * 60000 + seconds * 1000 + ms;
  }

  throw new Error(`Invalid WebVTT timestamp format: "${timestampStr}"`);
}

/**
 * Strips HTML / WebVTT formatting tags, decodes HTML entities, and extracts speaker.
 */
export function cleanVttCueText(rawLines: string[]): { speakerLabel: string; text: string } {
  let combined = rawLines.join(' ').trim();
  let speakerLabel = 'Speaker';

  // 1. Check WebVTT voice tag: <v Speaker Name>Text</v> or <v.class Speaker Name>Text
  const voiceTagRegex = /^<v(?:\.[^>]+)?\s+([^>]+)>(.*?)(?:<\/v>)?$/s;
  const voiceMatch = combined.match(voiceTagRegex);
  if (voiceMatch && voiceMatch[1] && voiceMatch[2] !== undefined) {
    speakerLabel = voiceMatch[1].trim();
    combined = voiceMatch[2];
  } else {
    // 2. Check prefix: "Speaker Name: Text" or "<b>Speaker Name:</b> Text"
    const prefixRegex = /^(?:<[bB]>)?([A-Za-z0-9\s._'-]{1,64}):(?:<\/[bB]>)?\s*(.*)$/s;
    const prefixMatch = combined.match(prefixRegex);
    if (prefixMatch && prefixMatch[1] && prefixMatch[2] !== undefined) {
      speakerLabel = prefixMatch[1].trim();
      combined = prefixMatch[2];
    }
  }

  // Strip remaining HTML/VTT tags e.g. <b>, </i>, <c.color>, </v>
  combined = combined.replace(/<\/?[a-zA-Z0-9]+(?:\.[^>]+)?[^>]*>/g, '');

  // Decode common HTML entities
  combined = combined
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Collapse whitespace
  combined = combined.replace(/\s+/g, ' ').trim();

  return {
    speakerLabel: speakerLabel || 'Speaker',
    text: combined,
  };
}

/**
 * Validates that string starts with WEBVTT signature (ignoring UTF-8 BOM).
 */
export function isValidWebVtt(vttContent: string): boolean {
  const sanitized = vttContent.replace(/^\uFEFF/, '').trimStart();
  return sanitized.startsWith('WEBVTT');
}

/**
 * Parses raw WebVTT file content into a list of RawCues.
 * Skips NOTE, STYLE, and REGION blocks.
 */
export function parseWebVtt(vttContent: string, fileOffsetMs: number = 0): RawCue[] {
  if (!isValidWebVtt(vttContent)) {
    throw new Error('Invalid WebVTT content: missing WEBVTT header');
  }

  const sanitized = vttContent.replace(/^\uFEFF/, '');
  // Split into blocks by double newlines
  const blocks = sanitized.split(/\r?\n\r?\n+/);
  const cues: RawCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);

    if (lines.length === 0) continue;

    const firstLine = lines[0]?.trim() ?? '';

    // Skip WEBVTT header line or standalone header blocks
    if (firstLine.startsWith('WEBVTT')) continue;

    // Skip NOTE, STYLE, REGION blocks
    if (
      firstLine.startsWith('NOTE') ||
      firstLine.startsWith('STYLE') ||
      firstLine.startsWith('REGION')
    ) {
      continue;
    }

    // Find the timestamp line: contains "-->"
    let timestampLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line && line.includes('-->')) {
        timestampLineIdx = i;
        break;
      }
    }

    if (timestampLineIdx === -1) {
      // Not a valid cue block
      continue;
    }

    let cueId: string | undefined;
    if (timestampLineIdx > 0) {
      cueId = lines[timestampLineIdx - 1]?.trim();
    }

    const timestampLine = lines[timestampLineIdx]?.trim() ?? '';
    const arrowIdx = timestampLine.indexOf('-->');
    const startStr = timestampLine.substring(0, arrowIdx).trim();
    const rest = timestampLine.substring(arrowIdx + 3).trim();

    // The end timestamp is the first token of 'rest' (before any cue settings)
    const endStr = rest.split(/\s+/)[0] ?? '';

    try {
      const rawStartMs = parseVttTimestampToMs(startStr);
      const rawEndMs = parseVttTimestampToMs(endStr);

      const textLines = lines.slice(timestampLineIdx + 1);
      const { speakerLabel, text } = cleanVttCueText(textLines);

      if (text.length > 0) {
        cues.push({
          sourceCueId: cueId,
          startMs: Math.max(0, rawStartMs + fileOffsetMs),
          endMs: Math.max(0, rawEndMs + fileOffsetMs),
          speakerLabel,
          text,
        });
      }
    } catch {
      // Ignore malformed timestamp lines
      continue;
    }
  }

  return cues;
}

export interface VttSourceInput {
  vttContent: string;
  fileOffsetMs?: number;
  filename?: string;
}

/**
 * Normalizes one or more WebVTT transcripts into deterministic evidence segments:
 * - Sorts cues by time
 * - Merges adjacent same-speaker runs with gap <= 2000ms
 * - Generates stable sequence numbers (1, 2, ...)
 * - Computes SHA-256 checksums per segment and overall
 */
export function normalizeTranscripts(
  inputs: VttSourceInput[],
  rawTranscriptObjectKey?: string
): {
  segments: NormalizedTranscriptSegment[];
  manifest: TranscriptManifest;
} {
  const allCues: RawCue[] = [];
  const sourceFiles: TranscriptSourceFile[] = [];
  let combinedRawBytes = 0;
  const rawHash = crypto.createHash('sha256');

  for (const input of inputs) {
    const byteCount = Buffer.byteLength(input.vttContent, 'utf-8');
    combinedRawBytes += byteCount;
    const fileChecksum = crypto.createHash('sha256').update(input.vttContent).digest('hex');
    rawHash.update(input.vttContent);

    const cues = parseWebVtt(input.vttContent, input.fileOffsetMs || 0);
    allCues.push(...cues);

    sourceFiles.push({
      filename: input.filename,
      fileOffsetMs: input.fileOffsetMs || 0,
      byteCount,
      checksum: fileChecksum,
      cueCount: cues.length,
    });
  }

  const rawTranscriptChecksum = rawHash.digest('hex');

  // Sort chronologically
  allCues.sort((a, b) => {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return a.endMs - b.endMs;
  });

  // Merge adjacent same-speaker runs with gap <= 2000ms
  const mergedCues: RawCue[] = [];

  for (const cue of allCues) {
    if (mergedCues.length === 0) {
      mergedCues.push({ ...cue });
      continue;
    }

    const prev = mergedCues[mergedCues.length - 1];
    if (!prev) {
      mergedCues.push({ ...cue });
      continue;
    }

    const isSameSpeaker =
      prev.speakerLabel.trim().toLowerCase() === cue.speakerLabel.trim().toLowerCase();
    const gap = cue.startMs - prev.endMs;

    if (isSameSpeaker && gap >= 0 && gap <= 2000) {
      prev.endMs = Math.max(prev.endMs, cue.endMs);
      prev.text = `${prev.text} ${cue.text}`;
      if (cue.sourceCueId) {
        prev.sourceCueId = prev.sourceCueId
          ? `${prev.sourceCueId},${cue.sourceCueId}`
          : cue.sourceCueId;
      }
    } else {
      mergedCues.push({ ...cue });
    }
  }

  // Assign stable sequential indices and checksums
  let maxEndMs = 0;
  const segments: NormalizedTranscriptSegment[] = mergedCues.map((cue, idx) => {
    if (cue.endMs > maxEndMs) maxEndMs = cue.endMs;
    const checksum = crypto.createHash('sha256').update(cue.text).digest('hex');

    return {
      seq: idx + 1,
      speakerLabel: cue.speakerLabel,
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.text,
      checksum,
      sourceCueId: cue.sourceCueId,
    };
  });

  const manifest: TranscriptManifest = {
    files: sourceFiles,
    totalCues: allCues.length,
    totalSegments: segments.length,
    durationMs: maxEndMs,
    rawTranscriptObjectKey,
    rawTranscriptChecksum,
    rawTranscriptByteCount: combinedRawBytes,
    processedAt: new Date().toISOString(),
  };

  return { segments, manifest };
}
