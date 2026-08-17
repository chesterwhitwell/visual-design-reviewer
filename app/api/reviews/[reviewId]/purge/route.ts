import { purgeReviewImages } from "@/lib/application/images";
import { getReviewDetail } from "@/lib/application/reviews";
import { privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

import { reviewErrorResponse } from "../../_errors";

type RouteContext = { params: Promise<{ reviewId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    assertTrustedRequest(request, true);
    const { reviewId } = await context.params;
    const result = await purgeReviewImages(reviewId);
    return privateJson({ ...result, review: getReviewDetail(reviewId) });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
