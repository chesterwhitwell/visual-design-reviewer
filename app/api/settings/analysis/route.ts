import { readJsonBody } from "@/app/api/reviews/_request";
import {
  clearAnalysisModelSettings,
  getEffectiveAnalysisModelSettings,
  saveAnalysisModelSettings,
} from "@/lib/application/analysis-settings";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

const SETTINGS_BODY_BYTES = 2 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    assertTrustedRequest(request, true);
    saveAnalysisModelSettings(await readJsonBody(request, SETTINGS_BODY_BYTES));
    return privateJson({ settings: getEffectiveAnalysisModelSettings() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertTrustedRequest(request, true);
    clearAnalysisModelSettings();
    return privateJson({ settings: getEffectiveAnalysisModelSettings() });
  } catch (error) {
    return errorResponse(error);
  }
}
