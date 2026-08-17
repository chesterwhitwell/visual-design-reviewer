import { describe, expect, it } from "vitest";

import { decodeSessionCookie, encodeSessionCookie } from "@/lib/auth/cookie";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { estimateOpenAICost, PricingCatalogSchema } from "@/lib/openai/pricing";

describe("authentication and pricing primitives", () => {
  it("hashes passwords with a salted scrypt format and verifies without retaining plaintext", async () => {
    const encoded = await hashPassword("a deliberately long password");
    expect(encoded).toMatch(/^scrypt-v1:/);
    expect(encoded).not.toContain("deliberately");
    await expect(verifyPassword("a deliberately long password", encoded)).resolves.toBe(true);
    await expect(verifyPassword("the wrong password", encoded)).resolves.toBe(false);
    await expect(verifyPassword("a deliberately long password", "not-a-hash")).resolves.toBe(false);
  });

  it("signs session cookies and rejects tampering", () => {
    const cookie = encodeSessionCookie("session-id", "a sufficiently random test secret");
    expect(decodeSessionCookie(cookie, "a sufficiently random test secret")).toBe("session-id");
    expect(decodeSessionCookie(`${cookie}changed`, "a sufficiently random test secret")).toBeNull();
    expect(decodeSessionCookie(cookie, "another secret")).toBeNull();
  });

  it("prices ordinary, cached, cache-write, and output tokens without double billing reasoning", () => {
    const catalog = PricingCatalogSchema.parse({
      schemaVersion: "1.0.0",
      catalogVersion: "test-v1",
      currency: "USD",
      models: [{
        id: "test-model",
        matches: ["test-model"],
        source: "https://developers.openai.com/api/docs/models",
        effectiveFrom: "2026-08-17",
        ratesMicroUsdPerMillion: {
          input: 2_000_000,
          cachedInput: 200_000,
          cacheWriteInput: 2_500_000,
          output: 12_000_000,
        },
      }],
    });
    const estimate = estimateOpenAICost("test-model", {
      inputTokens: 1_000_000,
      cachedInputTokens: 100_000,
      cacheWriteInputTokens: 100_000,
      outputTokens: 200_000,
      reasoningOutputTokens: 150_000,
      totalTokens: 1_200_000,
    }, catalog);

    expect(estimate?.estimatedCostMicroUsd).toBe(4_270_000);
    expect(estimate?.pricingSnapshot.catalogVersion).toBe("test-v1");
    expect(estimateOpenAICost("unknown", {
      inputTokens: 1,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 1,
      reasoningOutputTokens: 0,
      totalTokens: 2,
    }, catalog)).toBeNull();
  });
});
