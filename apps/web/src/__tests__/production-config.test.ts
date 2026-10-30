import { afterEach, describe, expect, it, vi } from 'vitest';
import { productionConfigProblems } from '@/lib/server-context';
import { getSessionSecret } from '@/lib/session';

const complete = {
  DATABASE_URL: 'postgresql://workspace_api.ref:pw@pooler.example.com:6543/postgres',
  SESSION_SECRET: 's'.repeat(32),
  AUTH_PROVIDER: 'supabase',
  SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
};

// A public deployment must refuse to serve rather than run with demo sign-in or the repository's secrets.
describe('production configuration guard', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts a complete Supabase setup', () => {
    expect(productionConfigProblems(complete)).toEqual([]);
  });

  it('lists everything missing from an empty environment at once', () => {
    expect(productionConfigProblems({})).toHaveLength(3);
  });

  it('refuses demo sign-in, a short secret and missing Supabase keys', () => {
    expect(productionConfigProblems({ ...complete, AUTH_PROVIDER: 'mock' })).toEqual([expect.stringContaining('AUTH_PROVIDER')]);
    expect(productionConfigProblems({ ...complete, SESSION_SECRET: 'short' })).toEqual([expect.stringContaining('SESSION_SECRET')]);
    expect(productionConfigProblems({ ...complete, SUPABASE_ANON_KEY: undefined })).toEqual([expect.stringContaining('SUPABASE_ANON_KEY')]);
  });

  it('never signs sessions with the development fallback secret in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_SECRET', '');
    expect(() => getSessionSecret()).toThrow(/SESSION_SECRET/);

    vi.stubEnv('SESSION_SECRET', 'p'.repeat(40));
    expect(getSessionSecret()).toBe('p'.repeat(40));
  });
});
