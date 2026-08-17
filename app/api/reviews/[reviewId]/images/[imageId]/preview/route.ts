import { readPreview } from "@/lib/application/images";
import { getReviewDetail } from "@/lib/application/reviews";
import { AppError } from "@/lib/http/errors";
import { assertTrustedRequest } from "@/lib/security/request";

import { reviewErrorResponse } from "../../../../_errors";

type RouteContext = {
  params: Promise<{ reviewId: string; imageId: string }>;
};

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext) {
  try {
    assertTrustedRequest(request);
    const { reviewId, imageId } = await context.params;
    const review = getReviewDetail(reviewId);
    if (!review.images.some((image) => image.id === imageId)) {
      throw new AppError("not_found", "The image is not part of the current review.");
    }
    const preview = await readPreview(imageId);
    return new Response(new Uint8Array(preview.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        Pragma: "no-cache",
        "Content-Type": preview.mimeType,
        "Content-Length": String(preview.bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
