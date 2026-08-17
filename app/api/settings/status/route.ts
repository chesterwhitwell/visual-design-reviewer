import { getRuntimeConfig } from "@/lib/config/runtime";
import { listPromptDefinitions } from "@/lib/analysis/prompts";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";
import { getTaxonomyConfig } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertTrustedRequest(request);
    const config = getRuntimeConfig();
    const taxonomy = getTaxonomyConfig();
    const missing: string[] = [];
    if (!config.openaiApiKey && config.analysisGateway === "openai") missing.push("API key");
    if (!config.openaiVisionModel) missing.push("vision model");
    if (!config.openaiSynthesisModel) missing.push("synthesis model");
    if (!config.imageEncryptionKey) missing.push("image encryption key");
    const ready = missing.length === 0;

    return privateJson({
      ready,
      label:
        config.analysisGateway === "fake"
          ? "Test gateway"
          : ready
            ? "API ready"
            : "Configuration needed",
      gateway: config.analysisGateway,
      hasApiKey: Boolean(config.openaiApiKey),
      hasEncryptionKey: Boolean(config.imageEncryptionKey),
      visionModel: config.openaiVisionModel ?? null,
      synthesisModel: config.openaiSynthesisModel ?? null,
      imageDetail: config.openaiImageDetail,
      reasoningEffort: config.openaiReasoningEffort,
      dataMode: config.openaiDataMode,
      retentionMode: "review_session",
      retentionHours: config.imageRetentionHours ?? null,
      databasePath: config.databasePath,
      imageStoragePath: config.imageStoragePath,
      taxonomy: {
        id: taxonomy.id,
        label: taxonomy.label,
        version: taxonomy.version,
        areaCount: taxonomy.areas.length,
      },
      promptVersions: [...new Set(listPromptDefinitions().map(({ version }) => version))],
      requestTimeoutMs: config.modelRequestTimeoutMs,
      maximumOutputTokensPerPass: config.maxOutputTokensPerPass,
      missing,
      limits: config.limits,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
