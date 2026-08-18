import { ZodError } from "zod";

export type AppErrorCode =
  | "bad_request"
  | "not_found"
  | "conflict"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "configuration_error"
  | "image_invalid"
  | "image_missing"
  | "analysis_not_ready"
  | "upstream_authentication"
  | "upstream_rate_limit"
  | "upstream_timeout"
  | "upstream_refusal"
  | "upstream_invalid_output"
  | "upstream_unavailable"
  | "database_error"
  | "internal_error";

const statusByCode: Record<AppErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  conflict: 409,
  unauthorized: 401,
  forbidden: 403,
  rate_limited: 429,
  configuration_error: 503,
  image_invalid: 422,
  image_missing: 409,
  analysis_not_ready: 409,
  upstream_authentication: 502,
  upstream_rate_limit: 429,
  upstream_timeout: 504,
  upstream_refusal: 422,
  upstream_invalid_output: 502,
  upstream_unavailable: 503,
  database_error: 500,
  internal_error: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    message: string,
    options: {
      status?: number;
      retryable?: boolean;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? statusByCode[code];
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new AppError("bad_request", "The submitted data is invalid.", {
      details: {
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      cause: error,
    });
  }

  if (error instanceof SyntaxError) {
    return new AppError("bad_request", "The request body is not valid JSON.", {
      cause: error,
    });
  }

  if (error instanceof Error) {
    if (error.name === "RecordNotFoundError") {
      return new AppError("not_found", error.message, { cause: error });
    }
    if (
      error.name === "PersistenceConflictError" ||
      error.name === "InvalidStateTransitionError"
    ) {
      return new AppError("conflict", error.message, { cause: error });
    }
    if (error.name === "PersistenceValidationError") {
      return new AppError("bad_request", error.message, { cause: error });
    }
    if (error.name === "SqliteError") {
      return new AppError("database_error", "The local database operation failed.", {
        cause: error,
      });
    }
  }

  return new AppError("internal_error", "An unexpected error occurred.", {
    cause: error,
  });
}
