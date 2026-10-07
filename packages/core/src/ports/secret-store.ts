export interface StoredSecretPayload {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: string; // ISO 8601 string
  scope: string[];
  [key: string]: unknown;
}

export interface SecretStorePort {
  /**
   * Persists secret payload in the managed secret store under an opaque identifier.
   * Returns the canonical secret ARN / reference key.
   */
  storeSecret(refKey: string, payload: StoredSecretPayload): Promise<{ secretArn: string }>;

  /**
   * Retrieves secret payload by its opaque ARN.
   * Returns null if secret does not exist or has been deleted.
   */
  getSecret(secretArn: string): Promise<StoredSecretPayload | null>;

  /**
   * Immediately purges/invalidates the secret from the managed store.
   */
  deleteSecret(secretArn: string): Promise<void>;
}
