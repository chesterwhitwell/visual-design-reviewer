import { runRetentionSweep } from "@/lib/application/retention";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

export async function POST(request: Request) {
  try {
    assertTrustedRequest(request, true);
    const result = await runRetentionSweep({ includeExpired: true });
    return privateJson(result);
  } catch (error) {
    return errorResponse(error);
  }
}
