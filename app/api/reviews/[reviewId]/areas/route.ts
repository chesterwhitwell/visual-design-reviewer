import { getReviewDetail, saveReviewAreas } from "@/lib/application/reviews";
import { privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

import { reviewErrorResponse } from "../../_errors";
import { readJsonBody } from "../../_request";

type RouteContext = { params: Promise<{ reviewId: string }> };

const REVIEW_AREAS_BODY_BYTES = 128 * 1024;

export async function PUT(request: Request, context: RouteContext) {
  try {
    assertTrustedRequest(request, true);
    const { reviewId } = await context.params;
    const body = await readJsonBody(request, REVIEW_AREAS_BODY_BYTES);
    saveReviewAreas(reviewId, body);
    return privateJson({ review: getReviewDetail(reviewId) });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
