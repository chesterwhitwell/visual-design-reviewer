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
  const visionModel = snapshot.passConfigurations.find(
    ({ modelConfiguration }) => Boolean(modelConfiguration.imageDetail),
  )?.modelConfiguration.model;
  const synthesisModel = snapshot.passConfigurations.find(
    ({ modelConfiguration }) => !modelConfiguration.imageDetail,
  )?.modelConfiguration.model;

  if (config.analysisGateway !== "openai" || !config.openaiApiKey) {
    throw new AppError(
      "configuration_error",
      "A live OpenAI gateway and API key must be configured.",
    );
  }
  if (!visionModel || !synthesisModel) {
    throw new AppError(
      "configuration_error",
      "The immutable run snapshot must contain both analysis models.",
    );
  }

  return {
    apiKey: config.openaiApiKey,
    visionModel,
    synthesisModel,
    timeoutMs: snapshot.operationalLimits.passTimeoutMs,
    maxRetries: 0,
  };
}
