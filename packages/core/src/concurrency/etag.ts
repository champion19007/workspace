/**
 * Optimistic Concurrency Control (OCC) ETag utilities.
 * Uses strong ETags (e.g. "v7") for canonical versioned resource representations.
 * RFC 9110 Section 13.1.1: If-Match uses strong comparison; weak validators
 * (starting with W/ or w/) must NOT match under strong comparison.
 */

export function formatETag(version: number): string {
  return `"v${version}"`;
}

export function isWeakETag(headerValue?: string | null): boolean {
  if (!headerValue) return false;
  return /^w\//i.test(headerValue.trim());
}

/**
 * Parses an ETag using strong comparison rules.
 * If the validator is weak (prefixed with W/ or w/), it returns null.
 * Otherwise extracts the integer version from strong representations like "v7", "7", v7, or 7.
 */
export function parseStrongETag(headerValue?: string | null): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  // Weak tags are strictly rejected under strong comparison
  if (isWeakETag(trimmed)) {
    return null;
  }
  const match = trimmed.match(/^"?v?(\d+)"?$/);
  if (!match || !match[1]) return null;
  const parsed = parseInt(match[1], 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Default ETag parser enforcing strong validation for If-Match.
 */
export function parseETag(headerValue?: string | null): number | null {
  return parseStrongETag(headerValue);
}

export function matchesStrongETag(currentVersion: number, headerValue?: string | null): boolean {
  const parsed = parseStrongETag(headerValue);
  if (parsed === null) return false;
  return currentVersion === parsed;
}

export function matchesETag(currentVersion: number, headerValue?: string | null): boolean {
  return matchesStrongETag(currentVersion, headerValue);
}
