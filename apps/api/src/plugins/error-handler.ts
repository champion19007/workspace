import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import {
  DomainError,
  ValidationError,
  PreconditionFailedError,
  PreconditionRequiredError,
  RateLimitError,
  createProblemDetails,
} from '@workspace/core';
import { ZodError } from 'zod';

const HTTP_STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  412: 'Precondition Failed',
  422: 'Validation Failed',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

export function rfc9457ErrorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (error instanceof DomainError && error.status < 500) {
    // Client errors: log the stable code only. `details` can carry entity snapshots
    // (task text, transcript evidence quotes) that must never reach logs.
    request.log.warn({ code: error.code, status: error.status }, error.message);
  } else {
    request.log.error({ err: error }, 'Request processing error');
  }

  reply.header('content-type', 'application/problem+json');

  // 1. Zod Validation Errors
  if (error instanceof ZodError) {
    const invalidParams = error.errors.map((err) => ({
      name: err.path.join('.'),
      reason: err.message,
    }));
    const problem = createProblemDetails({
      title: 'Validation Failed',
      status: 422,
      detail: 'The request payload or parameters failed validation',
      code: 'VALIDATION_ERROR',
      instance: request.raw.url,
      invalidParams,
    });
    return reply.status(422).send(problem);
  }

  // 2. Precondition Failed (Optimistic Concurrency ETag Mismatch)
  if (error instanceof PreconditionFailedError) {
    if (error.details && typeof error.details === 'object' && 'version' in error.details) {
      reply.header('ETag', `"${typeof (error.details as any).version === 'number' ? `v${(error.details as any).version}` : (error.details as any).version}"`);
    }
    const problem = createProblemDetails({
      title: 'Precondition Failed',
      status: 412,
      detail: error.message,
      code: error.code,
      instance: request.raw.url,
      currentEntity: error.details,
    });
    return reply.status(412).send(problem);
  }

  // 2b. Precondition Required (Missing If-Match Header)
  if (error instanceof PreconditionRequiredError) {
    const problem = createProblemDetails({
      title: 'Precondition Required',
      status: 428,
      detail: error.message,
      code: error.code,
      instance: request.raw.url,
    });
    return reply.status(428).send(problem);
  }

  // 3. Rate Limit Exceeded
  if (error instanceof RateLimitError) {
    reply.header('retry-after', String(error.retryAfterSeconds));
    const problem = createProblemDetails({
      title: 'Too Many Requests',
      status: 429,
      detail: error.message,
      code: error.code,
      instance: request.raw.url,
      details: { retryAfterSeconds: error.retryAfterSeconds },
    });
    return reply.status(429).send(problem);
  }

  // 4. Domain Errors
  if (error instanceof DomainError) {
    let invalidParams: Array<{ name: string; reason: string }> | undefined;
    if (error instanceof ValidationError) {
      if (Array.isArray(error.details)) {
        invalidParams = error.details.map((d: any) => ({
          name: Array.isArray(d.path) ? d.path.join('.') : (d.name || String(d.path || 'unknown')),
          reason: d.reason || d.message || 'invalid parameter',
        }));
      } else if (error.details && typeof error.details === 'object') {
        const detailsObj = error.details as Record<string, any>;
        if ('issues' in detailsObj && Array.isArray(detailsObj.issues)) {
          invalidParams = detailsObj.issues.map((i: any) => ({
            name: Array.isArray(i.path) ? i.path.join('.') : 'parameter',
            reason: i.message || 'invalid parameter',
          }));
        } else {
          invalidParams = Object.entries(detailsObj)
            .filter(([k]) => k !== '_errors')
            .map(([k, v]: [string, any]) => ({
              name: k,
              reason: Array.isArray(v?._errors) ? v._errors.join(', ') : 'invalid parameter',
            }));
        }
      }
    }

    const title = error.message;
    const problem = createProblemDetails({
      title,
      status: error.status,
      detail: error.message,
      code: error.code,
      instance: request.raw.url,
      invalidParams,
      details: typeof error.details === 'object' && !Array.isArray(error.details) ? error.details : undefined,
    });
    return reply.status(error.status).send(problem);
  }

  // 5. Fastify Schema Validation Errors
  const fastifyErr = error as FastifyError;
  if (fastifyErr.validation) {
    const invalidParams = fastifyErr.validation.map((v) => ({
      name: String(v.instancePath || (v.params as any)?.issue || 'body').replace(/^\//, ''),
      reason: v.message || 'validation failed',
    }));
    const problem = createProblemDetails({
      title: 'Bad Request',
      status: 400,
      detail: fastifyErr.message,
      code: 'BAD_REQUEST',
      instance: request.raw.url,
      invalidParams,
    });
    return reply.status(400).send(problem);
  }

  // 6. Fastify Rate Limit Error (statusCode 429)
  if (fastifyErr.statusCode === 429) {
    const problem = createProblemDetails({
      title: 'Too Many Requests',
      status: 429,
      detail: 'Rate limit exceeded. Please wait before retrying.',
      code: 'RATE_LIMIT_EXCEEDED',
      instance: request.raw.url,
    });
    return reply.status(429).send(problem);
  }

  // 7. Generic Internal Server Error
  const statusCode = fastifyErr.statusCode ?? 500;
  const isInternal = statusCode >= 500;
  const problem = createProblemDetails({
    title: isInternal ? 'Internal Server Error' : (HTTP_STATUS_TITLES[statusCode] ?? error.message),
    status: statusCode,
    detail: isInternal ? 'An unexpected server error occurred' : error.message,
    code: isInternal ? 'INTERNAL_ERROR' : (fastifyErr.code || 'REQUEST_ERROR'),
    instance: request.raw.url,
  });

  return reply.status(statusCode).send(problem);
}
