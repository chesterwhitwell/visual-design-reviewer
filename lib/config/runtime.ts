import { z } from "zod";

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const positiveInteger = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const optionalPositiveInteger = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

const runtimeEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_PATH: z.string().trim().min(1).default("data/reviewer.db"),
  IMAGE_STORAGE_PATH: z.string().trim().min(1).default("data/images"),
  IMAGE_ENCRYPTION_KEY: optionalTrimmedString,
  OPENAI_API_KEY: optionalTrimmedString,
  OPENAI_VISION_MODEL: optionalTrimmedString,
  OPENAI_SYNTHESIS_MODEL: optionalTrimmedString,
  OPENAI_IMAGE_DETAIL: z.enum(["low", "auto", "high", "original"]).default("original"),
  OPENAI_DATA_MODE: z.enum(["standard", "zdr"]).default("standard"),
  OPENAI_REASONING_EFFORT: z
    .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
    .default("medium"),
  ANALYSIS_GATEWAY: z.enum(["openai", "fake"]).default("openai"),
  ALLOWED_HOSTS: z.string().default("localhost,127.0.0.1,[::1]"),
  MAX_IMAGES_PER_REVIEW: positiveInteger(10),
  MAX_IMAGE_BYTES: positiveInteger(25 * 1024 * 1024),
  MAX_TOTAL_IMAGE_BYTES: positiveInteger(100 * 1024 * 1024),
  MAX_IMAGE_PIXELS: positiveInteger(80_000_000),
  MAX_IMAGE_WIDTH: positiveInteger(20_000),
  MAX_IMAGE_HEIGHT: positiveInteger(20_000),
  MAX_SANITIZED_IMAGE_BYTES: positiveInteger(40 * 1024 * 1024),
  PREVIEW_MAX_WIDTH: positiveInteger(1_600),
  PREVIEW_MAX_HEIGHT: positiveInteger(1_200),
  MAX_PREVIEW_BYTES: positiveInteger(4 * 1024 * 1024),
  MAX_CONTEXT_LENGTH: positiveInteger(20_000),
  MAX_CRITERIA_COUNT: positiveInteger(30),
  MAX_JUDGEMENTS_PER_CRITERION: positiveInteger(12),
  MODEL_REQUEST_TIMEOUT_MS: positiveInteger(180_000),
  MODEL_SCHEMA_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  MAX_OUTPUT_TOKENS_PER_PASS: positiveInteger(16_000),
  ANALYSIS_LEASE_MS: positiveInteger(300_000),
  IMAGE_RETENTION_HOURS: optionalPositiveInteger,
});

export type RuntimeConfig = {
  nodeEnv: "development" | "test" | "production";
  databasePath: string;
  imageStoragePath: string;
  imageEncryptionKey?: string;
  openaiApiKey?: string;
  openaiVisionModel?: string;
  openaiSynthesisModel?: string;
  openaiImageDetail: "low" | "auto" | "high" | "original";
  openaiDataMode: "standard" | "zdr";
  openaiReasoningEffort:
    | "none"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max";
  analysisGateway: "openai" | "fake";
  allowedHosts: string[];
  limits: {
    imagesPerReview: number;
    imageBytes: number;
    totalImageBytes: number;
    imagePixels: number;
    imageWidth: number;
    imageHeight: number;
    sanitizedImageBytes: number;
    previewWidth: number;
    previewHeight: number;
    previewBytes: number;
    contextLength: number;
    criteriaCount: number;
    judgementsPerCriterion: number;
  };
  modelRequestTimeoutMs: number;
  modelSchemaRetries: number;
  maxOutputTokensPerPass: number;
  analysisLeaseMs: number;
  imageRetentionHours?: number;
};

let cachedConfig: RuntimeConfig | undefined;

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const parsed = runtimeEnvironmentSchema.parse(environment);

  return {
    nodeEnv: parsed.NODE_ENV,
    databasePath: parsed.DATABASE_PATH,
    imageStoragePath: parsed.IMAGE_STORAGE_PATH,
    imageEncryptionKey: parsed.IMAGE_ENCRYPTION_KEY,
    openaiApiKey: parsed.OPENAI_API_KEY,
    openaiVisionModel: parsed.OPENAI_VISION_MODEL,
    openaiSynthesisModel: parsed.OPENAI_SYNTHESIS_MODEL,
    openaiImageDetail: parsed.OPENAI_IMAGE_DETAIL,
    openaiDataMode: parsed.OPENAI_DATA_MODE,
    openaiReasoningEffort: parsed.OPENAI_REASONING_EFFORT,
    analysisGateway: parsed.ANALYSIS_GATEWAY,
    allowedHosts: parsed.ALLOWED_HOSTS.split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    limits: {
      imagesPerReview: parsed.MAX_IMAGES_PER_REVIEW,
      imageBytes: parsed.MAX_IMAGE_BYTES,
      totalImageBytes: parsed.MAX_TOTAL_IMAGE_BYTES,
      imagePixels: parsed.MAX_IMAGE_PIXELS,
      imageWidth: parsed.MAX_IMAGE_WIDTH,
      imageHeight: parsed.MAX_IMAGE_HEIGHT,
      sanitizedImageBytes: parsed.MAX_SANITIZED_IMAGE_BYTES,
      previewWidth: parsed.PREVIEW_MAX_WIDTH,
      previewHeight: parsed.PREVIEW_MAX_HEIGHT,
      previewBytes: parsed.MAX_PREVIEW_BYTES,
      contextLength: parsed.MAX_CONTEXT_LENGTH,
      criteriaCount: parsed.MAX_CRITERIA_COUNT,
      judgementsPerCriterion: parsed.MAX_JUDGEMENTS_PER_CRITERION,
    },
    modelRequestTimeoutMs: parsed.MODEL_REQUEST_TIMEOUT_MS,
    modelSchemaRetries: parsed.MODEL_SCHEMA_RETRIES,
    maxOutputTokensPerPass: parsed.MAX_OUTPUT_TOKENS_PER_PASS,
    analysisLeaseMs: parsed.ANALYSIS_LEASE_MS,
    imageRetentionHours: parsed.IMAGE_RETENTION_HOURS,
  };
}

export function getRuntimeConfig(): RuntimeConfig {
  cachedConfig ??= loadRuntimeConfig();
  return cachedConfig;
}

export function resetRuntimeConfigForTests(): void {
  cachedConfig = undefined;
}
