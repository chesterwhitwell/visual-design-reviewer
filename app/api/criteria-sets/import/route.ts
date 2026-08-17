import { importCriteriaSet } from "@/lib/application/criteria-sets";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";
import {
  jsonBodyLimitForCriteria,
  readJsonBody,
} from "@/app/api/reviews/_request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedRequest(request, true);
    const { limits } = getRuntimeConfig();
    const body = await readJsonBody(
      request,
      jsonBodyLimitForCriteria(limits.criteriaCount, limits.judgementsPerCriterion),
    );
    return privateJson({ criteriaSet: importCriteriaSet(body) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
