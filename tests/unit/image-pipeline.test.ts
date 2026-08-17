import { createHash } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  assertImageBatchWithinLimits,
  ImagePipelineError,
  SharpImageProcessor,
  wipeProcessedImage,
  type ImageProcessingLimits,
} from "@/lib/images";

const LIMITS: ImageProcessingLimits = {
  maxInputBytes: 1024 * 1024,
  maxPixels: 1_000_000,
  maxWidth: 1_000,
  maxHeight: 1_000,
  maxSanitizedBytes: 2 * 1024 * 1024,
  previewMaxWidth: 32,
  previewMaxHeight: 32,
  maxPreviewBytes: 256 * 1024,
};

async function tinyImage(
  format: "jpeg" | "png" | "webp",
  width = 8,
  height = 6,
): Promise<Buffer> {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 32, g: 96, b: 192, alpha: 0.8 },
    },
  });

  switch (format) {
    case "jpeg":
      return pipeline.jpeg().toBuffer();
    case "png":
      return pipeline.png().toBuffer();
    case "webp":
      return pipeline.webp().toBuffer();
  }
}

function expectImageError(code: string) {
  return expect.objectContaining({
    name: "ImagePipelineError",
    code,
    retryable: false,
  });
}

function fakeAnimatedWebp(): Buffer {
  const animationChunk = Buffer.alloc(14);
  animationChunk.write("ANIM", 0, "ascii");
  animationChunk.writeUInt32LE(6, 4);

  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), animationChunk]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.byteLength, 4);
  return Buffer.concat([header, body]);
}

describe("SharpImageProcessor", () => {
  it.each([
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
  ] as const)("decodes and sanitises %s by actual content", async (format, mimeType) => {
    const input = await tinyImage(format);
    const result = await new SharpImageProcessor(LIMITS).process({
      bytes: input,
      declaredMimeType: mimeType,
    });

    expect(result.mimeType).toBe(mimeType);
    expect(result.width).toBe(8);
    expect(result.height).toBe(6);
    expect(result.byteLength).toBe(result.bytes.byteLength);
    expect(result.sha256).toBe(
      createHash("sha256").update(result.bytes).digest("hex"),
    );
    expect(result.preview.mimeType).toBe("image/webp");
    expect(result.preview.width).toBeLessThanOrEqual(32);
    expect(result.preview.height).toBeLessThanOrEqual(32);

    const decoded = await sharp(result.bytes).metadata();
    const preview = await sharp(result.preview.bytes).metadata();
    expect(decoded.format).toBe(format);
    expect(preview.format).toBe("webp");
  });

  it("normalises EXIF orientation and strips metadata", async () => {
    const input = await sharp({
      create: {
        width: 12,
        height: 5,
        channels: 3,
        background: { r: 220, g: 30, b: 40 },
      },
    })
      .jpeg()
      .withMetadata({
        orientation: 6,
        exif: { IFD0: { Software: "private-test-marker" } },
      })
      .toBuffer();
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif).toBeDefined();

    const result = await new SharpImageProcessor(LIMITS).process({ bytes: input });
    const after = await sharp(result.bytes).metadata();
    const preview = await sharp(result.preview.bytes).metadata();

    expect([result.width, result.height]).toEqual([5, 12]);
    expect(after.orientation).toBeUndefined();
    expect(after.exif).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(preview.exif).toBeUndefined();
    expect(result.bytes.includes(Buffer.from("private-test-marker"))).toBe(false);
  });

  it("rejects a lying transport MIME type", async () => {
    const input = await tinyImage("jpeg");
    await expect(
      new SharpImageProcessor(LIMITS).process({
        bytes: input,
        declaredMimeType: "image/png",
      }),
    ).rejects.toEqual(expectImageError("type_mismatch"));
  });

  it("rejects unsupported and corrupt inputs without exposing decoder details", async () => {
    const processor = new SharpImageProcessor(LIMITS);

    await expect(
      processor.process({ bytes: Buffer.from("<svg></svg>") }),
    ).rejects.toEqual(expectImageError("unsupported_type"));
    await expect(
      processor.process({ bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }),
    ).rejects.toEqual(expectImageError("corrupt_image"));
  });

  it("rejects animated WebP before decode", async () => {
    await expect(
      new SharpImageProcessor(LIMITS).process({ bytes: fakeAnimatedWebp() }),
    ).rejects.toEqual(expectImageError("animated_image"));
  });

  it("rejects trailing polyglot data", async () => {
    const png = await tinyImage("png");
    const polyglot = Buffer.concat([png, Buffer.from("<script>alert(1)</script>")]);

    await expect(
      new SharpImageProcessor(LIMITS).process({ bytes: polyglot }),
    ).rejects.toEqual(expectImageError("malformed_image"));
  });

  it("enforces input, pixel, dimension, and output bounds", async () => {
    const input = await tinyImage("png", 20, 10);

    await expect(
      new SharpImageProcessor({ ...LIMITS, maxInputBytes: input.byteLength - 1 }).process({
        bytes: input,
      }),
    ).rejects.toEqual(expectImageError("input_too_large"));

    await expect(
      new SharpImageProcessor({ ...LIMITS, maxPixels: 199 }).process({ bytes: input }),
    ).rejects.toEqual(expectImageError("pixel_limit_exceeded"));

    await expect(
      new SharpImageProcessor({ ...LIMITS, maxWidth: 19 }).process({ bytes: input }),
    ).rejects.toEqual(expectImageError("dimension_limit_exceeded"));

    await expect(
      new SharpImageProcessor({ ...LIMITS, maxSanitizedBytes: 1 }).process({
        bytes: input,
      }),
    ).rejects.toEqual(expectImageError("sanitized_too_large"));
  });

  it("requires explicit, valid limits", () => {
    expect(
      () => new SharpImageProcessor({ ...LIMITS, maxPixels: 0 }),
    ).toThrowError(expectImageError("invalid_limits"));
  });

  it("can wipe caller-owned plaintext variants after their final use", async () => {
    const result = await new SharpImageProcessor(LIMITS).process({
      bytes: await tinyImage("png"),
    });

    wipeProcessedImage(result);

    expect(result.bytes.every((byte) => byte === 0)).toBe(true);
    expect(result.preview.bytes.every((byte) => byte === 0)).toBe(true);
  });
});

describe("image batch limits", () => {
  it("bounds image count and aggregate compressed bytes", () => {
    const images = [
      { bytes: Buffer.alloc(5) },
      { bytes: Buffer.alloc(7) },
    ];

    expect(() =>
      assertImageBatchWithinLimits(images, { maxImages: 1, maxTotalBytes: 20 }),
    ).toThrowError(expectImageError("too_many_images"));
    expect(() =>
      assertImageBatchWithinLimits(images, { maxImages: 2, maxTotalBytes: 11 }),
    ).toThrowError(expectImageError("aggregate_too_large"));
    expect(() =>
      assertImageBatchWithinLimits(images, { maxImages: 2, maxTotalBytes: 12 }),
    ).not.toThrow();
  });

  it("uses stable safe errors", () => {
    const error = new ImagePipelineError("unsupported_type");
    expect(error.message).not.toContain("path");
    expect(error).toEqual(expectImageError("unsupported_type"));
  });
});
