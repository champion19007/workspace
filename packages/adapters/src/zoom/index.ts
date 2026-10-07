import {
  type ZoomClientPort,
  type ZoomTokenResponse,
  type ZoomUserIdentity,
  type ZoomHostProfile,
  type ZoomRecordingMetadata,
  type ZoomUserRecordingsResponse,
  type ZoomMeetingParticipant,
  encodeZoomMeetingUuid,
  ZOOM_REQUIRED_SCOPES,
} from '@workspace/core';

export class MockZoomClientAdapter implements ZoomClientPort {
  public mockAccountId = 'zoom_act_test_123';
  public mockUser: ZoomUserIdentity = {
    id: 'zoom_usr_owner_123',
    accountId: 'zoom_act_test_123',
    email: 'zoom-admin@workspace.internal',
    firstName: 'Zoom',
    lastName: 'Admin',
  };
  public mockHosts: ZoomHostProfile[] = [
    {
      id: 'zoom_usr_owner_123',
      email: 'zoom-admin@workspace.internal',
      firstName: 'Zoom',
      lastName: 'Admin',
      status: 'active',
      type: 2,
    },
    {
      id: 'zoom_usr_host_456',
      email: 'alex.lead@workspace.internal',
      firstName: 'Alex',
      lastName: 'Lead',
      status: 'active',
      type: 2,
    },
  ];
  public revokedTokens = new Set<string>();
  public simulateInvalidGrant = false;

  getAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
    codeChallenge?: string;
  }): string {
    const url = new URL('https://zoom.us/oauth/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', 'mock_zoom_client_id');
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    url.searchParams.set('scope', ZOOM_REQUIRED_SCOPES.join(' '));
    if (params.codeChallenge) {
      url.searchParams.set('code_challenge', params.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<ZoomTokenResponse> {
    if (params.code === 'invalid_code' || params.code === 'expired_code') {
      const err = new Error('Invalid authorization code');
      (err as unknown as { status: number }).status = 400;
      throw err;
    }

    return {
      access_token: `mock_zoom_access_token_${Date.now()}`,
      refresh_token: `mock_zoom_refresh_token_${Date.now()}`,
      expires_in: 3600,
      token_type: 'bearer',
      scope: ZOOM_REQUIRED_SCOPES.join(' '),
    };
  }

  async refreshToken(refreshToken: string): Promise<ZoomTokenResponse> {
    if (this.simulateInvalidGrant || refreshToken === 'revoked_token' || this.revokedTokens.has(refreshToken)) {
      const err = new Error('Invalid grant: refresh token has been revoked or expired');
      (err as unknown as { code: string; status: number }).code = 'invalid_grant';
      (err as unknown as { code: string; status: number }).status = 401;
      throw err;
    }

    return {
      access_token: `mock_zoom_access_token_rotated_${Date.now()}`,
      refresh_token: `mock_zoom_refresh_token_rotated_${Date.now()}`,
      expires_in: 3600,
      token_type: 'bearer',
      scope: ZOOM_REQUIRED_SCOPES.join(' '),
    };
  }

  async revokeToken(token: string): Promise<void> {
    this.revokedTokens.add(token);
  }

  async getCurrentUser(_accessToken: string): Promise<ZoomUserIdentity> {
    return { ...this.mockUser, accountId: this.mockAccountId };
  }

  async listAccountUsers(_accessToken: string): Promise<ZoomHostProfile[]> {
    return [...this.mockHosts];
  }

  public mockRecordings: ZoomRecordingMetadata[] = [];
  public simulateRecordingRateLimit = false;

  async listUserRecordings(
    _accessToken: string,
    userId: string,
    params: {
      from: string;
      to: string;
      pageSize?: number;
      nextPageToken?: string;
    }
  ): Promise<ZoomUserRecordingsResponse> {
    if (this.simulateRecordingRateLimit) {
      const err = new Error('Too Many Requests: Zoom API rate limit reached');
      (err as unknown as { status: number; retryAfter: number }).status = 429;
      (err as unknown as { status: number; retryAfter: number }).retryAfter = 5;
      throw err;
    }

    const pageSize = params.pageSize || 30;
    const filtered = this.mockRecordings.filter((m) => m.hostId === userId);
    const startIndex = params.nextPageToken ? parseInt(params.nextPageToken, 10) : 0;
    const pageItems = filtered.slice(startIndex, startIndex + pageSize);
    const nextToken = startIndex + pageSize < filtered.length ? String(startIndex + pageSize) : undefined;

    return {
      from: params.from,
      to: params.to,
      pageSize,
      nextPageToken: nextToken,
      totalRecords: filtered.length,
      meetings: pageItems,
    };
  }

  async getMeetingRecordings(_accessToken: string, meetingIdOrUuid: string): Promise<ZoomRecordingMetadata> {
    if (this.simulateRecordingRateLimit) {
      const err = new Error('Too Many Requests: Zoom API rate limit reached');
      (err as unknown as { status: number; retryAfter: number }).status = 429;
      (err as unknown as { status: number; retryAfter: number }).retryAfter = 5;
      throw err;
    }

    const decoded = decodeURIComponent(meetingIdOrUuid);
    const found = this.mockRecordings.find(
      (m) => String(m.id) === meetingIdOrUuid || m.uuid === meetingIdOrUuid || m.uuid === decoded
    );

    if (!found) {
      const err = new Error(`Meeting recording not found: ${meetingIdOrUuid}`);
      (err as unknown as { status: number }).status = 404;
      throw err;
    }

    return found;
  }

  public mockTranscripts: Map<string, string> = new Map();
  public defaultMockTranscript: string = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
<v Alex Lead>Welcome team, let's review our quarterly goals.</v>

2
00:00:05.000 --> 00:00:08.500
<v Alex Lead>We have several deliverables on track for Workspace v1.</v>

3
00:00:09.000 --> 00:00:12.000
<v Jordan Engineer>I've pushed the database migration and the tests are green.</v>
`;

  async downloadTranscriptFile(_accessToken: string, downloadUrl: string): Promise<string> {
    if (this.simulateRecordingRateLimit) {
      const err = new Error('Too Many Requests: Zoom API rate limit reached');
      (err as unknown as { status: number; retryAfter: number }).status = 429;
      (err as unknown as { status: number; retryAfter: number }).retryAfter = 5;
      throw err;
    }

    if (!downloadUrl.startsWith('https://')) {
      throw new Error(`Insecure download URL rejected: ${downloadUrl}. Only HTTPS downloads are permitted.`);
    }

    if (downloadUrl.includes('error-html')) {
      return '<!DOCTYPE html><html><body>Login Required</body></html>';
    }

    if (downloadUrl.includes('error-500')) {
      const err = new Error('Internal Server Error: 500');
      (err as unknown as { status: number }).status = 500;
      throw err;
    }

    const custom = this.mockTranscripts.get(downloadUrl);
    if (custom) return custom;

    return this.defaultMockTranscript;
  }

  public mockParticipants: Map<string, ZoomMeetingParticipant[]> = new Map();
  public defaultMockParticipants: ZoomMeetingParticipant[] = [
    {
      id: 'zm_p_alex',
      name: 'Alex Lead',
      user_email: 'alex.lead@workspace.internal',
      join_time: '2026-10-07T10:00:00Z',
      leave_time: '2026-10-07T10:30:00Z',
      duration: 1800,
    },
    {
      id: 'zm_p_jordan',
      name: 'Jordan Engineer',
      user_email: 'jordan@workspace.internal',
      join_time: '2026-10-07T10:00:05Z',
      leave_time: '2026-10-07T10:29:50Z',
      duration: 1785,
    },
  ];

  async listMeetingParticipants(
    _accessToken: string,
    meetingUuid: string,
    _params?: { pageSize?: number; nextPageToken?: string }
  ): Promise<ZoomMeetingParticipant[]> {
    if (this.simulateRecordingRateLimit) {
      const err = new Error('Too Many Requests: Zoom API rate limit reached');
      (err as unknown as { status: number; retryAfter: number }).status = 429;
      (err as unknown as { status: number; retryAfter: number }).retryAfter = 5;
      throw err;
    }

    const decoded = decodeURIComponent(meetingUuid);
    const custom = this.mockParticipants.get(meetingUuid) || this.mockParticipants.get(decoded);
    if (custom) return custom;

    return [...this.defaultMockParticipants];
  }
}

export class HttpZoomClientAdapter implements ZoomClientPort {
  constructor(
    private config: {
      clientId: string;
      clientSecret: string;
      oauthUrl?: string;
      apiUrl?: string;
    }
  ) {}

  private get oauthBaseUrl(): string {
    return this.config.oauthUrl || 'https://zoom.us/oauth';
  }

  private get apiBaseUrl(): string {
    return this.config.apiUrl || 'https://api.zoom.us/v2';
  }

  private get basicAuthHeader(): string {
    const creds = `${this.config.clientId}:${this.config.clientSecret}`;
    return `Basic ${Buffer.from(creds).toString('base64')}`;
  }

  getAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
    codeChallenge?: string;
  }): string {
    const url = new URL(`${this.oauthBaseUrl}/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    url.searchParams.set('scope', ZOOM_REQUIRED_SCOPES.join(' '));
    if (params.codeChallenge) {
      url.searchParams.set('code_challenge', params.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<ZoomTokenResponse> {
    const url = new URL(`${this.oauthBaseUrl}/token`);
    url.searchParams.set('grant_type', 'authorization_code');
    url.searchParams.set('code', params.code);
    url.searchParams.set('redirect_uri', params.redirectUri);
    if (params.codeVerifier) {
      url.searchParams.set('code_verifier', params.codeVerifier);
    }

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: this.basicAuthHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      const err = new Error(`Zoom token exchange failed (${res.status}): ${errorText}`);
      (err as unknown as { status: number }).status = res.status;
      throw err;
    }

    return (await res.json()) as ZoomTokenResponse;
  }

  async refreshToken(refreshToken: string): Promise<ZoomTokenResponse> {
    const url = new URL(`${this.oauthBaseUrl}/token`);
    url.searchParams.set('grant_type', 'refresh_token');
    url.searchParams.set('refresh_token', refreshToken);

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: this.basicAuthHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      const err = new Error(`Zoom token refresh failed (${res.status}): ${errorText}`);
      (err as unknown as { status: number; code?: string }).status = res.status;
      if (res.status === 400 || res.status === 401) {
        (err as unknown as { code: string }).code = 'invalid_grant';
      }
      throw err;
    }

    return (await res.json()) as ZoomTokenResponse;
  }

  async revokeToken(token: string): Promise<void> {
    const url = new URL(`${this.oauthBaseUrl}/revoke`);
    url.searchParams.set('token', token);

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: this.basicAuthHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!res.ok) {
      // Best-effort revocation: log or ignore
    }
  }

  async getCurrentUser(accessToken: string): Promise<ZoomUserIdentity> {
    const res = await fetch(`${this.apiBaseUrl}/users/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to fetch current Zoom user (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      id: string;
      account_id: string;
      email: string;
      first_name?: string;
      last_name?: string;
    };

    return {
      id: data.id,
      accountId: data.account_id,
      email: data.email,
      firstName: data.first_name,
      lastName: data.last_name,
    };
  }

  async listAccountUsers(accessToken: string): Promise<ZoomHostProfile[]> {
    const res = await fetch(`${this.apiBaseUrl}/users?status=active&page_size=300`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to fetch Zoom account users (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      users?: Array<{
        id: string;
        email: string;
        first_name?: string;
        last_name?: string;
        status: string;
        type: number;
      }>;
    };

    return (data.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      lastName: u.last_name,
      status: u.status,
      type: u.type,
    }));
  }

  async listUserRecordings(
    accessToken: string,
    userId: string,
    params: {
      from: string;
      to: string;
      pageSize?: number;
      nextPageToken?: string;
    }
  ): Promise<ZoomUserRecordingsResponse> {
    const url = new URL(`${this.apiBaseUrl}/users/${encodeURIComponent(userId)}/recordings`);
    url.searchParams.set('from', params.from);
    url.searchParams.set('to', params.to);
    if (params.pageSize) url.searchParams.set('page_size', String(params.pageSize));
    if (params.nextPageToken) url.searchParams.set('next_page_token', params.nextPageToken);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`Failed to list Zoom recordings (${res.status}): ${text}`);
      (err as unknown as { status: number; retryAfter?: number }).status = res.status;
      if (res.status === 429) {
        const retryHeader = res.headers.get('retry-after');
        if (retryHeader) {
          (err as unknown as { retryAfter?: number }).retryAfter = parseInt(retryHeader, 10);
        }
      }
      throw err;
    }

    const data = (await res.json()) as {
      from: string;
      to: string;
      page_size: number;
      next_page_token?: string;
      total_records: number;
      meetings?: Array<{
        id: number | string;
        uuid: string;
        host_id: string;
        topic?: string;
        start_time?: string;
        duration?: number;
        timezone?: string;
        total_size?: number;
        recording_count?: number;
        recording_files?: Array<{
          id: string;
          file_type: string;
          file_extension: string;
          file_size?: number;
          status: string;
          recording_type?: string;
          download_url?: string;
          recording_start?: string;
          recording_end?: string;
        }>;
      }>;
    };

    return {
      from: data.from,
      to: data.to,
      pageSize: data.page_size,
      nextPageToken: data.next_page_token,
      totalRecords: data.total_records,
      meetings: (data.meetings || []).map((m) => ({
        id: m.id,
        uuid: m.uuid,
        hostId: m.host_id,
        topic: m.topic,
        startTime: m.start_time,
        duration: m.duration,
        timezone: m.timezone,
        totalSize: m.total_size,
        recordingCount: m.recording_count,
        recordingFiles: (m.recording_files || []).map((f) => ({
          id: f.id,
          fileType: f.file_type,
          fileExtension: f.file_extension,
          fileSize: f.file_size,
          status: f.status,
          recordingType: f.recording_type,
          downloadUrl: f.download_url,
          recordingStart: f.recording_start,
          recordingEnd: f.recording_end,
        })),
      })),
    };
  }

  async getMeetingRecordings(accessToken: string, meetingIdOrUuid: string): Promise<ZoomRecordingMetadata> {
    const encodedUuid = encodeZoomMeetingUuid(meetingIdOrUuid);
    const url = `${this.apiBaseUrl}/meetings/${encodedUuid}/recordings`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`Failed to fetch meeting recordings (${res.status}): ${text}`);
      (err as unknown as { status: number }).status = res.status;
      throw err;
    }

    const m = (await res.json()) as {
      id: number | string;
      uuid: string;
      host_id: string;
      topic?: string;
      start_time?: string;
      duration?: number;
      timezone?: string;
      total_size?: number;
      recording_count?: number;
      recording_files?: Array<{
        id: string;
        file_type: string;
        file_extension: string;
        file_size?: number;
        status: string;
        recording_type?: string;
        download_url?: string;
        recording_start?: string;
        recording_end?: string;
      }>;
    };

    return {
      id: m.id,
      uuid: m.uuid,
      hostId: m.host_id,
      topic: m.topic,
      startTime: m.start_time,
      duration: m.duration,
      timezone: m.timezone,
      totalSize: m.total_size,
      recordingCount: m.recording_count,
      recordingFiles: (m.recording_files || []).map((f) => ({
        id: f.id,
        fileType: f.file_type,
        fileExtension: f.file_extension,
        fileSize: f.file_size,
        status: f.status,
        recordingType: f.recording_type,
        downloadUrl: f.download_url,
        recordingStart: f.recording_start,
        recordingEnd: f.recording_end,
      })),
    };
  }

  /**
   * Downloads transcript file content using Bearer token authentication,
   * enforcing HTTPS, stripping Authorization on cross-origin redirects,
   * checking 50MB size guard and WebVTT signature.
   */
  async downloadTranscriptFile(accessToken: string, downloadUrl: string): Promise<string> {
    const parsedInitial = new URL(downloadUrl);
    if (parsedInitial.protocol !== 'https:') {
      throw new Error(`Insecure download URL rejected: ${downloadUrl}. Only HTTPS downloads are permitted.`);
    }

    const MAX_ATTEMPTS = 3;
    const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        let currentUrl = downloadUrl;
        const currentHeaders: Record<string, string> = {
          Authorization: `Bearer ${accessToken}`,
        };

        let response: Response | null = null;
        let redirectCount = 0;
        const MAX_REDIRECTS = 5;

        while (redirectCount < MAX_REDIRECTS) {
          const parsedCurrent = new URL(currentUrl);
          if (parsedCurrent.protocol !== 'https:') {
            throw new Error(`Insecure redirect URL rejected: ${currentUrl}. Only HTTPS is permitted.`);
          }

          const res = await fetch(currentUrl, {
            method: 'GET',
            headers: currentHeaders,
            redirect: 'manual',
            signal: AbortSignal.timeout(30000),
          });

          // Check if redirect response
          if (
            res.status === 301 ||
            res.status === 302 ||
            res.status === 303 ||
            res.status === 307 ||
            res.status === 308
          ) {
            const location = res.headers.get('location');
            if (!location) {
              throw new Error(`Redirect (${res.status}) missing Location header`);
            }
            const nextUrl = new URL(location, currentUrl);
            if (nextUrl.protocol !== 'https:') {
              throw new Error(`Insecure redirect rejected: ${nextUrl.toString()}`);
            }

            // Cross-origin redirect: Strip Authorization header (e.g. zoom.us -> AWS S3 presigned URL)
            if (nextUrl.origin !== parsedCurrent.origin) {
              delete currentHeaders['Authorization'];
            }

            currentUrl = nextUrl.toString();
            redirectCount++;
            continue;
          }

          response = res;
          break;
        }

        if (!response) {
          throw new Error(`Too many redirects (max: ${MAX_REDIRECTS})`);
        }

        if (!response.ok) {
          const isTransient = response.status === 429 || (response.status >= 500 && response.status < 600);
          const errText = await response.text().catch(() => '');
          const error = new Error(`Zoom transcript download failed (${response.status}): ${errText}`);
          (error as unknown as { status: number }).status = response.status;

          if (isTransient && attempt < MAX_ATTEMPTS) {
            let backoffMs = Math.min(500 * Math.pow(2, attempt - 1), 4000);
            if (response.status === 429) {
              const retryAfter = response.headers.get('retry-after');
              if (retryAfter) {
                const parsedSeconds = parseInt(retryAfter, 10);
                if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
                  backoffMs = Math.min(parsedSeconds * 1000, 10000);
                }
              }
            }
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }

          throw error;
        }

        // Check Content-Length header
        const contentLengthHeader = response.headers.get('content-length');
        if (contentLengthHeader) {
          const len = parseInt(contentLengthHeader, 10);
          if (!isNaN(len) && len > MAX_SIZE_BYTES) {
            throw new Error(`Transcript file size (${len} bytes) exceeds maximum limit of 50MB`);
          }
        }

        const text = await response.text();
        const byteLength = Buffer.byteLength(text, 'utf-8');
        if (byteLength > MAX_SIZE_BYTES) {
          throw new Error(`Transcript content (${byteLength} bytes) exceeds maximum limit of 50MB`);
        }

        // Reject HTML login / error pages
        const cleanStart = text.replace(/^\uFEFF/, '').trimStart();
        if (cleanStart.startsWith('<!DOCTYPE html') || cleanStart.startsWith('<html')) {
          throw new Error('Downloaded file is an HTML error/login page, not a valid WebVTT transcript');
        }
        if (!cleanStart.startsWith('WEBVTT')) {
          throw new Error('Downloaded file does not start with WEBVTT signature');
        }

        return text;
      } catch (err: unknown) {
        lastError = err as Error;
        const status = (err as { status?: number })?.status;
        const isTransient = status === 429 || (status !== undefined && status >= 500 && status < 600);
        if (!isTransient || attempt >= MAX_ATTEMPTS) {
          throw err;
        }
      }
    }

    throw lastError || new Error('Failed to download transcript after 3 attempts');
  }

  async listMeetingParticipants(
    accessToken: string,
    meetingUuid: string,
    params?: {
      pageSize?: number;
      nextPageToken?: string;
    }
  ): Promise<ZoomMeetingParticipant[]> {
    const encodedUuid = encodeZoomMeetingUuid(meetingUuid);
    const allParticipants: ZoomMeetingParticipant[] = [];
    let currentToken = params?.nextPageToken;
    const pageSize = params?.pageSize || 100;
    let pageCount = 0;
    const maxPages = 10;

    do {
      const url = new URL(`${this.apiBaseUrl}/past_meetings/${encodedUuid}/participants`);
      url.searchParams.set('page_size', String(pageSize));
      if (currentToken) {
        url.searchParams.set('next_page_token', currentToken);
      }

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (res.status === 404) {
        // Meeting participants unavailable or meeting not found
        return allParticipants;
      }

      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Failed to list Zoom meeting participants (${res.status}): ${text}`);
        (err as unknown as { status: number; retryAfter?: number }).status = res.status;
        if (res.status === 429) {
          const retryHeader = res.headers.get('retry-after');
          if (retryHeader) {
            (err as unknown as { retryAfter?: number }).retryAfter = parseInt(retryHeader, 10);
          }
        }
        throw err;
      }

      const data = (await res.json()) as {
        page_size: number;
        next_page_token?: string;
        total_records: number;
        participants?: Array<{
          id?: string;
          user_id?: string;
          name: string;
          user_email?: string;
          join_time?: string;
          leave_time?: string;
          duration?: number;
          failover?: boolean;
          status?: string;
        }>;
      };

      if (data.participants && Array.isArray(data.participants)) {
        for (const p of data.participants) {
          allParticipants.push({
            id: p.id,
            user_id: p.user_id,
            name: p.name,
            user_email: p.user_email,
            join_time: p.join_time,
            leave_time: p.leave_time,
            duration: p.duration,
            failover: p.failover,
            status: p.status,
          });
        }
      }

      currentToken = data.next_page_token || undefined;
      pageCount++;
    } while (currentToken && pageCount < maxPages);

    return allParticipants;
  }
}
