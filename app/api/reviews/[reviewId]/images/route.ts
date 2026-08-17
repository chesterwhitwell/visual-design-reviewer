import { z } from "zod";

import {
  addImagesToReview,
  replaceImageManifest,
  replaceImageOrder,
} from "@/lib/application/images";
import { getReviewDetail } from "@/lib/application/reviews";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { ApplicationIdSchema, ImageAnalysisRoleSchema } from "@/lib/domain";
import { AppError } from "@/lib/http/errors";
import { privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

import { reviewErrorResponse } from "../../_errors";
import {
  assertContentLengthWithinLimit,
  assertMultipartRequest,
  readJsonBody,
} from "../../_request";

type RouteContext = { params: Promise<{ reviewId: string }> };

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const IMAGE_ORDER_BODY_BYTES = 32 * 1024;

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext) {
  const allocatedBuffers: Buffer[] = [];
  try {
    assertTrustedRequest(request, true);
    assertMultipartRequest(request);
    const { reviewId } = await context.params;
    const { limits } = getRuntimeConfig();
    assertContentLengthWithinLimit(
      request,
      limits.totalImageBytes + MULTIPART_OVERHEAD_BYTES,
    );

    const formData = await request.formData().catch((error) => {
      throw new AppError("bad_request", "The multipart image upload is malformed.", {
        cause: error,
      });
    });
    const entries = [...formData.entries()];
    if (entries.some(([name]) => name !== "images")) {
      throw new AppError(
        "bad_request",
        'Image uploads may contain only repeated fields named "images".',
      );
    }
    const files = entries.map(([, value]) => value);
    if (files.length === 0 || files.some((value) => !(value instanceof File))) {
      throw new AppError(
        "image_invalid",
        'Upload at least one image using the multipart field "images".',
      );
    }
    if (files.length > limits.imagesPerReview) {
      throw new AppError(
        "image_invalid",
        `A review can contain at most ${limits.imagesPerReview} images.`,
      );
    }

    const typedFiles = files as File[];
    let uploadedBytes = 0;
    for (const file of typedFiles) {
      if (file.size <= 0) {
        throw new AppError("image_invalid", "Empty image files are not accepted.");
      }
      if (file.size > limits.imageBytes) {
        throw new AppError(
          "image_invalid",
          `Each image must be no larger than ${limits.imageBytes} bytes.`,
        );
      }
      uploadedBytes += file.size;
    }
    if (uploadedBytes > limits.totalImageBytes) {
      throw new AppError(
        "image_invalid",
        `The image batch must be no larger than ${limits.totalImageBytes} bytes.`,
      );
    }

    const currentReview = getReviewDetail(reviewId);
    if (currentReview.images.length + typedFiles.length > limits.imagesPerReview) {
      throw new AppError(
        "image_invalid",
        `A review can contain at most ${limits.imagesPerReview} images.`,
      );
    }
    const currentBytes = currentReview.images.reduce(
      (total, image) => total + image.byteSize,
      0,
    );
    if (currentBytes + uploadedBytes > limits.totalImageBytes) {
      throw new AppError(
        "image_invalid",
        `All images in a review must total no more than ${limits.totalImageBytes} bytes.`,
      );
    }

    const uploads = [];
    for (const file of typedFiles) {
      const bytes = Buffer.from(await file.arrayBuffer());
      allocatedBuffers.push(bytes);
      uploads.push({
        bytes,
        declaredMimeType: file.type || null,
        displayName: file.name,
      });
    }

    await addImagesToReview(reviewId, uploads);
    return privateJson({ review: getReviewDetail(reviewId) }, { status: 201 });
  } catch (error) {
    return reviewErrorResponse(error);
  } finally {
    for (const bytes of allocatedBuffers) bytes.fill(0);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertTrustedRequest(request, true);
    const { reviewId } = await context.params;
    const { limits } = getRuntimeConfig();
    const body = await readJsonBody(request, IMAGE_ORDER_BODY_BYTES);
    const parsed = z
      .union([
        z.object({
          images: z
            .array(z.object({
              imageId: ApplicationIdSchema,
              analysisRole: ImageAnalysisRoleSchema,
            }).strict())
            .max(limits.imagesPerReview),
        }).strict(),
        z.object({
        imageIds: z.array(ApplicationIdSchema).max(limits.imagesPerReview),
        }).strict(),
      ])
      .parse(body);
    if ("images" in parsed) replaceImageManifest(reviewId, parsed.images);
    else replaceImageOrder(reviewId, parsed.imageIds);
    return privateJson({ review: getReviewDetail(reviewId) });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
