import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { TaxonomyConfigSchema, type TaxonomyConfig } from "@/lib/domain";

let cachedTaxonomy: TaxonomyConfig | undefined;

export function loadTaxonomyConfig(path = taxonomyPath()): TaxonomyConfig {
  const source = readFileSync(path, "utf8");
  return TaxonomyConfigSchema.parse(JSON.parse(source));
}

export function getTaxonomyConfig(): TaxonomyConfig {
  cachedTaxonomy ??= loadTaxonomyConfig();
  return cachedTaxonomy;
}

export function resetTaxonomyConfigForTests(): void {
  cachedTaxonomy = undefined;
}

function taxonomyPath(): string {
  const configuredPath = process.env.REVIEW_TAXONOMY_PATH?.trim();
  if (configuredPath) {
    // The operator owns and mounts an explicitly configured path at runtime.
    return resolve(/* turbopackIgnore: true */ configuredPath);
  }
  return join(process.cwd(), "config", "review-taxonomy.v1.json");
}
