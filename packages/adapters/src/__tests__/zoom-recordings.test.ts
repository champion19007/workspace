import { describe, it, expect, beforeEach } from 'vitest';
import { MockZoomClientAdapter } from '../zoom/index.js';
import { encodeZoomMeetingUuid } from '@workspace/core';

describe('Zoom Client Adapter — Recordings and UUID Encoding (Stage 12)', () => {
  let adapter: MockZoomClientAdapter;

  beforeEach(() => {
    adapter = new MockZoomClientAdapter();
    adapter.mockRecordings = [
      {
        id: 11111111,
        uuid: 'normal_uuid_1',
        hostId: 'zoom_usr_owner_123',
        topic: 'Sprint Review',
        startTime: '2026-10-06T10:00:00Z',
        duration: 30,
        recordingFiles: [
          {
            id: 'f1',
            fileType: 'MP4',
            fileExtension: 'MP4',
            status: 'completed',
          },
          {
            id: 'f2',
            fileType: 'TRANSCRIPT',
            fileExtension: 'VTT',
            status: 'completed',
          },
        ],
      },
      {
        id: 22222222,
        uuid: 'normal_uuid_2',
        hostId: 'zoom_usr_owner_123',
        topic: 'Standup',
        startTime: '2026-10-06T11:00:00Z',
        duration: 15,
        recordingFiles: [
          {
            id: 'f3',
            fileType: 'MP4',
            fileExtension: 'MP4',
            status: 'completed',
          },
        ],
      },
      {
        id: 33333333,
        uuid: '/special//uuid/3==',
        hostId: 'zoom_usr_owner_123',
        topic: 'Special UUID Meeting',
        startTime: '2026-10-06T12:00:00Z',
        duration: 45,
        recordingFiles: [
          {
            id: 'f4',
            fileType: 'TRANSCRIPT',
            fileExtension: 'VTT',
            status: 'completed',
          },
        ],
      },
    ];
  });

  it('correctly double-encodes Zoom meeting UUIDs starting with "/" or containing "//"', () => {
    expect(encodeZoomMeetingUuid('standard_uuid_123')).toBe('standard_uuid_123');
    expect(encodeZoomMeetingUuid('abc+def=')).toBe('abc%2Bdef%3D');

    // UUIDs starting with / or containing // must be double URL encoded per Zoom docs
    const specialUuid = '/test//uuid==';
    const encoded = encodeZoomMeetingUuid(specialUuid);
    expect(encoded).toBe('%252Ftest%252F%252Fuuid%253D%253D');
  });

  it('lists user recordings with pagination and date range', async () => {
    const res = await adapter.listUserRecordings('test_token', 'zoom_usr_owner_123', {
      from: '2026-10-01',
      to: '2026-10-07',
      pageSize: 2,
    });

    expect(res.totalRecords).toBe(3);
    expect(res.meetings.length).toBe(2);
    expect(res.nextPageToken).toBe('2');

    // Fetch page 2
    const page2 = await adapter.listUserRecordings('test_token', 'zoom_usr_owner_123', {
      from: '2026-10-01',
      to: '2026-10-07',
      pageSize: 2,
      nextPageToken: res.nextPageToken,
    });

    expect(page2.meetings.length).toBe(1);
    expect(page2.meetings[0]?.id).toBe(33333333);
    expect(page2.nextPageToken).toBeUndefined();
  });

  it('retrieves meeting recordings by ID or UUID', async () => {
    const byId = await adapter.getMeetingRecordings('test_token', '11111111');
    expect(byId.uuid).toBe('normal_uuid_1');
    expect(byId.recordingFiles.length).toBe(2);

    const byUuid = await adapter.getMeetingRecordings('test_token', '/special//uuid/3==');
    expect(byUuid.id).toBe(33333333);
  });

  it('simulates 429 rate limit with Retry-After header', async () => {
    adapter.simulateRecordingRateLimit = true;

    await expect(
      adapter.listUserRecordings('test_token', 'zoom_usr_owner_123', {
        from: '2026-10-01',
        to: '2026-10-07',
      })
    ).rejects.toMatchObject({
      status: 429,
      retryAfter: 5,
    });
  });
});
