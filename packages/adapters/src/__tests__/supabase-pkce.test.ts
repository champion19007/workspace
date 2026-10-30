import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@workspace/core';
import { SupabaseAuthAdapter } from '../auth/index.js';

const CALLBACK = 'https://app.example.com/api/auth/callback';
const adapter = () => new SupabaseAuthAdapter({ supabaseUrl: 'https://demo-ref.supabase.co', anonKey: 'anon-key' });
const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

// The server never sees a #fragment, so sign-in must come back as ?code= and be finished with the verifier
// created when it started, possibly on another serverless instance.
describe('SupabaseAuthAdapter PKCE sign-in', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Google sign-in round trip: the state from the start finishes the exchange', async () => {
    const auth = adapter();
    const { url, codeVerifier } = await auth.getOAuthUrl({ provider: 'google', redirectUrl: CALLBACK });
    const challenge = new URL(url).searchParams.get('code_challenge');
    expect(challenge).toBeTruthy();
    expect(codeVerifier).toBeTruthy();

    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'sb-user-1', email: 'new.person@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-26T00:00:00Z' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { user, tokens } = await adapter().exchangeOAuthCode({ code: 'auth-code-1', codeVerifier });
    expect(user.email).toBe('new.person@example.com');
    expect(user.providerUserId).toBe('sb-user-1');
    expect(tokens.accessToken).toBe('access-1');

    const [requestUrl, init] = fetchMock.mock.calls[0]!;
    expect(String(requestUrl)).toContain('/auth/v1/token?grant_type=pkce');
    const body = JSON.parse(String(init!.body));
    expect(body.auth_code).toBe('auth-code-1');
    expect(s256(body.code_verifier)).toBe(challenge);
  });

  it('email links start a PKCE flow too', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({}));
    vi.stubGlobal('fetch', fetchMock);

    const { sent, codeVerifier } = await adapter().requestPasswordless({ email: ' New.Person@Example.com ', redirectUrl: CALLBACK });
    expect(sent).toBe(true);
    expect(codeVerifier).toBeTruthy();
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.email).toBe('new.person@example.com');
    expect(body.code_challenge).toBeTruthy();
  });

  it('refuses to finish without the state from the start, e.g. a link opened in another browser', async () => {
    await expect(adapter().exchangeOAuthCode({ code: 'auth-code-1' })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(adapter().exchangeOAuthCode({ code: 'auth-code-1', codeVerifier: 'not json' })).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
