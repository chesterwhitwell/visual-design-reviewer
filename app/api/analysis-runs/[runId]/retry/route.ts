import { analysisRunDto, retryAnalysisRun } from "@/lib/application/analysis";
import { kickAnalysisWorker } from "@/lib/analysis/worker";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    assertTrustedRequest(request, true);
    const { runId } = await context.params;
    const run = retryAnalysisRun(runId);
    kickAnalysisWorker();
    return privateJson({ run: analysisRunDto(run) }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
