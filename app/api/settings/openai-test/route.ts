import { z } from "zod";

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
    if (!config.openaiApiKey || !config.openaiVisionModel || !config.openaiSynthesisModel) {
      throw new AppError(
        "configuration_error",
        "OPENAI_API_KEY, OPENAI_VISION_MODEL, and OPENAI_SYNTHESIS_MODEL must be configured on the server.",
      );
    }

    const gateway = new OpenAIModelGateway({
      apiKey: config.openaiApiKey,
      visionModel: config.openaiVisionModel,
      synthesisModel: config.openaiSynthesisModel,
      timeoutMs: Math.min(config.modelRequestTimeoutMs, 30_000),
    });
    const result = await gateway.runStructured({
      passId: "connection-test",
      schemaName: "connection_test",
      schema: connectionTestSchema,
      instructions:
        "This is a server connectivity test. Return the requested status object and nothing else.",
      input: { request: "Return status ready." },
      modelRole: "synthesis",
      reasoningEffort: "none",
      maxOutputTokens: 64,
    });

    return privateJson({
      ok: result.data.status === "ready",
      live: true,
      model: result.model,
      requestId: result.requestId ?? null,
      message: "OpenAI connection succeeded with store disabled.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
