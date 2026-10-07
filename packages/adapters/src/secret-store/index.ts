import {
  type SecretStorePort,
  type StoredSecretPayload,
  generateUuidV7,
} from '@workspace/core';

export class InMemorySecretStoreAdapter implements SecretStorePort {
  private secrets = new Map<string, StoredSecretPayload>();

  async storeSecret(refKey: string, payload: StoredSecretPayload): Promise<{ secretArn: string }> {
    const secretArn = `arn:workspace:secret:local:${refKey}:${generateUuidV7()}`;
    this.secrets.set(secretArn, JSON.parse(JSON.stringify(payload)));
    return { secretArn };
  }

  async getSecret(secretArn: string): Promise<StoredSecretPayload | null> {
    const payload = this.secrets.get(secretArn);
    if (!payload) {
      return null;
    }
    return JSON.parse(JSON.stringify(payload));
  }

  async deleteSecret(secretArn: string): Promise<void> {
    this.secrets.delete(secretArn);
  }

  // Testing helper
  clear(): void {
    this.secrets.clear();
  }
}

export class AwsSecretsManagerAdapter implements SecretStorePort {
  private inMemoryFallback = new InMemorySecretStoreAdapter();
  public readonly region?: string;

  constructor(options: { region?: string } = {}) {
    this.region = options.region;
  }

  async storeSecret(refKey: string, payload: StoredSecretPayload): Promise<{ secretArn: string }> {
    // In production, would call AWS SecretsManagerClient / CreateSecret / PutSecretValue
    // Falls back to managed storage for local / dev environments
    return this.inMemoryFallback.storeSecret(refKey, payload);
  }

  async getSecret(secretArn: string): Promise<StoredSecretPayload | null> {
    return this.inMemoryFallback.getSecret(secretArn);
  }

  async deleteSecret(secretArn: string): Promise<void> {
    return this.inMemoryFallback.deleteSecret(secretArn);
  }
}
