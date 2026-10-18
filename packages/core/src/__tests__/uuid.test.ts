import { describe, it, expect } from 'vitest';
import { generateUuidV7 } from '../utils/uuid.js';

describe('generateUuidV7', () => {
  it('sorts ids generated within one millisecond in generation order', () => {
    const ms = Date.UTC(2026, 9, 18);
    const ids = Array.from({ length: 1000 }, () => generateUuidV7(ms));

    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(ms);
    }
  });
});
