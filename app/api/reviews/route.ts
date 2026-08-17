import { getRuntimeConfig } from "@/lib/config/runtime";
import { createReview, listReviewSummaries } from "@/lib/application/reviews";
import { privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

import { reviewErrorResponse } from "./_errors";
import {
  assertReviewContextWithinLimit,
  jsonBodyLimitForContext,
  readJsonBody,
} from "./_request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertTrustedRequest(request);
    return privateJson({ reviews: listReviewSummaries() });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedRequest(request, true);
    const { limits } = getRuntimeConfig();
    const body = await readJsonBody(request, jsonBodyLimitForContext(limits.contextLength));
    assertReviewContextWithinLimit(body, limits.contextLength);
    const review = createReview(body);
    return privateJson({ review }, { status: 201 });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
