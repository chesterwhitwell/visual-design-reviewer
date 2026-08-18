import { runDatabaseQuickCheck } from "@/lib/application/admin";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

export async function POST(request: Request) {
  try {
    assertTrustedRequest(request, true);
    return privateJson(runDatabaseQuickCheck());
  } catch (error) {
    return errorResponse(error);
  }
}
