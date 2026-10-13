import { NextResponse } from 'next/server';
import { DomainError, PreconditionFailedError, createProblemDetails } from '@workspace/core';

/** RFC 9457 problem+json response with the same shape the Fastify API emits (stable `code`). */
export function problemJson(
  status: number,
  code: string,
  detail: string,
  instance: string,
  extra: { currentEntity?: unknown; details?: unknown } = {}
): NextResponse {
  return NextResponse.json(createProblemDetails({ title: detail, status, detail, code, instance, ...extra }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/** Maps a thrown error to problem+json. Only the code is logged: `details` can carry task/proposal text. */
export function problemFromError(err: unknown, instance: string): NextResponse {
  if (err instanceof DomainError) {
    const isPrecondition = err instanceof PreconditionFailedError;
    const details =
      !isPrecondition && err.details && typeof err.details === 'object' && !Array.isArray(err.details)
        ? err.details
        : undefined;
    return problemJson(err.status, err.code, err.message, instance, {
      currentEntity: isPrecondition ? err.details : undefined,
      details,
    });
  }
  console.error('Unhandled BFF error', { instance, name: (err as Error)?.name, message: (err as Error)?.message });
  return problemJson(500, 'INTERNAL_ERROR', 'Unexpected server error', instance);
}
