export class DomainError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(message: string, code = 'DOMAIN_ERROR', status = 400, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(message, 'NOT_FOUND', 404, details);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Authentication required', details?: unknown) {
    super(message, 'UNAUTHORIZED', 401, details);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Access forbidden for this organization or role', details?: unknown) {
    super(message, 'FORBIDDEN', 403, details);
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'Resource conflict or concurrent modification', details?: unknown) {
    super(message, 'CONFLICT', 409, details);
  }
}

export class PreconditionFailedError extends DomainError {
  constructor(message = 'Entity version mismatch (If-Match failure)', details?: unknown) {
    super(message, 'PRECONDITION_FAILED', 412, details);
  }
}

export class ValidationError extends DomainError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 'VALIDATION_ERROR', 422, details);
  }
}

export class AdapterUnavailableError extends DomainError {
  public readonly port: string;
  public readonly provider: string;

  constructor(port: string, provider: string, reason: string) {
    super(
      `Adapter for port "${port}" with provider "${provider}" is unavailable: ${reason}`,
      'ADAPTER_UNAVAILABLE',
      503,
      { port, provider, reason }
    );
    this.port = port;
    this.provider = provider;
  }
}

export class ConfigurationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFIGURATION_ERROR', 500, details);
  }
}
