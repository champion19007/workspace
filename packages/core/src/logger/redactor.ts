export const SENSITIVE_FIELD_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'api_key',
  'secret_arn',
  'code',
  'code_verifier',
  'authorization_code',
  'client_secret',
  'plaintoken',
  'encryptedtoken',
  'signature',
  'x-zm-signature',
  'download_url',
  'play_url',
  'download_token',
  'transcript',
  'transcript_text',
  'vtt',
  'text',
  'body_md',
  'body_json',
  'comment',
  'comment_body',
]);

export const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-origin-verify"]',
  'req.headers["x-zm-signature"]',
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
  '*.api_key',
  '*.plainToken',
  '*.encryptedToken',
  '*.download_url',
  '*.play_url',
  '*.download_token',
  '*.code_verifier',
  '*.code',
  '*.transcript',
  '*.body_md',
  '*.body_json',
  '*.text',
  '*.comment_body',
];

export function redactSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Redact authorization bearer strings
    if (data.toLowerCase().startsWith('bearer ')) {
      return 'Bearer [REDACTED]';
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item));
  }

  if (typeof data === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (SENSITIVE_FIELD_NAMES.has(normalizedKey)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = redactSensitiveData(value);
      }
    }
    return output;
  }

  return data;
}
