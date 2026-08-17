import { AppError } from "@/lib/http/errors";

const JSON_MEDIA_TYPE = /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/i;

export async function readJsonBody(
  request: Request,
  maximumBytes: number,
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (!contentType || !JSON_MEDIA_TYPE.test(contentType)) {
    throw new AppError("bad_request", "The request body must use application/json.", {
      status: 415,
    });
  }

  assertContentLengthWithinLimit(request, maximumBytes);
  if (!request.body) {
    throw new AppError("bad_request", "A JSON request body is required.");
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let source = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maximumBytes) {
        await reader.cancel();
        throw payloadTooLarge(maximumBytes);
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("bad_request", "The JSON request body is not valid UTF-8.", {
      cause: error,
    });
  }

  if (!source.trim()) {
    throw new AppError("bad_request", "A JSON request body is required.");
  }

  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new AppError("bad_request", "The JSON request body is malformed.", {
      cause: error,
    });
  }
}

export function assertContentLengthWithinLimit(
  request: Request,
  maximumBytes: number,
): void {
  const value = request.headers.get("content-length");
  if (value === null) return;

  const contentLength = Number(value);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    throw new AppError("bad_request", "The Content-Length header is invalid.");
  }
  if (contentLength > maximumBytes) throw payloadTooLarge(maximumBytes);
}

export function assertMultipartRequest(request: Request): void {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new AppError("bad_request", "Image uploads must use multipart/form-data.", {
      status: 415,
    });
  }
}

export function assertReviewContextWithinLimit(
  body: unknown,
  maximumCharacters: number,
): void {
  if (
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as Record<string, unknown>).context === "string" &&
    (body as Record<string, string>).context.length > maximumCharacters
  ) {
    throw new AppError(
      "bad_request",
      `Review context cannot exceed ${maximumCharacters} characters.`,
    );
  }
}

export function assertCriteriaCountsWithinLimits(
  body: unknown,
  maximumCriteria: number,
  maximumJudgements: number,
): void {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return;
  const criteria = (body as Record<string, unknown>).criteria;
  if (!Array.isArray(criteria)) return;
  if (criteria.length > maximumCriteria) {
    throw new AppError(
      "bad_request",
      `A review can contain at most ${maximumCriteria} criteria.`,
    );
  }

  for (const criterion of criteria) {
    if (criterion === null || typeof criterion !== "object" || Array.isArray(criterion)) {
      continue;
    }
    const statements = (criterion as Record<string, unknown>).judgementStatements;
    if (Array.isArray(statements) && statements.length > maximumJudgements) {
      throw new AppError(
        "bad_request",
        `A criterion can contain at most ${maximumJudgements} judgement statements.`,
      );
    }
  }
}

export function omitClientCriteriaOrder(body: unknown): unknown {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.criteria)) return body;

  return {
    ...record,
    criteria: record.criteria.map((criterion) => {
      if (criterion === null || typeof criterion !== "object" || Array.isArray(criterion)) {
        return criterion;
      }
      const criterionFields = { ...(criterion as Record<string, unknown>) };
      delete criterionFields.order;
      if (!Array.isArray(criterionFields.judgementStatements)) return criterionFields;
      return {
        ...criterionFields,
        judgementStatements: criterionFields.judgementStatements.map((statement) => {
          if (statement === null || typeof statement !== "object" || Array.isArray(statement)) {
            return statement;
          }
          const statementFields = { ...(statement as Record<string, unknown>) };
          delete statementFields.order;
          return statementFields;
        }),
      };
    }),
  };
}

export function jsonBodyLimitForContext(maximumCharacters: number): number {
  return Math.max(32 * 1024, maximumCharacters * 4 + 8 * 1024);
}

export function jsonBodyLimitForCriteria(
  maximumCriteria: number,
  maximumJudgements: number,
): number {
  const maximumCriterionBytes =
    16 * 1024 + maximumJudgements * (5 * 1024 + 512);
  return Math.max(64 * 1024, maximumCriteria * maximumCriterionBytes + 8 * 1024);
}

function payloadTooLarge(maximumBytes: number): AppError {
  return new AppError(
    "bad_request",
    `The request body exceeds the ${maximumBytes}-byte limit.`,
    { status: 413 },
  );
}
