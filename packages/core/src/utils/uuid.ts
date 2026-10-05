import crypto from 'crypto';

/**
 * Generates an RFC 9562 compliant UUIDv7 string.
 * Format: 48-bit Unix timestamp (ms) | 12-bit random/counter | 2-bit variant | 62-bit random
 * Ensures chronological sortability and high entropy.
 */
export function generateUuidV7(timestampMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // 48-bit timestamp in milliseconds
  bytes[0] = (timestampMs / 0x10000000000) & 0xff;
  bytes[1] = (timestampMs / 0x100000000) & 0xff;
  bytes[2] = (timestampMs / 0x1000000) & 0xff;
  bytes[3] = (timestampMs / 0x10000) & 0xff;
  bytes[4] = (timestampMs / 0x100) & 0xff;
  bytes[5] = timestampMs & 0xff;

  // Version 7: set 4 bits of octet 6 to 0111
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;

  // Variant 1: set 2 most significant bits of octet 8 to 10
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  // Format as standard UUID string: 8-4-4-4-12
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isValidUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
