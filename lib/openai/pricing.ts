import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import { getRuntimeConfig } from "@/lib/config/runtime";

const ratesSchema = z.object({
  input: z.number().int().nonnegative(),
  cachedInput: z.number().int().nonnegative(),
  cacheWriteInput: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
}).strict();

const modelPriceSchema = z.object({
  id: z.string().trim().min(1).max(200),
  matches: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  source: z.string().url(),
  effectiveFrom: z.iso.date(),
  ratesMicroUsdPerMillion: ratesSchema,
  longContext: z.object({
    inputTokenThreshold: z.number().int().positive(),
    inputMultiplierBasisPoints: z.number().int().min(10_000).max(100_000),
    outputMultiplierBasisPoints: z.number().int().min(10_000).max(100_000),
  }).strict().optional(),
}).strict();

export const PricingCatalogSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  catalogVersion: z.string().trim().min(1).max(64),
  currency: z.literal("USD"),
  models: z.array(modelPriceSchema).min(1).max(100),
}).strict();

export type PricingCatalog = z.infer<typeof PricingCatalogSchema>;
export type PricingSnapshot = {
  schemaVersion: "1.0.0";
  catalogVersion: string;
  currency: "USD";
  modelPriceId: string;
  source: string;
  effectiveFrom: string;
  ratesMicroUsdPerMillion: z.infer<typeof ratesSchema>;
  inputMultiplierBasisPoints: number;
  outputMultiplierBasisPoints: number;
};

export type BillableTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type CostEstimate = {
  estimatedCostMicroUsd: number;
  pricingSnapshot: PricingSnapshot;
};

let cachedCatalog: PricingCatalog | undefined;

export function getPricingCatalog(): PricingCatalog {
  if (!cachedCatalog) {
    const path = resolve(getRuntimeConfig().openaiPricingPath);
    cachedCatalog = PricingCatalogSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  }
  return cachedCatalog;
}

export function estimateOpenAICost(
  model: string,
  usage: BillableTokenUsage,
  catalog = getPricingCatalog(),
): CostEstimate | null {
  const price = catalog.models.find(({ matches }) =>
    matches.some((pattern) => modelMatches(model, pattern)),
  );
  if (!price) return null;

  const longContext = price.longContext && usage.inputTokens > price.longContext.inputTokenThreshold;
  const inputMultiplierBasisPoints = longContext
    ? price.longContext?.inputMultiplierBasisPoints ?? 10_000
    : 10_000;
  const outputMultiplierBasisPoints = longContext
    ? price.longContext?.outputMultiplierBasisPoints ?? 10_000
    : 10_000;
  const ordinaryInputTokens = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteInputTokens,
  );
  const rates = price.ratesMicroUsdPerMillion;
  const estimatedCostMicroUsd =
    pricedTokens(ordinaryInputTokens, rates.input, inputMultiplierBasisPoints) +
    pricedTokens(usage.cachedInputTokens, rates.cachedInput, inputMultiplierBasisPoints) +
    pricedTokens(usage.cacheWriteInputTokens, rates.cacheWriteInput, inputMultiplierBasisPoints) +
    pricedTokens(usage.outputTokens, rates.output, outputMultiplierBasisPoints);

  return {
    estimatedCostMicroUsd,
    pricingSnapshot: {
      schemaVersion: "1.0.0",
      catalogVersion: catalog.catalogVersion,
      currency: catalog.currency,
      modelPriceId: price.id,
      source: price.source,
      effectiveFrom: price.effectiveFrom,
      ratesMicroUsdPerMillion: rates,
      inputMultiplierBasisPoints,
      outputMultiplierBasisPoints,
    },
  };
}

export function resetPricingCatalogForTests(): void {
  cachedCatalog = undefined;
}

function modelMatches(model: string, pattern: string): boolean {
  return pattern.endsWith("*") ? model.startsWith(pattern.slice(0, -1)) : model === pattern;
}

function pricedTokens(tokens: number, rateMicroUsdPerMillion: number, multiplier: number): number {
  const numerator = BigInt(tokens) * BigInt(rateMicroUsdPerMillion) * BigInt(multiplier);
  const denominator = 1_000_000n * 10_000n;
  return Number((numerator + denominator / 2n) / denominator);
}
