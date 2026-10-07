import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockZoomClientAdapter, HttpZoomClientAdapter } from '../zoom/index.js';
import { encodeZoomMeetingUuid } from '@workspace/core';

describe('Zoom Client Adapter — Participants & UUID Handling (Stage 14)', () => {
  describe('MockZoomClientAdapter', () => {
    let mockAdapter: MockZoomClientAdapter;

    beforeEach(() => {
      mockAdapter = new MockZoomClientAdapter();
    });

    it('returns default mock participants when none configured for UUID', async () => {
      const participants = await mockAdapter.listMeetingParticipants('token', 'meeting_uuid_1');
      expect(participants).toHaveLength(2);
      expect(participants[0]!.name).toBe('Alex Lead');
      expect(participants[0]!.user_email).toBe('alex.lead@workspace.internal');
      expect(participants[1]!.name).toBe('Jordan Engineer');
    });

    it('returns custom mock participants for specific UUID', async () => {
      mockAdapter.mockParticipants.set('special_uuid', [
        {
          id: 'p_custom_1',
          name: 'Custom User',
          user_email: 'custom@domain.com',
          duration: 3600,
        },
      ]);

      const participants = await mockAdapter.listMeetingParticipants('token', 'special_uuid');
      expect(participants).toHaveLength(1);
      expect(participants[0]!.name).toBe('Custom User');
    });

    it('respects rate limit simulation', async () => {
      mockAdapter.simulateRecordingRateLimit = true;
      await expect(
        mockAdapter.listMeetingParticipants('token', 'any_uuid')
      ).rejects.toThrow(/rate limit reached/i);
    });
  });

  describe('HttpZoomClientAdapter', () => {
    let httpAdapter: HttpZoomClientAdapter;
    const originalFetch = global.fetch;

    beforeEach(() => {
      httpAdapter = new HttpZoomClientAdapter({
        clientId: 'test_client_id',
        clientSecret: 'test_client_secret',
        apiUrl: 'https://api.zoom.us/v2',
      });
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('fetches past meeting participants with double encoded UUID and pagination', async () => {
      const specialUuid = '/slash//double==';
      const expectedEncoded = encodeZoomMeetingUuid(specialUuid);

      let fetchCount = 0;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCount++;
        expect(url).toContain(expectedEncoded);

        if (fetchCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              page_size: 1,
              next_page_token: 'page_2_token',
              total_records: 2,
              participants: [
                { id: 'p1', name: 'Alice Smith', user_email: 'alice@corp.com' },
              ],
            }),
          } as unknown as Response;
        } else {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              page_size: 1,
              next_page_token: '',
              total_records: 2,
              participants: [
                { id: 'p2', name: 'Bob Jones', user_email: 'bob@corp.com' },
              ],
            }),
          } as unknown as Response;
        }
      });

      const participants = await httpAdapter.listMeetingParticipants('valid_token', specialUuid);
      expect(participants).toHaveLength(2);
      expect(participants[0]!.name).toBe('Alice Smith');
      expect(participants[1]!.name).toBe('Bob Jones');
      expect(fetchCount).toBe(2);
    });

    it('returns empty array if Zoom responds with 404', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Meeting not found or participant report not available',
      } as unknown as Response);

      const participants = await httpAdapter.listMeetingParticipants('valid_token', 'uuid_404');
      expect(participants).toEqual([]);
    });

    it('throws when Zoom responds with 429', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '60' }),
        text: async () => 'Rate limit exceeded',
      } as unknown as Response);

      await expect(
        httpAdapter.listMeetingParticipants('valid_token', 'uuid_429')
      ).rejects.toThrow(/Failed to list Zoom meeting participants/i);
    });
  });
});
