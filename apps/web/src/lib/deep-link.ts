import { isValidUuid } from '@workspace/core';

/**
 * Reads an id from a deep-link query parameter (?meeting=, ?task=). Only UUIDs are returned: the value
 * is interpolated into same-origin fetch paths, where a decoded "../" or "?" would retarget the request.
 */
export function readDeepLinkId(search: string, param: string): string | null {
  const value = new URLSearchParams(search).get(param);
  return value && isValidUuid(value) ? value : null;
}
