import {
  prepareReviewExport,
  renderReviewExportJson,
  renderReviewExportMarkdown,
} from "@/lib/application/exports";
import { AppError } from "@/lib/http/errors";
import { errorResponse } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ reviewId: string; format: string }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertTrustedRequest(request);
    const { reviewId, format } = await context.params;
    if (format !== "json" && format !== "markdown" && format !== "md") {
      throw new AppError("not_found", "The requested export format was not found.");
    }

    const requestUrl = new URL(request.url);
    const prepared = prepareReviewExport(reviewId, {
      designAnalysisId: optionalQueryValue(requestUrl.searchParams, "designAnalysisId"),
      criteriaAnalysisId: optionalQueryValue(requestUrl.searchParams, "criteriaAnalysisId"),
    });
    const isJson = format === "json";
    const extension = isJson ? "json" : "md";
    const body = isJson
      ? renderReviewExportJson(prepared.bundle)
      : renderReviewExportMarkdown(prepared.bundle);

    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${prepared.filenameStem}.${extension}"`,
        "Content-Type": isJson
          ? "application/json; charset=utf-8"
          : "text/markdown; charset=utf-8",
        Expires: "0",
        Pragma: "no-cache",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  }
}

function optionalQueryValue(searchParams: URLSearchParams, name: string): string | undefined {
  const value = searchParams.get(name)?.trim();
  return value || undefined;
}
