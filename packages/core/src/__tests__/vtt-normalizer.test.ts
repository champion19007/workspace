import { describe, it, expect } from 'vitest';
import {
  parseVttTimestampToMs,
  cleanVttCueText,
  isValidWebVtt,
  parseWebVtt,
  normalizeTranscripts,
} from '../zoom/vtt-normalizer.js';

describe('WebVTT Normalizer & Evidence Anchors', () => {
  describe('Timestamp Parsing', () => {
    it('correctly parses HH:MM:SS.mmm timestamps into milliseconds', () => {
      expect(parseVttTimestampToMs('00:00:01.000')).toBe(1000);
      expect(parseVttTimestampToMs('01:02:03.456')).toBe(3723456);
      expect(parseVttTimestampToMs('10:00:00.000')).toBe(36000000);
    });

    it('correctly parses MM:SS.mmm timestamps into milliseconds', () => {
      expect(parseVttTimestampToMs('01:30.500')).toBe(90500);
      expect(parseVttTimestampToMs('00:05.120')).toBe(5120);
    });

    it('throws on invalid timestamp formats', () => {
      expect(() => parseVttTimestampToMs('invalid-time')).toThrow('Invalid WebVTT timestamp');
      expect(() => parseVttTimestampToMs('01:02')).toThrow('Invalid WebVTT timestamp');
    });
  });

  describe('Cue Text Cleaning & Speaker Extraction', () => {
    it('extracts speaker label from <v Name> voice tags', () => {
      const res = cleanVttCueText(['<v Alice Chen>Welcome to the sprint review!</v>']);
      expect(res.speakerLabel).toBe('Alice Chen');
      expect(res.text).toBe('Welcome to the sprint review!');
    });

    it('extracts speaker label from unclosed <v Name> voice tags', () => {
      const res = cleanVttCueText(['<v Bob Builder>Can we fix it?']);
      expect(res.speakerLabel).toBe('Bob Builder');
      expect(res.text).toBe('Can we fix it?');
    });

    it('extracts speaker label from Speaker: prefix and strips bold tags', () => {
      const res1 = cleanVttCueText(['Carol Danvers: Roger that, captain.']);
      expect(res1.speakerLabel).toBe('Carol Danvers');
      expect(res1.text).toBe('Roger that, captain.');

      const res2 = cleanVttCueText(['<b>Dave Miller:</b> The database migration finished.']);
      expect(res2.speakerLabel).toBe('Dave Miller');
      expect(res2.text).toBe('The database migration finished.');
    });

    it('strips inline HTML/VTT tags and decodes HTML entities while preserving wording', () => {
      const res = cleanVttCueText([
        '<v Frank>This is <i>critical</i> &amp; urgent: we need &gt; 99% uptime &#39;now&#39;!</v>',
      ]);
      expect(res.speakerLabel).toBe('Frank');
      expect(res.text).toBe("This is critical & urgent: we need > 99% uptime 'now'!");
    });

    it('defaults speaker label to Speaker when no speaker metadata is present', () => {
      const res = cleanVttCueText(['Just ambient noise or untagged sentence.']);
      expect(res.speakerLabel).toBe('Speaker');
      expect(res.text).toBe('Just ambient noise or untagged sentence.');
    });
  });

  describe('WebVTT Parsing & Block Filtering', () => {
    it('validates WEBVTT header and handles optional UTF-8 BOM', () => {
      expect(isValidWebVtt('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHello')).toBe(true);
      expect(isValidWebVtt('\uFEFFWEBVTT - Zoom Cloud Transcript\n\n')).toBe(true);
      expect(isValidWebVtt('<!DOCTYPE html><html><body>Login</body></html>')).toBe(false);
      expect(isValidWebVtt('{"error": "Unauthorized"}')).toBe(false);
    });

    it('ignores NOTE, STYLE, and REGION blocks', () => {
      const vtt = `WEBVTT

NOTE This is a note comment
that spans multiple lines

STYLE
::cue { color: #fff; }

REGION
id:banner width:100% lines:3

1
00:00:01.000 --> 00:00:03.000
<v Alice>First cue</v>

NOTE another note

2
00:00:04.000 --> 00:00:06.000
<v Bob>Second cue</v>
`;

      const cues = parseWebVtt(vtt);
      expect(cues).toHaveLength(2);
      expect(cues[0]!).toEqual({
        sourceCueId: '1',
        startMs: 1000,
        endMs: 3000,
        speakerLabel: 'Alice',
        text: 'First cue',
      });
      expect(cues[1]!).toEqual({
        sourceCueId: '2',
        startMs: 4000,
        endMs: 6000,
        speakerLabel: 'Bob',
        text: 'Second cue',
      });
    });

    it('parses cues with cue settings on timestamp line', () => {
      const vtt = `WEBVTT

00:00:01.500 --> 00:00:03.500 position:10%,line:90% align:start size:50%
<v Carol>Hello with settings</v>
`;

      const cues = parseWebVtt(vtt);
      expect(cues).toHaveLength(1);
      expect(cues[0]!.startMs).toBe(1500);
      expect(cues[0]!.endMs).toBe(3500);
      expect(cues[0]!.speakerLabel).toBe('Carol');
      expect(cues[0]!.text).toBe('Hello with settings');
    });

    it('applies fileOffsetMs for multi-file alignment', () => {
      const vtt = `WEBVTT

1
00:00:02.000 --> 00:00:05.000
<v Dave>File 2 speech</v>
`;
      const cues = parseWebVtt(vtt, 60000); // 60s offset
      expect(cues).toHaveLength(1);
      expect(cues[0]!.startMs).toBe(62000);
      expect(cues[0]!.endMs).toBe(65000);
    });
  });

  describe('Transcript Normalization & Adjacent Speaker Merging', () => {
    it('merges adjacent same-speaker runs when gap is <= 2000ms', () => {
      const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
<v Alice>Let us discuss the roadmap.</v>

2
00:00:04.000 --> 00:00:06.000
<v Alice>Specifically the quarterly targets.</v>

3
00:00:07.500 --> 00:00:09.000
<v Alice>And team hiring plans.</v>
`;

      const { segments, manifest } = normalizeTranscripts([{ vttContent: vtt }]);
      expect(manifest.totalCues).toBe(3);
      expect(manifest.totalSegments).toBe(1);
      expect(segments).toHaveLength(1);

      const merged = segments[0]!;
      expect(merged.seq).toBe(1);
      expect(merged.speakerLabel).toBe('Alice');
      expect(merged.startMs).toBe(1000);
      expect(merged.endMs).toBe(9000);
      expect(merged.text).toBe(
        'Let us discuss the roadmap. Specifically the quarterly targets. And team hiring plans.'
      );
      expect(merged.checksum).toBeDefined();
      expect(merged.sourceCueId).toBe('1,2,3');
    });

    it('does not merge different speakers even if gap is <= 2000ms', () => {
      const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
<v Alice>What is the status?</v>

2
00:00:03.500 --> 00:00:05.000
<v Bob>All green.</v>
`;

      const { segments } = normalizeTranscripts([{ vttContent: vtt }]);
      expect(segments).toHaveLength(2);
      expect(segments[0]!.seq).toBe(1);
      expect(segments[0]!.speakerLabel).toBe('Alice');
      expect(segments[1]!.seq).toBe(2);
      expect(segments[1]!.speakerLabel).toBe('Bob');
    });

    it('does not merge same speaker when gap exceeds 2000ms', () => {
      const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
<v Alice>Starting statement.</v>

2
00:00:06.000 --> 00:00:08.000
<v Alice>Later thought after 3 second pause.</v>
`;

      const { segments } = normalizeTranscripts([{ vttContent: vtt }]);
      expect(segments).toHaveLength(2);
      expect(segments[0]!.seq).toBe(1);
      expect(segments[0]!.endMs).toBe(3000);
      expect(segments[1]!.seq).toBe(2);
      expect(segments[1]!.startMs).toBe(6000);
    });

    it('produces immutable sequence numbers and SHA-256 evidence anchors', () => {
      const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:02.000
<v Alice>Segment one</v>

2
00:00:05.000 --> 00:00:06.000
<v Bob>Segment two</v>

3
00:00:10.000 --> 00:00:11.000
<v Charlie>Segment three</v>
`;

      const { segments, manifest } = normalizeTranscripts([
        { vttContent: vtt, filename: 'meeting-part1.vtt' },
      ], 'raw-transcripts/org1/meet1/att1.vtt');

      expect(segments.map((s) => s.seq)).toEqual([1, 2, 3]);
      expect(segments[0]!.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.rawTranscriptObjectKey).toBe('raw-transcripts/org1/meet1/att1.vtt');
      expect(manifest.rawTranscriptChecksum).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.durationMs).toBe(11000);
    });
  });
});
