import {
  deleteCriteriaSet,
  getCriteriaSet,
  updateCriteriaSet,
} from "@/lib/application/criteria-sets";
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

export async function GET(request: Request, context: RouteContext) {
  try {
    assertTrustedRequest(request);
    const { criteriaSetId } = await context.params;
    return privateJson({ criteriaSet: getCriteriaSet(criteriaSetId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    assertTrustedRequest(request, true);
    const { criteriaSetId } = await context.params;
    const { limits } = getRuntimeConfig();
    const body = await readJsonBody(
      request,
      jsonBodyLimitForCriteria(limits.criteriaCount, limits.judgementsPerCriterion),
    );
    return privateJson({ criteriaSet: updateCriteriaSet(criteriaSetId, body) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertTrustedRequest(request, true);
    const { criteriaSetId } = await context.params;
    deleteCriteriaSet(criteriaSetId);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
