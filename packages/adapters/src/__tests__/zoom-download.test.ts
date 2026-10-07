import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockZoomClientAdapter, HttpZoomClientAdapter } from '../zoom/index.js';

describe('Stage 13: Zoom Transcript Download Adapter', () => {
  describe('MockZoomClientAdapter', () => {
    let mockClient: MockZoomClientAdapter;

    beforeEach(() => {
      mockClient = new MockZoomClientAdapter();
    });

    it('downloads default WebVTT transcript for HTTPS URL', async () => {
      const vtt = await mockClient.downloadTranscriptFile(
        'mock-token',
        'https://api.zoom.us/v2/recordings/download/transcript.vtt'
      );
      expect(vtt).toContain('WEBVTT');
      expect(vtt).toContain('Alex Lead');
    });

    it('returns custom mock transcript if registered', async () => {
      const customVtt = `WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n<v Alice>Custom</v>`;
      mockClient.mockTranscripts.set('https://api.zoom.us/custom.vtt', customVtt);

      const res = await mockClient.downloadTranscriptFile('mock-token', 'https://api.zoom.us/custom.vtt');
      expect(res).toBe(customVtt);
    });

    it('rejects non-HTTPS download URLs', async () => {
      await expect(
        mockClient.downloadTranscriptFile('mock-token', 'http://insecure.zoom.us/transcript.vtt')
      ).rejects.toThrow('Only HTTPS downloads are permitted');
    });
  });

  describe('HttpZoomClientAdapter', () => {
    let client: HttpZoomClientAdapter;

    beforeEach(() => {
      client = new HttpZoomClientAdapter({
        clientId: 'test-client',
        clientSecret: 'test-secret',
      });
      vi.restoreAllMocks();
    });

    it('rejects non-HTTPS download URLs immediately', async () => {
      await expect(
        client.downloadTranscriptFile('token', 'http://api.zoom.us/rec.vtt')
      ).rejects.toThrow('Only HTTPS downloads are permitted');
    });

    it('strips Authorization header when redirected to a different origin (e.g. AWS S3)', async () => {
      const origin1 = 'https://api.zoom.us/v2/recordings/download/file.vtt';
      const origin2 = 'https://ssr-zoom-recordings.s3.amazonaws.com/presigned-file.vtt';

      const calls: Array<{ url: string; authHeader: string | null }> = [];

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        calls.push({
          url,
          authHeader: headers?.['Authorization'] ?? null,
        });

        if (url === origin1) {
          return new Response(null, {
            status: 302,
            headers: { Location: origin2 },
          });
        }

        if (url === origin2) {
          return new Response('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n<v Alice>Hello</v>', {
            status: 200,
            headers: { 'Content-Type': 'text/vtt' },
          });
        }

        return new Response('Not found', { status: 404 });
      }) as any;

      const result = await client.downloadTranscriptFile('my-secret-access-token', origin1);
      expect(result).toContain('WEBVTT');
      expect(calls).toHaveLength(2);

      // Initial call to zoom.us had Authorization header
      expect(calls[0]?.url).toBe(origin1);
      expect(calls[0]?.authHeader).toBe('Bearer my-secret-access-token');

      // Redirected call to s3 had Authorization stripped!
      expect(calls[1]?.url).toBe(origin2);
      expect(calls[1]?.authHeader).toBeNull();
    });

    it('rejects HTML error/login page responses masquerading as transcripts', async () => {
      global.fetch = vi.fn().mockImplementation(
        async () =>
          new Response('<!DOCTYPE html><html><body>Sign in with SSO</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          })
      ) as any;

      await expect(
        client.downloadTranscriptFile('token', 'https://api.zoom.us/file.vtt')
      ).rejects.toThrow('Downloaded file is an HTML error/login page');
    });

    it('rejects files exceeding 50MB limit', async () => {
      global.fetch = vi.fn().mockImplementation(
        async () =>
          new Response('small content', {
            status: 200,
            headers: {
              'Content-Length': String(60 * 1024 * 1024), // 60MB
            },
          })
      ) as any;

      await expect(
        client.downloadTranscriptFile('token', 'https://api.zoom.us/large.vtt')
      ).rejects.toThrow('exceeds maximum limit of 50MB');
    });
  });
});
