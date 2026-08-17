import { NextResponse } from "next/server";

import { toAppError } from "@/lib/http/errors";

export function privateJson<T>(data: T, init?: ResponseInit): NextResponse<T> {
  const response = NextResponse.json(data, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export function errorResponse(error: unknown): NextResponse {
  const appError = toAppError(error);
  return privateJson(
    {
      error: {
        code: appError.code,
        message: appError.message,
        retryable: appError.retryable,
        ...(appError.details ? { details: appError.details } : {}),
      },
    },
    { status: appError.status },
  );
}
