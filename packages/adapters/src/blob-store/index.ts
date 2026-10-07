import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  type BlobStorePort,
  type PresignedUrlResult,
  type PutObjectRequest,
  type GetObjectResult,
  AdapterUnavailableError,
} from '@workspace/core';

export class InMemoryBlobStoreAdapter implements BlobStorePort {
  public readonly provider = 'in_memory';
  private readonly store = new Map<string, { body: Uint8Array; contentType: string }>();

  async getDownloadUrl(key: string, expiresInSeconds = 300): Promise<PresignedUrlResult> {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    return {
      url: `http://localhost:8080/blobs/download/${encodeURIComponent(key)}?expires=${expiresAt.toISOString()}`,
      expiresAt,
    };
  }

  async getUploadUrl(key: string, _contentType: string, expiresInSeconds = 300): Promise<PresignedUrlResult> {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    return {
      url: `http://localhost:8080/blobs/upload/${encodeURIComponent(key)}?expires=${expiresAt.toISOString()}`,
      expiresAt,
    };
  }

  async putObject(req: PutObjectRequest): Promise<void> {
    this.store.set(req.key, { body: req.body, contentType: req.contentType });
  }

  async getObject(key: string): Promise<GetObjectResult> {
    const item = this.store.get(key);
    if (!item) {
      throw new Error(`Blob not found: ${key}`);
    }
    return {
      body: item.body,
      contentType: item.contentType,
      contentLength: item.body.byteLength,
    };
  }

  async deleteObject(key: string): Promise<void> {
    this.store.delete(key);
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return { healthy: true, details: { provider: this.provider, objectCount: this.store.size } };
  }
}

export interface SupabaseStorageConfig {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  bucket?: string;
}

export class SupabaseBlobStoreAdapter implements BlobStorePort {
  public readonly provider = 'supabase';
  private client: SupabaseClient | null = null;
  private readonly bucket: string;

  constructor(private readonly config: SupabaseStorageConfig) {
    if (!config.supabaseUrl || !config.serviceRoleKey) {
      throw new AdapterUnavailableError(
        'BlobStore',
        'supabase',
        'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.'
      );
    }
    this.bucket = config.bucket || 'workspace-attachments';
  }

  private getClient(): SupabaseClient {
    if (!this.client) {
      this.client = createClient(this.config.supabaseUrl!, this.config.serviceRoleKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return this.client;
  }

  async getDownloadUrl(key: string, expiresInSeconds = 300): Promise<PresignedUrlResult> {
    const client = this.getClient();
    const { data, error } = await client.storage.from(this.bucket).createSignedUrl(key, expiresInSeconds);
    if (error || !data) {
      throw new Error(`Failed to generate signed download URL: ${error?.message}`);
    }
    return {
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  async getUploadUrl(key: string, _contentType: string, expiresInSeconds = 300): Promise<PresignedUrlResult> {
    const client = this.getClient();
    const { data, error } = await client.storage.from(this.bucket).createSignedUploadUrl(key);
    if (error || !data) {
      throw new Error(`Failed to generate signed upload URL: ${error?.message}`);
    }
    return {
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  async putObject(req: PutObjectRequest): Promise<void> {
    const client = this.getClient();
    const { error } = await client.storage.from(this.bucket).upload(req.key, req.body, {
      contentType: req.contentType,
      upsert: true,
    });
    if (error) {
      throw new Error(`Failed to put blob ${req.key}: ${error.message}`);
    }
  }

  async getObject(key: string): Promise<GetObjectResult> {
    const client = this.getClient();
    const { data, error } = await client.storage.from(this.bucket).download(key);
    if (error || !data) {
      throw new Error(`Failed to get blob ${key}: ${error?.message}`);
    }
    const buffer = new Uint8Array(await data.arrayBuffer());
    return {
      body: buffer,
      contentType: data.type || 'application/octet-stream',
      contentLength: buffer.byteLength,
    };
  }

  async deleteObject(key: string): Promise<void> {
    const client = this.getClient();
    const { error } = await client.storage.from(this.bucket).remove([key]);
    if (error) {
      throw new Error(`Failed to delete blob ${key}: ${error.message}`);
    }
  }

  async deletePrefix(prefix: string): Promise<number> {
    const client = this.getClient();
    const { data, error } = await client.storage.from(this.bucket).list(prefix);
    if (error || !data) return 0;
    const paths = data.map((item) => `${prefix}/${item.name}`);
    if (paths.length === 0) return 0;
    const { error: removeError } = await client.storage.from(this.bucket).remove(paths);
    if (removeError) {
      throw new Error(`Failed to delete prefix ${prefix}: ${removeError.message}`);
    }
    return paths.length;
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return {
      healthy: Boolean(this.config.supabaseUrl && this.config.serviceRoleKey),
      details: {
        provider: this.provider,
        bucket: this.bucket,
        configured: Boolean(this.config.supabaseUrl && this.config.serviceRoleKey),
      },
    };
  }
}

export interface S3BlobStoreConfig {
  bucket?: string;
  region?: string;
}

export class S3BlobStoreAdapter implements BlobStorePort {
  public readonly provider = 's3';

  constructor(private readonly config: S3BlobStoreConfig) {
    if (!config.bucket) {
      throw new AdapterUnavailableError(
        'BlobStore',
        's3',
        'Missing S3_ATTACHMENTS_BUCKET configuration.'
      );
    }
  }

  async getDownloadUrl(_key: string, _expiresInSeconds?: number): Promise<PresignedUrlResult> {
    throw new AdapterUnavailableError('BlobStore', 's3', 'AWS S3 client uninitialized.');
  }

  async getUploadUrl(_key: string, _contentType: string, _expiresInSeconds?: number): Promise<PresignedUrlResult> {
    throw new AdapterUnavailableError('BlobStore', 's3', 'AWS S3 client uninitialized.');
  }

  async putObject(_req: PutObjectRequest): Promise<void> {
    throw new AdapterUnavailableError('BlobStore', 's3', 'AWS S3 client uninitialized.');
  }

  async getObject(_key: string): Promise<GetObjectResult> {
    throw new AdapterUnavailableError('BlobStore', 's3', 'AWS S3 client uninitialized.');
  }

  async deleteObject(_key: string): Promise<void> {
    throw new AdapterUnavailableError('BlobStore', 's3', 'AWS S3 client uninitialized.');
  }

  async deletePrefix(_prefix: string): Promise<number> {
    throw new AdapterUnavailableError('BlobStore', 's3', 'AWS S3 client uninitialized.');
  }

  async checkHealth(): Promise<{ healthy: boolean; details?: unknown }> {
    return {
      healthy: false,
      details: {
        provider: this.provider,
        error: 'AWS S3 uninitialized',
        configured: Boolean(this.config.bucket),
      },
    };
  }
}
