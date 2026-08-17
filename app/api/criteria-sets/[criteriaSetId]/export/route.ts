import { prepareCriteriaSetExport } from "@/lib/application/criteria-sets";
import { errorResponse } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ criteriaSetId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertTrustedRequest(request);
    const { criteriaSetId } = await context.params;
    const prepared = prepareCriteriaSetExport(criteriaSetId);
    return new Response(`${JSON.stringify(prepared.document, null, 2)}\n`, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${prepared.filename}"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
