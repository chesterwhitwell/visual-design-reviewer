import { getAdminOverview } from "@/lib/application/admin";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertTrustedRequest(request);
    return privateJson(getAdminOverview(request));
  } catch (error) {
    return errorResponse(error);
  }
}
