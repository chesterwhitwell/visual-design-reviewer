import { getRuntimeConfig } from "@/lib/config/runtime";
import { deleteReviewAndFiles } from "@/lib/application/review-deletion";
import { getReviewDetail, updateReview } from "@/lib/application/reviews";
import { privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

import { reviewErrorResponse } from "../_errors";
import {
  assertReviewContextWithinLimit,
  jsonBodyLimitForContext,
  readJsonBody,
} from "../_request";

type RouteContext = { params: Promise<{ reviewId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext) {
  try {
    assertTrustedRequest(request);
    const { reviewId } = await context.params;
    return privateJson({ review: getReviewDetail(reviewId) });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertTrustedRequest(request, true);
    const { reviewId } = await context.params;
    const { limits } = getRuntimeConfig();
    const body = await readJsonBody(request, jsonBodyLimitForContext(limits.contextLength));
    assertReviewContextWithinLimit(body, limits.contextLength);
    updateReview(reviewId, body);
    return privateJson({ review: getReviewDetail(reviewId) });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertTrustedRequest(request, true);
    const { reviewId } = await context.params;
    const body = await readJsonBody(request, 1_024);
    const deleted = await deleteReviewAndFiles(reviewId, body);
    return privateJson({ deleted: true, ...deleted });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
