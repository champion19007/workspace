import { describe, it, expect } from 'vitest';
import {
  createSessionPayload,
  isSessionExpired,
  shouldRefreshSession,
  rollSessionExpiry,
  rotateSession,
  SESSION_MAX_AGE_MS,
  SESSION_ROLLING_REFRESH_THRESHOLD_MS,
  encryptSession,
  decryptSession,
  hashToken,
  generateSecureRandomToken,
  signInternalApiRequest,
  verifyInternalApiRequest,
  hasMinimumRole,
  canManageMembers,
  canInviteOrAssignRole,
  canModifyMemberRole,
  canRemoveMember,
  canDeleteOrg,
  generateInvitationToken,
} from '../index.js';

describe('Auth Domain Core Logic', () => {
  const testSecret = '0123456789abcdef0123456789abcdef'; // 32 chars

  describe('30-Day Rolling Sessions with Controllable Clock', () => {
    it('creates a session with a 30-day expiration window', () => {
      const fixedNow = 1700000000000;
      const session = createSessionPayload({
        userId: '018f3a55-0000-7000-8000-000000000001',
        email: 'alice@example.com',
        activeOrgId: '018f3a55-0000-7000-8000-000000000010',
        role: 'owner',
        sessionEpoch: 1,
        now: fixedNow,
      });

      expect(session.userId).toBe('018f3a55-0000-7000-8000-000000000001');
      expect(session.email).toBe('alice@example.com');
      expect(session.role).toBe('owner');
      expect(session.createdAt).toBe(fixedNow);
      expect(session.expiresAt).toBe(fixedNow + SESSION_MAX_AGE_MS);
      expect(isSessionExpired(session, fixedNow)).toBe(false);
    });

    it('identifies expired sessions correctly when clock advances past 30 days', () => {
      const start = 1700000000000;
      const session = createSessionPayload({
        userId: '018f3a55-0000-7000-8000-000000000001',
        email: 'alice@example.com',
        now: start,
      });

      // Day 29: still valid
      const day29 = start + 29 * 24 * 60 * 60 * 1000;
      expect(isSessionExpired(session, day29)).toBe(false);

      // Day 30 + 1ms: expired
      const day30And1ms = start + SESSION_MAX_AGE_MS + 1;
      expect(isSessionExpired(session, day30And1ms)).toBe(true);
    });

    it('determines rolling refresh eligibility based on elapsed time threshold', () => {
      const start = 1700000000000;
      const session = createSessionPayload({
        userId: '018f3a55-0000-7000-8000-000000000001',
        email: 'alice@example.com',
        now: start,
      });

      // 10 minutes in: do not refresh yet to prevent excessive writes
      expect(shouldRefreshSession(session, start + 10 * 60 * 1000)).toBe(false);

      // 2 hours in (> 1 hour threshold): eligible to roll forward
      const twoHoursLater = start + 2 * SESSION_ROLLING_REFRESH_THRESHOLD_MS;
      expect(shouldRefreshSession(session, twoHoursLater)).toBe(true);

      // Rolling expiry pushes expiration 30 days ahead of the current time
      const rolled = rollSessionExpiry(session, twoHoursLater);
      expect(rolled.expiresAt).toBe(twoHoursLater + SESSION_MAX_AGE_MS);
    });

    it('rotates session with new active org and role while preserving identity', () => {
      const start = 1700000000000;
      const session = createSessionPayload({
        userId: '018f3a55-0000-7000-8000-000000000001',
        email: 'alice@example.com',
        activeOrgId: '018f3a55-0000-7000-8000-000000000010',
        role: 'member',
        sessionEpoch: 1,
        now: start,
      });

      const rotatedNow = start + 3600 * 1000;
      const rotated = rotateSession(
        session,
        {
          activeOrgId: '018f3a55-0000-7000-8000-000000000020',
          role: 'admin',
          sessionEpoch: 2,
        },
        rotatedNow
      );

      expect(rotated.userId).toBe(session.userId);
      expect(rotated.email).toBe(session.email);
      expect(rotated.activeOrgId).toBe('018f3a55-0000-7000-8000-000000000020');
      expect(rotated.role).toBe('admin');
      expect(rotated.sessionEpoch).toBe(2);
      expect(rotated.createdAt).toBe(rotatedNow);
      expect(rotated.expiresAt).toBe(rotatedNow + SESSION_MAX_AGE_MS);
    });
  });

  describe('Authenticated Session Encryption (AES-256-GCM)', () => {
    it('encrypts and decrypts session payload cleanly', () => {
      const session = createSessionPayload({
        userId: '018f3a55-0000-7000-8000-000000000001',
        email: 'alice@example.com',
        activeOrgId: '018f3a55-0000-7000-8000-000000000010',
        role: 'owner',
        sessionEpoch: 1,
      });

      const encrypted = encryptSession(session, testSecret);
      expect(typeof encrypted).toBe('string');
      expect(encrypted.split('.').length).toBe(3);

      const decrypted = decryptSession(encrypted, testSecret);
      expect(decrypted).not.toBeNull();
      expect(decrypted?.userId).toBe(session.userId);
      expect(decrypted?.email).toBe(session.email);
      expect(decrypted?.activeOrgId).toBe(session.activeOrgId);
      expect(decrypted?.role).toBe(session.role);
      expect(decrypted?.sessionEpoch).toBe(session.sessionEpoch);
    });

    it('rejects tampered tokens and returns null', () => {
      const session = createSessionPayload({
        userId: '018f3a55-0000-7000-8000-000000000001',
        email: 'alice@example.com',
      });

      const encrypted = encryptSession(session, testSecret);
      const parts = encrypted.split('.');

      // Tamper ciphertext
      const firstChar = parts[1]?.[0] === 'x' ? 'y' : 'x';
      const tamperedCipher = firstChar + parts[1]?.slice(1);
      const tampered = `${parts[0]}.${tamperedCipher}.${parts[2]}`;

      expect(decryptSession(tampered, testSecret)).toBeNull();
      expect(decryptSession('totally.invalid.token', testSecret)).toBeNull();
      expect(decryptSession('', testSecret)).toBeNull();
    });

    it('fails decryption when decrypted with wrong secret', () => {
      const session = createSessionPayload({
        userId: '018f3a55-0000-7000-8000-000000000001',
        email: 'alice@example.com',
      });

      const encrypted = encryptSession(session, testSecret);
      const wrongSecret = 'another-secret-value-must-be-16c';

      expect(decryptSession(encrypted, wrongSecret)).toBeNull();
    });
  });

  describe('Internal BFF-to-API HMAC Signatures', () => {
    it('generates and verifies valid request signatures within clock skew limit', () => {
      const now = Date.now();
      const identity = {
        userId: '018f3a55-0000-7000-8000-000000000001',
        email: 'alice@example.com',
        timestamp: now,
      };

      const signature = signInternalApiRequest(identity, testSecret);
      expect(signature).toBeDefined();

      const valid = verifyInternalApiRequest(identity, signature, testSecret, 300, now + 1000);
      expect(valid).toBe(true);
    });

    it('rejects replayed requests with excessive timestamp skew', () => {
      const now = Date.now();
      const identity = {
        userId: '018f3a55-0000-7000-8000-000000000001',
        email: 'alice@example.com',
        timestamp: now - 350 * 1000, // 350 seconds ago (> 300s skew)
      };

      const signature = signInternalApiRequest(identity, testSecret);
      const valid = verifyInternalApiRequest(identity, signature, testSecret, 300, now);
      expect(valid).toBe(false);
    });

    it('rejects forged signatures or mismatched identity payloads', () => {
      const now = Date.now();
      const identity = {
        userId: '018f3a55-0000-7000-8000-000000000001',
        email: 'alice@example.com',
        timestamp: now,
      };

      const signature = signInternalApiRequest(identity, testSecret);

      // Tampered email
      const forgedIdentity = { ...identity, email: 'eve@example.com' };
      expect(verifyInternalApiRequest(forgedIdentity, signature, testSecret, 300, now)).toBe(false);

      // Wrong secret
      expect(verifyInternalApiRequest(identity, signature, 'wrong-secret-value-key', 300, now)).toBe(false);
    });
  });

  describe('Organization Role Matrix & Authority Rules', () => {
    it('evaluates role hierarchy correctly', () => {
      expect(hasMinimumRole('owner', 'admin')).toBe(true);
      expect(hasMinimumRole('admin', 'admin')).toBe(true);
      expect(hasMinimumRole('admin', 'owner')).toBe(false);
      expect(hasMinimumRole('viewer', 'member')).toBe(false);
    });

    it('enforces member management permissions', () => {
      expect(canManageMembers('owner')).toBe(true);
      expect(canManageMembers('admin')).toBe(true);
      expect(canManageMembers('member')).toBe(false);
      expect(canManageMembers('viewer')).toBe(false);
    });

    it('prevents Admins from inviting or assigning Owner role', () => {
      // Owner can invite all roles
      expect(canInviteOrAssignRole('owner', 'admin')).toBe(true);
      expect(canInviteOrAssignRole('owner', 'member')).toBe(true);
      expect(canInviteOrAssignRole('owner', 'viewer')).toBe(true);

      // Admin CANNOT invite Owner
      expect(canInviteOrAssignRole('admin', 'owner')).toBe(false);
      expect(canInviteOrAssignRole('admin', 'member')).toBe(true);
      expect(canInviteOrAssignRole('admin', 'viewer')).toBe(true);

      // Members cannot invite anyone
      expect(canInviteOrAssignRole('member', 'viewer')).toBe(false);
    });

    it('enforces role modification barriers', () => {
      // Owner can change admin to member or owner
      expect(canModifyMemberRole('owner', 'admin', 'member')).toBe(true);
      expect(canModifyMemberRole('owner', 'member', 'admin')).toBe(true);

      // Admin CANNOT modify owner
      expect(canModifyMemberRole('admin', 'owner', 'member')).toBe(false);
      // Admin CANNOT elevate to owner
      expect(canModifyMemberRole('admin', 'member', 'owner')).toBe(false);
      // Admin CANNOT modify another admin
      expect(canModifyMemberRole('admin', 'admin', 'member')).toBe(false);
      // Admin CAN modify member to viewer and vice versa
      expect(canModifyMemberRole('admin', 'member', 'viewer')).toBe(true);
      expect(canModifyMemberRole('admin', 'viewer', 'member')).toBe(true);
    });

    it('enforces member removal barriers', () => {
      expect(canRemoveMember('owner', 'admin', false)).toBe(true);
      expect(canRemoveMember('owner', 'member', false)).toBe(true);

      // Admin cannot remove owner or admin
      expect(canRemoveMember('admin', 'owner', false)).toBe(false);
      expect(canRemoveMember('admin', 'admin', false)).toBe(false);
      expect(canRemoveMember('admin', 'member', false)).toBe(true);
      expect(canRemoveMember('admin', 'viewer', false)).toBe(true);

      // User can remove themselves (self-departure)
      expect(canRemoveMember('member', 'member', true)).toBe(true);
    });

    it('restricts organization deletion to Owners only', () => {
      expect(canDeleteOrg('owner')).toBe(true);
      expect(canDeleteOrg('admin')).toBe(false);
      expect(canDeleteOrg('member')).toBe(false);
      expect(canDeleteOrg('viewer')).toBe(false);
    });
  });

  describe('Invitations & Cryptographic Tokens', () => {
    it('generates secure random tokens with SHA-256 hashes and 7-day expiration', () => {
      const now = new Date('2026-10-05T12:00:00Z');
      const token = generateInvitationToken(now);

      expect(token.rawToken.length).toBe(64); // 32 bytes hex
      expect(token.tokenHash.length).toBe(64); // sha256 hex
      expect(hashToken(token.rawToken)).toBe(token.tokenHash);

      const expectedExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      expect(token.expiresAt.toISOString()).toBe(expectedExpiry.toISOString());
    });

    it('generates distinct high-entropy tokens on every invocation', () => {
      const t1 = generateSecureRandomToken(32);
      const t2 = generateSecureRandomToken(32);
      expect(t1).not.toBe(t2);
    });
  });
});
