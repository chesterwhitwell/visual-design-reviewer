import { z } from "zod";

import { readJsonBody } from "@/app/api/reviews/_request";
import {
  AnalysisModelSettingsSchema,
  getEffectiveAnalysisModelSettings,
} from "@/lib/application/analysis-settings";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { AppError } from "@/lib/http/errors";
import { errorResponse, privateJson } from "@/lib/http/response";
import { OpenAIModelGateway } from "@/lib/openai/openai-gateway";
import { assertTrustedRequest } from "@/lib/security/request";

const connectionTestSchema = z
  .object({
    status: z.literal("ready"),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertTrustedRequest(request, true);
    const config = getRuntimeConfig();
    if (config.analysisGateway === "fake") {
      return privateJson({
        ok: true,
        live: false,
        message: "The explicit test gateway is active; no OpenAI request was made.",
      });
    }
    const effective = getEffectiveAnalysisModelSettings(config);
    const settings = request.body
      ? AnalysisModelSettingsSchema.parse(await readJsonBody(request, 2 * 1024))
      : AnalysisModelSettingsSchema.parse({
          visionModel: effective.visionModel,
          synthesisModel: effective.synthesisModel,
          reasoningEffort: effective.reasoningEffort,
        });
    if (!config.openaiApiKey) {
      throw new AppError(
        "configuration_error",
        "The OpenAI API key must be configured on the server.",
      );
    }

    const gateway = new OpenAIModelGateway({
      apiKey: config.openaiApiKey,
      visionModel: settings.visionModel,
      synthesisModel: settings.synthesisModel,
      timeoutMs: Math.min(config.modelRequestTimeoutMs, 30_000),
    });
    const configuredModels = settings.visionModel === settings.synthesisModel
      ? [["synthesis", settings.synthesisModel] as const]
      : [
          ["vision", settings.visionModel] as const,
          ["synthesis", settings.synthesisModel] as const,
        ];
    const results = [];
    for (const [modelRole, model] of configuredModels) {
      results.push(await gateway.runStructured({
        passId: `connection-test-${modelRole}`,
        schemaName: `connection_test_${modelRole}`,
        schema: connectionTestSchema,
        instructions:
          "This is a server connectivity test. Return the requested status object and nothing else.",
        input: { request: "Return status ready." },
        modelRole,
        model,
        reasoningEffort: settings.reasoningEffort === "minimal" ? "minimal" : "none",
        maxOutputTokens: 64,
      }));
    }

    return privateJson({
      ok: results.every(({ data }) => data.status === "ready"),
      live: true,
      models: results.map(({ model, requestId }) => ({
        model,
        requestId: requestId ?? null,
      })),
      message:
        results.length === 1
          ? "The configured OpenAI model responded successfully with store disabled."
          : "Both OpenAI models responded successfully with store disabled.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
