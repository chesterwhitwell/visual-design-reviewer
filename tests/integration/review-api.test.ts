import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GET as listReviews,
  POST as createReview,
} from "@/app/api/reviews/route";
import {
  DELETE as deleteReview,
  GET as getReview,
  PATCH as patchReview,
} from "@/app/api/reviews/[reviewId]/route";
import { PUT as putAreas } from "@/app/api/reviews/[reviewId]/areas/route";
import { PUT as putCriteria } from "@/app/api/reviews/[reviewId]/criteria/route";
import {
  PATCH as reorderImages,
  POST as uploadImages,
} from "@/app/api/reviews/[reviewId]/images/route";
import { DELETE as deleteImage } from "@/app/api/reviews/[reviewId]/images/[imageId]/route";
import { GET as getPreview } from "@/app/api/reviews/[reviewId]/images/[imageId]/preview/route";
import { POST as purgeImages } from "@/app/api/reviews/[reviewId]/purge/route";
import { resetRuntimeConfigForTests } from "@/lib/config/runtime";
import { closeDatabase, createRepositories } from "@/lib/db";
import type { EncryptedImageAssetRecord } from "@/lib/images";
import { resetImageToolsForTests } from "@/lib/application/images";
import { resetTaxonomyConfigForTests } from "@/lib/taxonomy";

type ReviewBody = {
  review: {
    id: string;
    title: string | null;
    context: string | null;
    analysisUsage: {
      totalTokens: number;
      estimatedCostMicroUsd: number;
      meteredAttempts: number;
      unpricedAttempts: number;
    };
    images: Array<{
      id: string;
      order: number;
      analysisRole: "final_work" | "concept_development";
      retentionState: string;
      previewUrl: string | null;
    }>;
    reviewAreas: Array<{ areaId: string; mode: "off" | "review" | "focus" }>;
    criteria: Array<{
      id: string;
      order: number;
      judgementStatements: Array<{ id: string; order: number }>;
    }>;
  };
};

const environmentKeys = [
  "DATABASE_PATH",
  "IMAGE_STORAGE_PATH",
  "IMAGE_ENCRYPTION_KEY",
  "ALLOWED_HOSTS",
  "MAX_IMAGES_PER_REVIEW",
  "MAX_IMAGE_BYTES",
  "MAX_TOTAL_IMAGE_BYTES",
] as const;

describe("review API routes", () => {
  let directory: string;
  let previousEnvironment: Partial<Record<(typeof environmentKeys)[number], string>>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "vdr-review-api-"));
    previousEnvironment = Object.fromEntries(
      environmentKeys.flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]]],
      ),
    );
    process.env.DATABASE_PATH = join(directory, "review-api.sqlite");
    process.env.IMAGE_STORAGE_PATH = join(directory, "encrypted-images");
    process.env.IMAGE_ENCRYPTION_KEY = randomBytes(32).toString("base64url");
    process.env.ALLOWED_HOSTS = "localhost";
    process.env.MAX_IMAGES_PER_REVIEW = "4";
    process.env.MAX_IMAGE_BYTES = String(1024 * 1024);
    process.env.MAX_TOTAL_IMAGE_BYTES = String(4 * 1024 * 1024);
    resetProcessState();
  });

  afterEach(() => {
    resetProcessState();
    for (const key of environmentKeys) {
      const previous = previousEnvironment[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it("enforces same-origin mutations and supports review, area, and criteria editing", async () => {
    const rejected = await createReview(
      jsonRequest("/api/reviews", "POST", { title: "Untrusted" }, false),
    );
    expect(rejected.status).toBe(403);

    const created = await createReview(
      jsonRequest("/api/reviews", "POST", {
        title: "  Campaign poster  ",
        context: "  Public information campaign  ",
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { review: { id: string } };
    const reviewId = createdBody.review.id;

    const list = await listReviews(readRequest("/api/reviews"));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      reviews: [
        {
          id: reviewId,
          title: "Campaign poster",
          imageCount: 0,
          analysisUsage: {
            totalTokens: 0,
            estimatedCostMicroUsd: 0,
            meteredAttempts: 0,
            unpricedAttempts: 0,
          },
        },
      ],
    });
    expect(list.headers.get("cache-control")).toContain("no-store");

    const patched = await patchReview(
      jsonRequest(`/api/reviews/${reviewId}`, "PATCH", {
        title: "Campaign poster v2",
        context: null,
      }),
      reviewContext(reviewId),
    );
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as ReviewBody;
    expect(patchedBody.review).toMatchObject({
      id: reviewId,
      title: "Campaign poster v2",
      context: null,
      analysisUsage: {
        totalTokens: 0,
        estimatedCostMicroUsd: 0,
        meteredAttempts: 0,
        unpricedAttempts: 0,
      },
    });

    const selections = patchedBody.review.reviewAreas.map((selection, index) => ({
      areaId: selection.areaId,
      mode: index === 0 ? ("focus" as const) : index === 1 ? ("off" as const) : selection.mode,
    }));
    const areasResponse = await putAreas(
      jsonRequest(`/api/reviews/${reviewId}/areas`, "PUT", { reviewAreas: selections }),
      reviewContext(reviewId),
    );
    expect(areasResponse.status).toBe(200);
    const areasBody = (await areasResponse.json()) as ReviewBody;
    expect(areasBody.review.reviewAreas.slice(0, 2).map(({ mode }) => mode)).toEqual([
      "focus",
      "off",
    ]);

    const criteriaResponse = await putCriteria(
      jsonRequest(`/api/reviews/${reviewId}/criteria`, "PUT", {
        criteria: [
          {
            id: "criterion-hierarchy",
            title: "Hierarchy",
            statement: "The hierarchy directs attention in the intended order.",
            assessorNote: "Judge only what is visible.",
            order: 9,
            judgementStatements: [
              {
                id: "judgement-met",
                label: "Demonstrated",
                description: "The intended reading order is consistently clear.",
                order: 4,
              },
            ],
          },
        ],
      }),
      reviewContext(reviewId),
    );
    expect(criteriaResponse.status).toBe(200);
    const criteriaBody = (await criteriaResponse.json()) as ReviewBody;
    expect(criteriaBody.review.criteria[0]).toMatchObject({
      id: "criterion-hierarchy",
      order: 0,
      judgementStatements: [{ id: "judgement-met", order: 0 }],
    });

    const missingSelection = await putAreas(
      jsonRequest(`/api/reviews/${reviewId}/areas`, "PUT", {
        reviewAreas: selections.slice(1),
      }),
      reviewContext(reviewId),
    );
    expect(missingSelection.status).toBe(400);
    await expect(missingSelection.json()).resolves.toMatchObject({
      error: { code: "bad_request" },
    });

    const detail = await getReview(
      readRequest(`/api/reviews/${reviewId}`),
      reviewContext(reviewId),
    );
    expect(detail.status).toBe(200);
    expect((await detail.json() as ReviewBody).review.criteria).toHaveLength(1);
  });

  it("sanitises, encrypts, reorders, previews, removes, and purges uploaded images", async () => {
    const created = await createReview(
      jsonRequest("/api/reviews", "POST", { title: "Image review" }),
    );
    const reviewId = ((await created.json()) as { review: { id: string } }).review.id;
    const form = new FormData();
    form.append("images", await imageFile("first.png", { r: 200, g: 20, b: 30 }));
    form.append("images", await imageFile("second.png", { r: 20, g: 80, b: 210 }));

    const uploaded = await uploadImages(
      mutationRequest(`/api/reviews/${reviewId}/images`, "POST", form),
      reviewContext(reviewId),
    );
    expect(uploaded.status).toBe(201);
    const uploadBody = (await uploaded.json()) as ReviewBody;
    expect(uploadBody.review.images).toHaveLength(2);
    expect(uploadBody.review.images.every(({ previewUrl }) => previewUrl !== null)).toBe(true);
    expect(uploadBody.review.images.every(({ analysisRole }) => analysisRole === "final_work")).toBe(true);
    const [first, second] = uploadBody.review.images;

    const reordered = await reorderImages(
      jsonRequest(`/api/reviews/${reviewId}/images`, "PATCH", {
        images: [
          { imageId: second.id, analysisRole: "concept_development" },
          { imageId: first.id, analysisRole: "final_work" },
        ],
      }),
      reviewContext(reviewId),
    );
    expect(reordered.status).toBe(200);
    const reorderBody = (await reordered.json()) as ReviewBody;
    expect(reorderBody.review.images.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(reorderBody.review.images.map(({ analysisRole }) => analysisRole)).toEqual([
      "concept_development",
      "final_work",
    ]);

    const invalidRole = await reorderImages(
      jsonRequest(`/api/reviews/${reviewId}/images`, "PATCH", {
        images: [
          { imageId: second.id, analysisRole: "reference" },
          { imageId: first.id, analysisRole: "final_work" },
        ],
      }),
      reviewContext(reviewId),
    );
    expect(invalidRole.status).toBe(400);

    const preview = await getPreview(
      readRequest(`/api/reviews/${reviewId}/images/${second.id}/preview`),
      imageContext(reviewId, second.id),
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/webp");
    expect(preview.headers.get("cache-control")).toContain("no-store");
    expect((await preview.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const otherReview = await createReview(
      jsonRequest("/api/reviews", "POST", { title: "Other review" }),
    );
    const otherReviewId = ((await otherReview.json()) as { review: { id: string } }).review.id;
    const crossReviewPreview = await getPreview(
      readRequest(`/api/reviews/${otherReviewId}/images/${second.id}/preview`),
      imageContext(otherReviewId, second.id),
    );
    expect(crossReviewPreview.status).toBe(404);

    const removed = await deleteImage(
      mutationRequest(`/api/reviews/${reviewId}/images/${first.id}`, "DELETE"),
      imageContext(reviewId, first.id),
    );
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as ReviewBody).review.images.map(({ id }) => id)).toEqual([
      second.id,
    ]);

    const purged = await purgeImages(
      mutationRequest(`/api/reviews/${reviewId}/purge`, "POST"),
      reviewContext(reviewId),
    );
    expect(purged.status).toBe(200);
    const purgeBody = (await purged.json()) as ReviewBody & { purged: number };
    expect(purgeBody.purged).toBe(2);
    expect(purgeBody.review.images[0]).toMatchObject({
      id: second.id,
      retentionState: "purged",
      previewUrl: null,
    });

    const purgedPreview = await getPreview(
      readRequest(`/api/reviews/${reviewId}/images/${second.id}/preview`),
      imageContext(reviewId, second.id),
    );
    expect(purgedPreview.status).toBe(409);
    await expect(purgedPreview.json()).resolves.toMatchObject({
      error: { code: "image_missing" },
    });
  });

  it("requires typed confirmation and deletes the review, history, and encrypted files", async () => {
    const created = await createReview(
      jsonRequest("/api/reviews", "POST", { title: "Disposable review" }),
    );
    const reviewId = ((await created.json()) as { review: { id: string } }).review.id;
    const form = new FormData();
    form.append("images", await imageFile("delete-me.png", { r: 60, g: 120, b: 180 }));
    const uploaded = await uploadImages(
      mutationRequest(`/api/reviews/${reviewId}/images`, "POST", form),
      reviewContext(reviewId),
    );
    expect(uploaded.status).toBe(201);

    const repositories = createRepositories();
    const revision = repositories.reviews.getLatestImageRevision(reviewId);
    const image = repositories.reviews.listImageAssets(reviewId)[0];
    const stored = JSON.parse(image.storageLocator ?? "null") as EncryptedImageAssetRecord;
    const storageDirectory = process.env.IMAGE_STORAGE_PATH as string;
    expect(existsSync(join(storageDirectory, stored.analysis.locator))).toBe(true);
    expect(existsSync(join(storageDirectory, stored.preview.locator))).toBe(true);

    const run = repositories.analysisRuns.create({
      id: "queued-delete-guard",
      reviewId,
      kind: "design",
      imageRevisionId: revision?.id ?? "missing",
      inputSnapshot: { images: [{ id: image.id }] },
      passes: [{ id: "queued-delete-pass", key: "D1", position: 0 }],
    });

    const unconfirmed = await deleteReview(
      jsonRequest(`/api/reviews/${reviewId}`, "DELETE", { confirmation: "delete" }),
      reviewContext(reviewId),
    );
    expect(unconfirmed.status).toBe(400);

    const blocked = await deleteReview(
      jsonRequest(`/api/reviews/${reviewId}`, "DELETE", { confirmation: "DELETE" }),
      reviewContext(reviewId),
    );
    expect(blocked.status).toBe(409);
    expect(repositories.reviews.requireById(reviewId).lifecycle).toBe("active");
    repositories.analysisRuns.requestCancellation(run.id);

    const deleted = await deleteReview(
      jsonRequest(`/api/reviews/${reviewId}`, "DELETE", { confirmation: "DELETE" }),
      reviewContext(reviewId),
    );
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({
      deleted: true,
      reviewId,
      deletedImages: 1,
    });
    expect(existsSync(join(storageDirectory, stored.analysis.locator))).toBe(false);
    expect(existsSync(join(storageDirectory, stored.preview.locator))).toBe(false);
    expect(repositories.reviews.getById(reviewId)).toBeNull();
    expect(repositories.analysisRuns.getById(run.id)).toBeNull();

    const missing = await getReview(
      readRequest(`/api/reviews/${reviewId}`),
      reviewContext(reviewId),
    );
    expect(missing.status).toBe(404);
  });

  it("rejects malformed, oversized, and incomplete request bodies safely", async () => {
    const malformed = await createReview(
      mutationRequest("/api/reviews", "POST", "{", {
        "Content-Type": "application/json",
      }),
    );
    expect(malformed.status).toBe(400);

    const oversized = await createReview(
      mutationRequest("/api/reviews", "POST", JSON.stringify({ title: "Review" }), {
        "Content-Type": "application/json",
        "Content-Length": "999999999",
      }),
    );
    expect(oversized.status).toBe(413);

    const wrongMediaType = await createReview(
      mutationRequest("/api/reviews", "POST", "title=Review", {
        "Content-Type": "text/plain",
      }),
    );
    expect(wrongMediaType.status).toBe(415);
  });
});

function resetProcessState() {
  closeDatabase();
  resetRuntimeConfigForTests();
  resetImageToolsForTests();
  resetTaxonomyConfigForTests();
}

function readRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: { Host: "localhost" },
  });
}

function jsonRequest(path: string, method: string, body: unknown, trusted = true): Request {
  return mutationRequest(path, method, JSON.stringify(body), {
    "Content-Type": "application/json",
    ...(trusted ? {} : { "X-VDR-Request": "" }),
  }, trusted);
}

function mutationRequest(
  path: string,
  method: string,
  body?: BodyInit,
  extraHeaders: Record<string, string> = {},
  trusted = true,
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      Host: "localhost",
      Origin: "http://localhost",
      ...(trusted ? { "X-VDR-Request": "1" } : {}),
      ...extraHeaders,
    },
    body,
  });
}

function reviewContext(reviewId: string) {
  return { params: Promise.resolve({ reviewId }) };
}

function imageContext(reviewId: string, imageId: string) {
  return { params: Promise.resolve({ reviewId, imageId }) };
}

async function imageFile(
  name: string,
  background: { r: number; g: number; b: number },
): Promise<File> {
  const bytes = await sharp({
    create: { width: 20, height: 12, channels: 3, background },
  })
    .png()
    .toBuffer();
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}
