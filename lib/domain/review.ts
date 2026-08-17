import { z } from "zod";

import {
  ApplicationIdSchema,
  ImageMimeTypeSchema,
  IsoDateTimeSchema,
  NonNegativeOrderSchema,
  PositiveVersionSchema,
  Sha256DigestSchema,
  ShortTextSchema,
  addContiguousOrderIssues,
  addDuplicateIssues,
} from "./common";
import { CriterionSchema } from "./criteria";
import { ReviewAreaSelectionSchema } from "./taxonomy";

export const ReviewLifecycleSchema = z.enum(["active", "closed"]);
export const ImageAssetStateSchema = z.enum([
  "available",
  "purge_pending",
  "purged",
]);
export const ImageAnalysisRoleSchema = z.enum([
  "final_work",
  "concept_development",
]);

export const ReviewImageSchema = z
  .object({
    id: ApplicationIdSchema,
    displayName: ShortTextSchema,
    mimeType: ImageMimeTypeSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    byteSize: z.number().int().positive(),
    sanitizedDigest: Sha256DigestSchema,
    order: NonNegativeOrderSchema,
    analysisRole: ImageAnalysisRoleSchema.default("final_work"),
    state: ImageAssetStateSchema,
    retainedLocally: z.boolean(),
    expiresAt: IsoDateTimeSchema.optional(),
    purgedAt: IsoDateTimeSchema.optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((image, context) => {
    if (image.state === "purged" && image.purgedAt === undefined) {
      context.addIssue({
        code: "custom",
        message: "purgedAt is required for a purged image",
        path: ["purgedAt"],
      });
    }
    if (image.state !== "purged" && image.purgedAt !== undefined) {
      context.addIssue({
        code: "custom",
        message: "purgedAt is only valid for a purged image",
        path: ["purgedAt"],
      });
    }
    if (image.state === "purged" && image.retainedLocally) {
      context.addIssue({
        code: "custom",
        message: "a purged image cannot be retained locally",
        path: ["retainedLocally"],
      });
    }
  });

export const ImageManifestItemSchema = z
  .object({
    imageId: ApplicationIdSchema,
    order: NonNegativeOrderSchema,
    sanitizedDigest: Sha256DigestSchema,
    mimeType: ImageMimeTypeSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    byteSize: z.number().int().positive(),
    // The default keeps completed artifacts created before role tagging readable.
    analysisRole: ImageAnalysisRoleSchema.default("final_work"),
  })
  .strict();

export const ImageManifestSchema = z
  .array(ImageManifestItemSchema)
  .min(1)
  .max(20)
  .superRefine((images, context) => {
    addDuplicateIssues(
      images.map(({ imageId }) => imageId),
      context,
      [],
      "image IDs",
    );
    addDuplicateIssues(
      images.map(({ order }) => order),
      context,
      [],
      "image order",
    );
    addContiguousOrderIssues(
      images.map(({ order }) => order),
      context,
      [],
      "image order",
    );
  });

export const ReviewImageRevisionSchema = z
  .object({
    id: ApplicationIdSchema,
    reviewId: ApplicationIdSchema,
    version: PositiveVersionSchema,
    images: ImageManifestSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const ReviewSchema = z
  .object({
    id: ApplicationIdSchema,
    title: ShortTextSchema.optional(),
    context: z.string().trim().min(1).max(20_000).optional(),
    lifecycle: ReviewLifecycleSchema,
    currentImageRevisionId: ApplicationIdSchema.optional(),
    images: z.array(ReviewImageSchema).max(20),
    reviewAreas: z.array(ReviewAreaSelectionSchema).max(256),
    criteria: z.array(CriterionSchema).max(50),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    closedAt: IsoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((review, context) => {
    addDuplicateIssues(
      review.images.map(({ id }) => id),
      context,
      ["images"],
      "image IDs",
    );
    addDuplicateIssues(
      review.images.map(({ order }) => order),
      context,
      ["images"],
      "image order",
    );
    if (review.images.length > 0) {
      addContiguousOrderIssues(
        review.images.map(({ order }) => order),
        context,
        ["images"],
        "image order",
      );
    }
    addDuplicateIssues(
      review.reviewAreas.map(({ areaId }) => areaId),
      context,
      ["reviewAreas"],
      "review-area selections",
    );
    addDuplicateIssues(
      review.criteria.map(({ id }) => id),
      context,
      ["criteria"],
      "criterion IDs",
    );
    addDuplicateIssues(
      review.criteria.map(({ order }) => order),
      context,
      ["criteria"],
      "criterion order",
    );
    if (review.criteria.length > 0) {
      addContiguousOrderIssues(
        review.criteria.map(({ order }) => order),
        context,
        ["criteria"],
        "criterion order",
      );
    }

    if (review.lifecycle === "closed" && review.closedAt === undefined) {
      context.addIssue({
        code: "custom",
        message: "closedAt is required for a closed review",
        path: ["closedAt"],
      });
    }
    if (review.lifecycle === "active" && review.closedAt !== undefined) {
      context.addIssue({
        code: "custom",
        message: "closedAt is only valid for a closed review",
        path: ["closedAt"],
      });
    }
  });

export type ReviewLifecycle = z.infer<typeof ReviewLifecycleSchema>;
export type ImageAssetState = z.infer<typeof ImageAssetStateSchema>;
export type ImageAnalysisRole = z.infer<typeof ImageAnalysisRoleSchema>;
export type ReviewImage = z.infer<typeof ReviewImageSchema>;
export type ImageManifestItem = z.infer<typeof ImageManifestItemSchema>;
export type ReviewImageRevision = z.infer<typeof ReviewImageRevisionSchema>;
export type Review = z.infer<typeof ReviewSchema>;
