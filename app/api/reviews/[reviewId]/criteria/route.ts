import { getReviewDetail, saveCriteria } from "@/lib/application/reviews";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

import { reviewErrorResponse } from "../../_errors";
import {
  assertCriteriaCountsWithinLimits,
  jsonBodyLimitForCriteria,
  omitClientCriteriaOrder,
  readJsonBody,
} from "../../_request";

type RouteContext = { params: Promise<{ reviewId: string }> };

export async function PUT(request: Request, context: RouteContext) {
  try {
    assertTrustedRequest(request, true);
    const { reviewId } = await context.params;
    const { limits } = getRuntimeConfig();
    const body = await readJsonBody(
      request,
      jsonBodyLimitForCriteria(limits.criteriaCount, limits.judgementsPerCriterion),
    );
    assertCriteriaCountsWithinLimits(
      body,
      limits.criteriaCount,
      limits.judgementsPerCriterion,
    );
    saveCriteria(reviewId, omitClientCriteriaOrder(body));
    return privateJson({ review: getReviewDetail(reviewId) });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
