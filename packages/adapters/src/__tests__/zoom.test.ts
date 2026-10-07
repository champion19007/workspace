import { describe, it, expect } from 'vitest';
import { InMemorySecretStoreAdapter } from '../secret-store/index.js';
import { MockZoomClientAdapter } from '../zoom/index.js';
import { ZOOM_REQUIRED_SCOPES } from '@workspace/core';

describe('Stage 11 Adapters: Secret Store & Zoom Client', () => {
  describe('InMemorySecretStoreAdapter', () => {
    it('stores, retrieves, and deletes secret payloads by opaque ARN', async () => {
      const store = new InMemorySecretStoreAdapter();
      const payload = {
        accessToken: 'test_access_token',
        refreshToken: 'test_refresh_token',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        scope: [...ZOOM_REQUIRED_SCOPES],
      };

      const { secretArn } = await store.storeSecret('zoom_test_account', payload);
      expect(secretArn).toMatch(/^arn:workspace:secret:local:zoom_test_account:/);

      const retrieved = await store.getSecret(secretArn);
      expect(retrieved).toEqual(payload);

      await store.deleteSecret(secretArn);
      const afterDelete = await store.getSecret(secretArn);
      expect(afterDelete).toBeNull();
    });
  });

  describe('MockZoomClientAdapter', () => {
    it('builds authorization URL with all required scopes, state, and PKCE', () => {
      const client = new MockZoomClientAdapter();
      const urlStr = client.getAuthorizationUrl({
        state: 'cryptographic_state_123',
        redirectUri: 'https://app.workspace.internal/callback',
        codeChallenge: 'code_challenge_abc',
      });

      const url = new URL(urlStr);
      expect(url.hostname).toBe('zoom.us');
      expect(url.pathname).toBe('/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('mock_zoom_client_id');
      expect(url.searchParams.get('state')).toBe('cryptographic_state_123');
      expect(url.searchParams.get('redirect_uri')).toBe('https://app.workspace.internal/callback');
      expect(url.searchParams.get('code_challenge')).toBe('code_challenge_abc');
      expect(url.searchParams.get('scope')).toBe(ZOOM_REQUIRED_SCOPES.join(' '));
    });

    it('exchanges code for tokens and fetches user profile', async () => {
      const client = new MockZoomClientAdapter();
      const tokens = await client.exchangeCode({
        code: 'valid_code',
        redirectUri: 'https://app.workspace.internal/callback',
      });

      expect(tokens.access_token).toBeDefined();
      expect(tokens.refresh_token).toBeDefined();
      expect(tokens.expires_in).toBe(3600);

      const user = await client.getCurrentUser(tokens.access_token);
      expect(user.accountId).toBe(client.mockAccountId);
      expect(user.id).toBe(client.mockUser.id);
      expect(user.email).toBe(client.mockUser.email);
    });

    it('refreshes tokens and handles simulated invalid_grant / revocation', async () => {
      const client = new MockZoomClientAdapter();
      const rotated = await client.refreshToken('valid_refresh_token');
      expect(rotated.access_token).toContain('rotated');
      expect(rotated.refresh_token).toContain('rotated');

      // Test revocation
      await client.revokeToken('some_revoked_token');
      await expect(client.refreshToken('some_revoked_token')).rejects.toThrow('Invalid grant');

      // Test simulated invalid_grant toggle
      client.simulateInvalidGrant = true;
      await expect(client.refreshToken('another_token')).rejects.toThrow('Invalid grant');
    });

    it('lists account users for host discovery', async () => {
      const client = new MockZoomClientAdapter();
      const hosts = await client.listAccountUsers('valid_access_token');
      expect(hosts.length).toBeGreaterThan(0);
      expect(hosts[0]?.id).toBe('zoom_usr_owner_123');
      expect(hosts[0]?.email).toBe('zoom-admin@workspace.internal');
    });
  });
});
