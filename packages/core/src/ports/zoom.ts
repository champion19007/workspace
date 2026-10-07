export interface ZoomTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface ZoomUserIdentity {
  id: string; // Zoom user ID
  accountId: string; // Zoom account ID
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface ZoomHostProfile {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  status: string;
  type: number;
}

export interface ZoomRecordingFileMetadata {
  id: string;
  fileType: string;
  fileExtension: string;
  fileSize?: number;
  status: string;
  recordingType?: string;
  downloadUrl?: string;
  recordingStart?: string;
  recordingEnd?: string;
}

export interface ZoomRecordingMetadata {
  id: string | number; // numeric meeting ID
  uuid: string; // raw meeting instance UUID
  hostId: string;
  topic?: string;
  startTime?: string;
  duration?: number;
  timezone?: string;
  totalSize?: number;
  recordingCount?: number;
  recordingFiles: ZoomRecordingFileMetadata[];
}

export interface ZoomUserRecordingsResponse {
  from: string;
  to: string;
  pageSize: number;
  nextPageToken?: string;
  totalRecords: number;
  meetings: ZoomRecordingMetadata[];
}

/**
 * Encodes Zoom meeting instance UUID according to official Zoom API rules.
 * If UUID starts with '/' or contains '//', it must be double URL encoded.
 */
export function encodeZoomMeetingUuid(uuid: string): string {
  if (uuid.startsWith('/') || uuid.includes('//')) {
    return encodeURIComponent(encodeURIComponent(uuid));
  }
  return encodeURIComponent(uuid);
}

export interface ZoomClientPort {
  /**
   * Constructs the Zoom OAuth authorization URL with required parameters and scopes.
   */
  getAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
    codeChallenge?: string;
  }): string;

  /**
   * Exchanges authorization code for access and refresh tokens.
   */
  exchangeCode(params: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<ZoomTokenResponse>;

  /**
   * Exchanges refresh token for a rotated token pair.
   */
  refreshToken(refreshToken: string): Promise<ZoomTokenResponse>;

  /**
   * Revokes token with Zoom OAuth servers.
   */
  revokeToken(token: string): Promise<void>;

  /**
   * Resolves authorized Zoom user identity and account ID from /v2/users/me.
   */
  getCurrentUser(accessToken: string): Promise<ZoomUserIdentity>;

  /**
   * Lists account users to discover eligible hosts.
   */
  listAccountUsers(accessToken: string): Promise<ZoomHostProfile[]>;

  /**
   * Lists recording metadata for a user/host within a date window.
   */
  listUserRecordings(
    accessToken: string,
    userId: string,
    params: {
      from: string; // YYYY-MM-DD
      to: string; // YYYY-MM-DD
      pageSize?: number;
      nextPageToken?: string;
    }
  ): Promise<ZoomUserRecordingsResponse>;

  /**
   * Retrieves recording metadata for a specific meeting instance by numeric ID or UUID.
   */
  getMeetingRecordings(accessToken: string, meetingIdOrUuid: string): Promise<ZoomRecordingMetadata>;

  /**
   * Downloads transcript file content using Bearer token authentication,
   * enforcing HTTPS, stripping Authorization on cross-origin redirects,
   * checking 50MB size guard and WebVTT signature.
   */
  downloadTranscriptFile(accessToken: string, downloadUrl: string): Promise<string>;

  /**
   * Retrieves past meeting participants for a specific meeting instance by UUID.
   * Handles pagination and returns an array of participants.
   * If Zoom returns 404 (meeting data not yet available or expired), returns empty array.
   */
  listMeetingParticipants(
    accessToken: string,
    meetingUuid: string,
    params?: {
      pageSize?: number;
      nextPageToken?: string;
    }
  ): Promise<ZoomMeetingParticipant[]>;
}

export interface ZoomMeetingParticipant {
  id?: string;
  user_id?: string;
  name: string;
  user_email?: string;
  join_time?: string;
  leave_time?: string;
  duration?: number;
  failover?: boolean;
  status?: string;
}

export interface ZoomMeetingParticipantsResponse {
  page_size: number;
  next_page_token?: string;
  total_records: number;
  participants: ZoomMeetingParticipant[];
}

