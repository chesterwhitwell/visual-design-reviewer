import { z } from "zod";

import { analysisRunDto, enqueueCriteriaAnalysis } from "@/lib/application/analysis";
import { kickAnalysisWorker } from "@/lib/analysis/worker";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";
import { readJsonBody } from "@/app/api/reviews/_request";

const bodySchema = z
  .object({
    designAnalysisId: z.string().trim().min(1).max(128),
  })
  .strict();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ reviewId: string }> },
) {
  try {
    assertTrustedRequest(request, true);
    const { reviewId } = await context.params;
    const body = bodySchema.parse(await readJsonBody(request, 8 * 1024));
    const run = enqueueCriteriaAnalysis(reviewId, body.designAnalysisId, {
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    kickAnalysisWorker();
    return privateJson({ run: analysisRunDto(run) }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
