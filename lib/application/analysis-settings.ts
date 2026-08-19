import "server-only";

import { z } from "zod";

import { getRuntimeConfig, type RuntimeConfig } from "@/lib/config/runtime";
import { createRepositories, type Repositories } from "@/lib/db";

export const ANALYSIS_SETTINGS_KEY = "analysis.model-settings.v1";

export const ReasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const modelIdSchema = z
  .string()
  .trim()
  .min(1, "Choose a model.")
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Enter a valid OpenAI model ID.");

export const AnalysisModelSettingsSchema = z
  .object({
    visionModel: modelIdSchema,
    synthesisModel: modelIdSchema,
    reasoningEffort: ReasoningEffortSchema,
  })
  .strict()
  .superRefine((settings, context) => {
    if (
      settings.reasoningEffort === "minimal" &&
      [settings.visionModel, settings.synthesisModel].some((model) =>
        model.startsWith("gpt-5.6"),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["reasoningEffort"],
        message: "GPT-5.6 supports none, low, medium, high, xhigh, or max.",
      });
    }
  });

export type AnalysisModelSettings = z.infer<typeof AnalysisModelSettingsSchema>;
export type AnalysisSettingSource = "application" | "environment" | "default" | "missing";

export type EffectiveAnalysisModelSettings = AnalysisModelSettings & {
  sources: {
    visionModel: AnalysisSettingSource;
    synthesisModel: AnalysisSettingSource;
    reasoningEffort: AnalysisSettingSource;
  };
  savedOverride: boolean;
};

export function getEffectiveAnalysisModelSettings(
  config: RuntimeConfig = getRuntimeConfig(),
  repositories: Repositories = createRepositories(),
  environment: NodeJS.ProcessEnv = process.env,
): EffectiveAnalysisModelSettings {
  const storedValue = repositories.settings.get(ANALYSIS_SETTINGS_KEY);
  const stored = AnalysisModelSettingsSchema.safeParse(storedValue);
  if (stored.success) {
    return {
      ...stored.data,
      sources: {
        visionModel: "application",
        synthesisModel: "application",
        reasoningEffort: "application",
      },
      savedOverride: true,
    };
  }

  return {
    visionModel: config.openaiVisionModel ?? "",
    synthesisModel: config.openaiSynthesisModel ?? "",
    reasoningEffort: config.openaiReasoningEffort,
    sources: {
      visionModel: config.openaiVisionModel ? "environment" : "missing",
      synthesisModel: config.openaiSynthesisModel ? "environment" : "missing",
      reasoningEffort: environment.OPENAI_REASONING_EFFORT ? "environment" : "default",
    },
    savedOverride: storedValue !== null,
  };
}

export function saveAnalysisModelSettings(
  input: unknown,
  repositories: Repositories = createRepositories(),
): AnalysisModelSettings {
  const settings = AnalysisModelSettingsSchema.parse(input);
  return repositories.settings.set(ANALYSIS_SETTINGS_KEY, settings);
}

export function clearAnalysisModelSettings(
  repositories: Repositories = createRepositories(),
): boolean {
  return repositories.settings.delete(ANALYSIS_SETTINGS_KEY);
}
