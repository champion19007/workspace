import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  verifyZoomWebhookSignature,
  buildZoomValidationResponse,
  canTransitionMeetingStatus,
} from '../zoom/index.js';

describe('Stage 12: Zoom Webhook Signature Verification and Meeting State Transitions', () => {
  const SECRET_TOKEN = 'test_webhook_secret_token_1234567890';

  function signPayload(body: string, timestampSec: number, secret: string = SECRET_TOKEN): string {
    const message = `v0:${timestampSec}:${body}`;
    const hash = crypto.createHmac('sha256', secret).update(message).digest('hex');
    return `v0=${hash}`;
  }

  describe('1. Webhook Signature Verification (x-zm-signature)', () => {
    it('verifies authentic webhook request with correct timestamp and signature', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const rawBody = JSON.stringify({ event: 'recording.completed', event_ts: Date.now() });
      const signature = signPayload(rawBody, nowSec);

      const result = verifyZoomWebhookSignature({
        secretToken: SECRET_TOKEN,
        timestampHeader: String(nowSec),
        signatureHeader: signature,
        rawBody,
      });

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('rejects tampered raw body', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const originalBody = '{"event":"recording.completed","account_id":"acc_123"}';
      const signature = signPayload(originalBody, nowSec);
      const tamperedBody = '{"event":"recording.completed","account_id":"acc_999"}';

      const result = verifyZoomWebhookSignature({
        secretToken: SECRET_TOKEN,
        timestampHeader: String(nowSec),
        signatureHeader: signature,
        rawBody: tamperedBody,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Signature hash mismatch');
    });

    it('preserves exact raw body whitespace and rejects modified whitespace', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const formattedBody = '{\n  "event": "recording.completed",\n  "account_id": "acc_123"\n}';
      const signature = signPayload(formattedBody, nowSec);
      const minifiedBody = '{"event":"recording.completed","account_id":"acc_123"}';

      const result = verifyZoomWebhookSignature({
        secretToken: SECRET_TOKEN,
        timestampHeader: String(nowSec),
        signatureHeader: signature,
        rawBody: minifiedBody,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Signature hash mismatch');
    });

    it('correctly verifies UTF-8 and Unicode characters in raw body', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const unicodeBody = JSON.stringify({
        event: 'recording.completed',
        topic: 'Engineering Sync — Sprint 42 🚀 (हिन्दी & 日本語)',
      });
      const signature = signPayload(unicodeBody, nowSec);

      const result = verifyZoomWebhookSignature({
        secretToken: SECRET_TOKEN,
        timestampHeader: String(nowSec),
        signatureHeader: signature,
        rawBody: unicodeBody,
      });

      expect(result.valid).toBe(true);
    });

    it('rejects timestamp outside the 5-minute past window (> 300 seconds old)', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const oldTimestamp = nowSec - 305; // 305 seconds in the past
      const rawBody = '{"event":"recording.completed"}';
      const signature = signPayload(rawBody, oldTimestamp);

      const result = verifyZoomWebhookSignature({
        secretToken: SECRET_TOKEN,
        timestampHeader: String(oldTimestamp),
        signatureHeader: signature,
        rawBody,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Timestamp outside acceptable 5-minute window');
    });

    it('rejects timestamp outside the 5-minute future window (> 300 seconds ahead)', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const futureTimestamp = nowSec + 310; // 310 seconds in the future
      const rawBody = '{"event":"recording.completed"}';
      const signature = signPayload(rawBody, futureTimestamp);

      const result = verifyZoomWebhookSignature({
        secretToken: SECRET_TOKEN,
        timestampHeader: String(futureTimestamp),
        signatureHeader: signature,
        rawBody,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Timestamp outside acceptable 5-minute window');
    });

    it('rejects missing or malformed signature headers', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const rawBody = '{"event":"recording.completed"}';

      // Missing timestamp
      expect(
        verifyZoomWebhookSignature({
          secretToken: SECRET_TOKEN,
          signatureHeader: 'v0=abc',
          rawBody,
        }).valid
      ).toBe(false);

      // Missing signature
      expect(
        verifyZoomWebhookSignature({
          secretToken: SECRET_TOKEN,
          timestampHeader: String(nowSec),
          rawBody,
        }).valid
      ).toBe(false);

      // Malformed prefix (missing v0=)
      expect(
        verifyZoomWebhookSignature({
          secretToken: SECRET_TOKEN,
          timestampHeader: String(nowSec),
          signatureHeader: '30b91d2938a19238',
          rawBody,
        }).valid
      ).toBe(false);

      // Wrong secret
      const signatureWithOtherSecret = signPayload(rawBody, nowSec, 'wrong_secret');
      expect(
        verifyZoomWebhookSignature({
          secretToken: SECRET_TOKEN,
          timestampHeader: String(nowSec),
          signatureHeader: signatureWithOtherSecret,
          rawBody,
        }).valid
      ).toBe(false);
    });
  });

  describe('2. Endpoint URL Validation Challenge (endpoint.url_validation)', () => {
    it('generates correct plainToken and encryptedToken according to Zoom specification', () => {
      const plainToken = 'sample_plain_token_xyz123';
      const response = buildZoomValidationResponse(plainToken, SECRET_TOKEN);

      expect(response.plainToken).toBe(plainToken);
      const expectedEncryptedToken = crypto
        .createHmac('sha256', SECRET_TOKEN)
        .update(plainToken)
        .digest('hex');
      expect(response.encryptedToken).toBe(expectedEncryptedToken);
    });
  });

  describe('3. Meeting Lifecycle State Machine & Regression Invariant', () => {
    it('allows natural forward progression', () => {
      expect(canTransitionMeetingStatus('waiting_for_transcript', 'ready_for_transcript_retrieval')).toBe(true);
      expect(canTransitionMeetingStatus('ready_for_transcript_retrieval', 'ingesting')).toBe(true);
      expect(canTransitionMeetingStatus('ingesting', 'routing')).toBe(true);
      expect(canTransitionMeetingStatus('routing', 'extracting')).toBe(true);
      expect(canTransitionMeetingStatus('extracting', 'completed')).toBe(true);
    });

    it('prevents delayed recording.completed from regressing an advanced meeting state', () => {
      // If transcript arrived first or meeting is already ready/ingesting,
      // late recording.completed must not revert status back to waiting_for_transcript!
      expect(canTransitionMeetingStatus('ready_for_transcript_retrieval', 'waiting_for_transcript')).toBe(false);
      expect(canTransitionMeetingStatus('ingesting', 'waiting_for_transcript')).toBe(false);
      expect(canTransitionMeetingStatus('completed', 'waiting_for_transcript')).toBe(false);
      expect(canTransitionMeetingStatus('ready_for_transcript_retrieval', 'pending_consent')).toBe(false);
    });

    it('preserves skipped tombstones against automatic revival', () => {
      // A skipped meeting must never be revived by redelivered events or polling
      expect(canTransitionMeetingStatus('skipped', 'waiting_for_transcript')).toBe(false);
      expect(canTransitionMeetingStatus('skipped', 'ready_for_transcript_retrieval')).toBe(false);
      expect(canTransitionMeetingStatus('skipped', 'ingesting')).toBe(false);
    });

    it('allows transition to terminal states like skipped, intake_failed, or connection_requires_reconnection', () => {
      expect(canTransitionMeetingStatus('waiting_for_transcript', 'skipped')).toBe(true);
      expect(canTransitionMeetingStatus('pending_consent', 'skipped')).toBe(true);
      expect(canTransitionMeetingStatus('waiting_for_transcript', 'connection_requires_reconnection')).toBe(true);
      expect(canTransitionMeetingStatus('pending_consent', 'connection_requires_reconnection')).toBe(true);
    });
  });
});
