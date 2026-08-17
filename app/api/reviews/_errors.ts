import {
  PersistenceConflictError,
  PersistenceValidationError,
  RecordNotFoundError,
} from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { errorResponse } from "@/lib/http/response";

export function reviewErrorResponse(error: unknown) {
  if (error instanceof RecordNotFoundError) {
    return errorResponse(new AppError("not_found", "The requested review resource was not found."));
  }
  if (error instanceof PersistenceConflictError) {
    return errorResponse(new AppError("conflict", error.message));
  }
  if (error instanceof PersistenceValidationError) {
    return errorResponse(new AppError("bad_request", error.message));
  }
  if (
    error instanceof Error &&
    /^(Unknown taxonomy area|Missing review-area selection):/.test(error.message)
  ) {
    return errorResponse(new AppError("bad_request", error.message));
  }
  return errorResponse(error);
}
