import { getAdminOverview } from "@/lib/application/admin";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

export async function GET(request: Request) {
  try {
    assertTrustedRequest(request);
    const diagnostics = getAdminOverview(request);
    const response = privateJson({
      format: "visual-design-reviewer.diagnostics",
      schemaVersion: "1.0.0",
      diagnostics: {
        ...diagnostics,
        database: { ...diagnostics.database, path: "[redacted]" },
        storage: { ...diagnostics.storage, path: "[redacted]" },
      },
    });
    response.headers.set(
      "Content-Disposition",
      `attachment; filename="visual-design-reviewer-diagnostics-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
