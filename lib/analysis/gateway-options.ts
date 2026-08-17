import type { RuntimeConfig } from "@/lib/config/runtime";
import type {
  CriteriaAnalysisInputSnapshot,
  DesignAnalysisInputSnapshot,
} from "@/lib/domain";
import { AppError } from "@/lib/http/errors";
import type { OpenAIModelGatewayOptions } from "@/lib/openai";

type AnalysisInputSnapshot =
  | DesignAnalysisInputSnapshot
  | CriteriaAnalysisInputSnapshot;

export function buildOpenAIGatewayOptions(
  snapshot: AnalysisInputSnapshot,
  config: RuntimeConfig,
): OpenAIModelGatewayOptions {
  if (
    config.analysisGateway !== "openai" ||
    !config.openaiApiKey ||
    !config.openaiVisionModel ||
    !config.openaiSynthesisModel
  ) {
    throw new AppError(
      "configuration_error",
      "A live OpenAI gateway and both analysis models must be configured.",
    );
  }

  return {
    apiKey: config.openaiApiKey,
    visionModel: config.openaiVisionModel,
    synthesisModel: config.openaiSynthesisModel,
    timeoutMs: snapshot.operationalLimits.passTimeoutMs,
    maxRetries: 0,
  };
}
