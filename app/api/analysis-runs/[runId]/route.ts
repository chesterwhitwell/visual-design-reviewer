import { getAnalysisRunPayload } from "@/lib/application/analysis";
import { kickAnalysisWorker } from "@/lib/analysis/worker";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    assertTrustedRequest(request);
    const { runId } = await context.params;
    kickAnalysisWorker();
    return privateJson(getAnalysisRunPayload(runId));
  } catch (error) {
    return errorResponse(error);
  }
}
