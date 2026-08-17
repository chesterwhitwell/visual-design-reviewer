import { removeImageFromReview } from "@/lib/application/images";
import { getReviewDetail } from "@/lib/application/reviews";
import { privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

import { reviewErrorResponse } from "../../../_errors";

type RouteContext = {
  params: Promise<{ reviewId: string; imageId: string }>;
};

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertTrustedRequest(request, true);
    const { reviewId, imageId } = await context.params;
    removeImageFromReview(reviewId, imageId);
    return privateJson({ review: getReviewDetail(reviewId) });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
