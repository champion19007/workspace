import crypto from 'crypto';
import { SessionPayloadSchema, type SessionPayload } from './session.js';

/**
 * Derives a 32-byte encryption key from a secret string using SHA-256.
 */
function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a session payload into an authenticated AES-256-GCM token string.
 * Format: iv:ciphertext:tag (base64url encoded segments)
 */
export function encryptSession(session: SessionPayload, secret: string): string {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const serialized = JSON.stringify(session);
  const encrypted = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`;
}

/**
 * Decrypts and validates an authenticated AES-256-GCM token string.
 * Returns null if decryption fails or authentication tag is invalid.
 */
export function decryptSession(token: string, secret: string): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [ivPart, dataPart, tagPart] = parts;
  if (!ivPart || !dataPart || !tagPart) return null;

  try {
    const key = deriveKey(secret);
    const iv = Buffer.from(ivPart, 'base64url');
    const data = Buffer.from(dataPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');

    if (iv.length !== 12 || tag.length !== 16) return null;

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString('utf8'));

    const validation = SessionPayloadSchema.safeParse(parsed);
    if (!validation.success) {
      return null;
    }

    return validation.data;
  } catch {
    return null;
  }
}

/**
 * Computes SHA-256 hex hash of a raw token (e.g. for invitations or magic-link replay protection).
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Generates a high-entropy cryptographically secure random token (64 hex characters by default).
 */
export function generateSecureRandomToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export interface InternalApiIdentity {
  userId: string;
  email: string;
  timestamp: number;
}

/**
 * Signs an internal BFF-to-API request header using HMAC-SHA256.
 */
export function signInternalApiRequest(identity: InternalApiIdentity, secret: string): string {
  const message = `${identity.userId}:${identity.email.toLowerCase()}:${identity.timestamp}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * Verifies an internal BFF-to-API request signature with timing-safe comparison and replay protection.
 */
export function verifyInternalApiRequest(
  identity: InternalApiIdentity,
  signature: string,
  secret: string,
  maxSkewSeconds: number = 300,
  nowMs: number = Date.now()
): boolean {
  if (!identity.userId || !identity.email || !identity.timestamp || !signature) {
    return false;
  }

  // Clock skew check (default 5 minutes max skew)
  const skewSeconds = Math.abs(nowMs - identity.timestamp) / 1000;
  if (skewSeconds > maxSkewSeconds) {
    return false;
  }

  const expectedSignature = signInternalApiRequest(identity, secret);

  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}
