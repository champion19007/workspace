import { describe, it, expect } from 'vitest';
import { redactSensitiveData, SENSITIVE_FIELD_NAMES } from '../logger/redactor.js';

describe('Logger Redactor and Data Protection', () => {
  it('identifies sensitive fields in set', () => {
    expect(SENSITIVE_FIELD_NAMES.has('password')).toBe(true);
    expect(SENSITIVE_FIELD_NAMES.has('transcript')).toBe(true);
  });

  it('redacts sensitive headers, tokens, passwords, and transcripts', () => {
    const rawData = {
      requestId: 'req-123',
      authorization: 'Bearer super-secret-jwt-token',
      password: 'mypassword',
      cookie: 'session_id=abcdef',
      transcript: 'Full private meeting transcript text discussing internal strategy',
      comment_body: 'Private discussion comment',
      user: {
        id: 'usr-1',
        email: 'test@example.com',
        apiKey: 'key_live_999999',
      },
    };

    const redacted = redactSensitiveData(rawData) as Record<string, unknown>;

    expect(redacted['requestId']).toBe('req-123');
    expect(redacted['authorization']).toBe('[REDACTED]');
    expect(redacted['password']).toBe('[REDACTED]');
    expect(redacted['cookie']).toBe('[REDACTED]');
    expect(redacted['transcript']).toBe('[REDACTED]');
    expect(redacted['comment_body']).toBe('[REDACTED]');

    const nestedUser = redacted['user'] as Record<string, unknown>;
    expect(nestedUser['id']).toBe('usr-1');
    expect(nestedUser['email']).toBe('test@example.com');
    expect(nestedUser['apiKey']).toBe('[REDACTED]');
  });

  it('redacts standalone bearer auth string values', () => {
    expect(redactSensitiveData('Bearer eyJhbGciOi...')).toBe('Bearer [REDACTED]');
  });
});
