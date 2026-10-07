import { describe, it, expect } from 'vitest';
import {
  ZOOM_REQUIRED_SCOPES,
  evaluateMeetingEligibility,
  AuthorizeZoomRequestSchema,
  ZoomCallbackRequestSchema,
  UpdateZoomHostConsentSchema,
} from '../zoom/index.js';

describe('Stage 11 Core: Zoom Domain & Eligibility Evaluator', () => {
  it('defines the required granular scopes for the transcript-only product', () => {
    expect(ZOOM_REQUIRED_SCOPES).toEqual([
      'recording:read:admin',
      'meeting:read:admin',
      'user:read:admin',
    ]);
  });

  it('validates authorize request schema', () => {
    const valid = AuthorizeZoomRequestSchema.safeParse({
      redirectUri: 'https://example.com/callback',
    });
    expect(valid.success).toBe(true);

    const invalid = AuthorizeZoomRequestSchema.safeParse({
      redirectUri: 'not-a-valid-url',
    });
    expect(invalid.success).toBe(false);
  });

  it('validates callback request schema', () => {
    const valid = ZoomCallbackRequestSchema.safeParse({
      code: 'auth_code_123',
      state: 'oauth_state_abc',
    });
    expect(valid.success).toBe(true);

    const missingState = ZoomCallbackRequestSchema.safeParse({
      code: 'auth_code_123',
    });
    expect(missingState.success).toBe(false);
  });

  it('validates host consent update schema', () => {
    const valid = UpdateZoomHostConsentSchema.safeParse({
      adminDisabled: true,
      consentStatus: 'opted_in',
    });
    expect(valid.success).toBe(true);

    const invalid = UpdateZoomHostConsentSchema.safeParse({
      consentStatus: 'invalid_status',
    });
    expect(invalid.success).toBe(false);
  });

  describe('evaluateMeetingEligibility', () => {
    it('rejects meeting when connection is not connected', () => {
      const res = evaluateMeetingEligibility({
        connectionStatus: 'disconnected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: false },
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('disconnected');
    });

    it('rejects meeting when host consent is missing', () => {
      const res = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: null,
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('not been registered or opted in');
    });

    it('rejects meeting when host is disabled by workspace admin', () => {
      const res = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: true },
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('disabled by workspace administrator');
    });

    it('rejects meeting when host consent is unknown or opted_out', () => {
      const resUnknown = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'unknown', adminDisabled: false },
      });
      expect(resUnknown.eligible).toBe(false);
      expect(resUnknown.reason).toContain('not granted explicit opt-in');

      const resOptOut = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_out', adminDisabled: false },
      });
      expect(resOptOut.eligible).toBe(false);
      expect(resOptOut.reason).toContain('not granted explicit opt-in');
    });

    it('rejects meeting when marked as excluded', () => {
      const res = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: false },
        meetingExcluded: true,
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('explicitly excluded');
    });

    it('rejects meeting when external participants exist without verified guest consent', () => {
      const res = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: false },
        hasExternalParticipants: true,
        guestConsentGranted: false,
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('without verified guest consent');
    });

    it('approves meeting when all conditions and guest consent are satisfied', () => {
      const res = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: false },
        hasExternalParticipants: true,
        guestConsentGranted: true,
        meetingExcluded: false,
      });
      expect(res.eligible).toBe(true);
      expect(res.reason).toBeUndefined();
    });

    it('approves internal meeting when host is opted in and not disabled', () => {
      const res = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: false },
        hasExternalParticipants: false,
        meetingExcluded: false,
      });
      expect(res.eligible).toBe(true);
      expect(res.reason).toBeUndefined();
    });

    it('rejects meeting when connection generation does not match expected generation', () => {
      const res = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: false },
        connectionGeneration: 1,
        expectedConnectionGeneration: 2,
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('connection generation mismatch');
    });

    it('rejects meeting when transcript retention deadline has passed', () => {
      const res = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: false },
        retentionDeadline: new Date(Date.now() - 1000).toISOString(),
      });
      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('retention period has expired');
    });

    it('rejects meeting when guest consent status is pending or unknown with external guests', () => {
      const resPending = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: false },
        guestConsentStatus: 'pending',
      });
      expect(resPending.eligible).toBe(false);
      expect(resPending.reason).toContain('guest consent is pending');

      const resUnknown = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: false },
        hasExternalParticipants: true,
        guestConsentStatus: 'unknown',
      });
      expect(resUnknown.eligible).toBe(false);
      expect(resUnknown.reason).toContain('without verified guest consent');
    });

    it('approves meeting when guestConsentStatus is absent or consented', () => {
      const resAbsent = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: false },
        guestConsentStatus: 'absent',
      });
      expect(resAbsent.eligible).toBe(true);

      const resConsented = evaluateMeetingEligibility({
        connectionStatus: 'connected',
        hostConsent: { consentStatus: 'opted_in', adminDisabled: false },
        hasExternalParticipants: true,
        guestConsentStatus: 'consented',
      });
      expect(resConsented.eligible).toBe(true);
    });
  });
});

