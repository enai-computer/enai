/**
 * Base error class for all service-related errors
 */
export class ServiceError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: any;

  constructor(message: string, code: string, statusCode: number = 500, details?: any) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when a requested resource is not found
 */
export class NotFoundError extends ServiceError {
  constructor(resource: string, id?: string, details?: any) {
    const message = id 
      ? `${resource} with id '${id}' not found`
      : `${resource} not found`;
    super(message, 'NOT_FOUND', 404, details);
    this.name = 'NotFoundError';
  }
}

/**
 * Error thrown when input validation fails
 */
export class ValidationError extends ServiceError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

/**
 * Error thrown when user is not authorized to perform an action
 */
export class AuthorizationError extends ServiceError {
  constructor(action: string, resource?: string, details?: any) {
    const message = resource
      ? `Not authorized to ${action} ${resource}`
      : `Not authorized to ${action}`;
    super(message, 'AUTHORIZATION_ERROR', 403, details);
    this.name = 'AuthorizationError';
  }
}

/**
 * Error thrown when an external service fails
 */
export class ExternalServiceError extends ServiceError {
  public readonly service: string;

  constructor(service: string, message: string, details?: any) {
    super(`External service '${service}' error: ${message}`, 'EXTERNAL_SERVICE_ERROR', 503, details);
    this.name = 'ExternalServiceError';
    this.service = service;
  }
}

/**
 * Error thrown when a database operation fails
 */
export class DatabaseError extends ServiceError {
  public readonly operation: string;

  constructor(operation: string, message: string, details?: any) {
    super(`Database ${operation} failed: ${message}`, 'DATABASE_ERROR', 500, details);
    this.name = 'DatabaseError';
    this.operation = operation;
  }
}

/**
 * Error thrown when a rate limit is exceeded
 */
export class RateLimitError extends ServiceError {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number, details?: any) {
    super(message, 'RATE_LIMIT_ERROR', 429, { ...details, retryAfter });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Error thrown when an operation times out
 */
export class TimeoutError extends ServiceError {
  public readonly timeout: number;

  constructor(operation: string, timeout: number, details?: any) {
    super(`Operation '${operation}' timed out after ${timeout}ms`, 'TIMEOUT_ERROR', 504, details);
    this.name = 'TimeoutError';
    this.timeout = timeout;
  }
}

/**
 * Error thrown when there's a conflict with existing data
 */
export class ConflictError extends ServiceError {
  constructor(resource: string, message: string, details?: any) {
    super(`Conflict with ${resource}: ${message}`, 'CONFLICT_ERROR', 409, details);
    this.name = 'ConflictError';
  }
}

export class GmailAuthError extends ExternalServiceError {
  constructor(message: string, details?: any) {
    super('gmail', message, details);
    this.name = 'GmailAuthError';
  }
}

export class GmailRateLimitError extends ExternalServiceError {
  constructor(message: string, details?: any) {
    super('gmail', message, details);
    this.name = 'GmailRateLimitError';
  }
}

export class GmailQuotaExceededError extends ExternalServiceError {
  constructor(message: string, details?: any) {
    super('gmail', message, details);
    this.name = 'GmailQuotaExceededError';
  }
}