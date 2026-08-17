import { replaceCriteriaSetFromImport } from "@/lib/application/criteria-sets";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";
import {
  jsonBodyLimitForCriteria,
  readJsonBody,
} from "@/app/api/reviews/_request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ criteriaSetId: string }> };

export async function PUT(request: Request, context: RouteContext) {
  try {
    assertTrustedRequest(request, true);
    const { criteriaSetId } = await context.params;
    const { limits } = getRuntimeConfig();
    const body = await readJsonBody(
      request,
      jsonBodyLimitForCriteria(limits.criteriaCount, limits.judgementsPerCriterion),
    );
    return privateJson({
      criteriaSet: replaceCriteriaSetFromImport(criteriaSetId, body),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
