import { cancelAnalysisRun } from "@/lib/application/analysis";
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
    return privateJson({ run: await cancelAnalysisRun(runId) });
  } catch (error) {
    return errorResponse(error);
  }
}
