export interface PresignedUrlResult {
  url: string;
  expiresAt: Date;
}

export interface PutObjectRequest {
  key: string;
  body: Uint8Array;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface GetObjectResult {
  body: Uint8Array;
  contentType: string;
  contentLength: number;
}

export interface BlobStorePort {
  readonly provider: string;
  getDownloadUrl(key: string, expiresInSeconds?: number): Promise<PresignedUrlResult>;
  getUploadUrl(key: string, contentType: string, expiresInSeconds?: number): Promise<PresignedUrlResult>;
  putObject(req: PutObjectRequest): Promise<void>;
  getObject(key: string): Promise<GetObjectResult>;
  deleteObject(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
  checkHealth(): Promise<{ healthy: boolean; details?: unknown }>;
}
