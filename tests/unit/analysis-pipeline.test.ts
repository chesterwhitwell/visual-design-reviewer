import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { executeDesignPipeline, toSafeAnalysisError } from "@/lib/analysis/pipeline";
import { buildOpenAIGatewayOptions } from "@/lib/analysis/gateway-options";
import { getPromptDefinition } from "@/lib/analysis/prompts";
import { loadRuntimeConfig } from "@/lib/config/runtime";
import { DesignAnalysisInputSnapshotSchema, type AnalysisPassId } from "@/lib/domain";
import { AppError } from "@/lib/http/errors";
import { FakeModelGateway, OpenAIModelGateway } from "@/lib/openai";
import { ReferenceValidationError } from "@/lib/schemas";

const modelConfiguration = {
  provider: "openai" as const,
  model: "configured-model",
  imageDetail: "high" as const,
  reasoningEffort: "medium" as const,
  store: false as const,
};

const operationalLimits = {
  maximumImages: 10,
  maximumBytesPerImage: 25_000_000,
  maximumPixelsPerImage: 80_000_000,
  maximumAggregateUploadBytes: 100_000_000,
  maximumContextCharacters: 20_000,
  maximumCriteria: 30,
  maximumJudgementStatementsPerCriterion: 12,
  maximumPassAttempts: 2,
  passTimeoutMs: 180_000,
  runTimeoutMs: 2_220_000,
  maximumOutputTokensPerPass: 16_000,
};

function designSnapshot(context: string | null = null) {
  const passIds = ["D1", "D2", "D3", "D4", "D5", "D6"] as const;
  return DesignAnalysisInputSnapshotSchema.parse({
    kind: "design",
    reviewId: "review-1",
    imageRevisionId: "revision-1",
    context,
    images: [
      {
        imageId: "image-1",
        order: 0,
        sanitizedDigest: "a".repeat(64),
        mimeType: "image/png",
        width: 1200,
        height: 800,
        byteSize: 50_000,
      },
    ],
    reviewAreas: [
      {
        taxonomyId: "visual-communication-design",
        taxonomyVersion: "1.0.0",
        areaId: "typography.hierarchy",
        areaLabel: "Typographic hierarchy",
        mode: "focus",
      },
    ],
    passConfigurations: passIds.map((passId) => {
      const prompt = getPromptDefinition(passId);
      return {
        passId,
        modelConfiguration: {
          ...modelConfiguration,
          ...(passId === "D6" ? { imageDetail: undefined } : {}),
        },
        promptVersion: prompt.version,
        schemaVersion: prompt.schemaVersion,
      };
    }),
    operationalLimits,
    capturedAt: "2026-08-15T02:00:00.000Z",
  });
}

function validEmptyDesignOutput(passId: AnalysisPassId) {
  switch (passId) {
    case "D1":
      return { observations: [] };
    case "D2":
      return { findings: [] };
    case "D3":
      return { alignments: [] };
    case "D4":
      return { challenges: [] };
    case "D5":
      return { decisions: [] };
    case "D6":
      return {
        synthesis: {
          overallReading: {
            text: "No material finding was established from the supplied evidence.",
            sourceFindingIds: [],
          },
          strengths: [],
          developmentPriorities: [],
          majorReviewAreas: {
            elementsOfDesign: { strengths: [], areasForImprovement: [] },
            principlesOfDesign: { strengths: [], areasForImprovement: [] },
            appliedVisualCommunication: { strengths: [], areasForImprovement: [] },
          },
          conceptAndDevelopment: null,
          focusAreaFeedback: [],
          contextAlignment: null,
          nextSteps: [],
          uncertainty: "The intentionally sparse fixture limits the available evidence.",
        },
      };
    default:
      throw new Error(`Unexpected test pass ${passId}`);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("analysis pipeline orchestration", () => {
  it("retries schema-invalid output, skips D3 without context, and keeps images off synthesis", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);

    const calls: AnalysisPassId[] = [];
    let d1Attempts = 0;
    const gateway = new FakeModelGateway(
      Object.fromEntries(
        (["D1", "D2", "D3", "D4", "D5", "D6"] as const).map((passId) => [
          passId,
          (request: { images?: unknown[] }) => {
            calls.push(passId);
            if (passId === "D1" && d1Attempts++ === 0) {
              return { observations: "not-an-array" };
            }
            if (passId === "D6") expect(request.images).toBeUndefined();
            else expect(request.images).toHaveLength(1);
            return validEmptyDesignOutput(passId);
          },
        ]),
      ),
    );
    const started: Array<[AnalysisPassId, number]> = [];
    const failed: Array<[AnalysisPassId, number, string]> = [];
    const skipped: AnalysisPassId[] = [];

    const pending = executeDesignPipeline(designSnapshot(), {
      gateway,
      images: [
        {
          id: "image-1",
          order: 0,
          analysisRole: "final_work",
          mimeType: "image/png",
          bytes: Buffer.from("sanitised-image"),
          detail: "high",
        },
      ],
      observer: {
        onAttemptStarted: ({ passId, attemptNumber }) => {
          started.push([passId, attemptNumber]);
        },
        onAttemptFailed: ({ passId, attemptNumber, error }) => {
          failed.push([passId, attemptNumber, error.code]);
        },
        onPassSkipped: ({ passId }) => {
          skipped.push(passId);
        },
      },
    });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(started.slice(0, 2)).toEqual([
      ["D1", 1],
      ["D1", 2],
    ]);
    expect(failed).toEqual([["D1", 1, "invalid_structure"]]);
    expect(skipped).toEqual(["D3"]);
    expect(calls).toEqual(["D1", "D1", "D2", "D4", "D5", "D6"]);
    expect(result.passOutputs).not.toHaveProperty("D3");
    expect(result.evidence).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("does not expose unexpected exception text as a safe analysis error", () => {
    const safe = toSafeAnalysisError(
      new Error("secret key sk-test-must-never-be-returned"),
    );

    expect(safe).toEqual({
      code: "unknown",
      message: "The analysis pass failed unexpectedly.",
      retryable: false,
    });
    expect(JSON.stringify(safe)).not.toContain("sk-test");
  });

  it("makes semantic model-output faults safe and retryable", () => {
    const safe = toSafeAnalysisError(
      new ReferenceValidationError([
        { path: "items[1].localRef", message: "local references must be unique" },
      ]),
    );

    expect(safe).toEqual({
      code: "invalid_semantics",
      message: "The model output contained invalid evidence references.",
      retryable: true,
    });
  });

  it("resumes from validated completed outputs without rerunning earlier passes", async () => {
    const calls: AnalysisPassId[] = [];
    const gateway = new FakeModelGateway(
      Object.fromEntries(
        (["D1", "D2", "D3", "D4", "D5", "D6"] as const).map((passId) => [
          passId,
          () => {
            calls.push(passId);
            return validEmptyDesignOutput(passId);
          },
        ]),
      ),
    );

    await executeDesignPipeline(designSnapshot(), {
      gateway,
      images: [],
      resumedPassOutputs: {
        D1: validEmptyDesignOutput("D1"),
        D2: validEmptyDesignOutput("D2"),
      },
    });

    expect(calls).toEqual(["D4", "D5", "D6"]);
  });

  it.each(["promptVersion", "schemaVersion"] as const)(
    "rejects a stale %s anywhere in the snapshot before making a model call",
    async (versionField) => {
      const snapshot = designSnapshot();
      snapshot.passConfigurations[5] = {
        ...snapshot.passConfigurations[5]!,
        [versionField]: "unavailable-version",
      };
      const handler = vi.fn(() => validEmptyDesignOutput("D1"));
      const gateway = new FakeModelGateway({ D1: handler });

      await expect(
        executeDesignPipeline(snapshot, { gateway, images: [] }),
      ).rejects.toMatchObject({
        code: "configuration_error",
        retryable: false,
      });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("wires the immutable run timeout into the live gateway options", () => {
    const snapshot = designSnapshot();
    const currentConfig = loadRuntimeConfig({
      NODE_ENV: "test",
      ANALYSIS_GATEWAY: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_VISION_MODEL: "current-vision-model",
      OPENAI_SYNTHESIS_MODEL: "current-synthesis-model",
      MODEL_REQUEST_TIMEOUT_MS: "999",
    });

    const options = buildOpenAIGatewayOptions(snapshot, currentConfig);

    expect(currentConfig.modelRequestTimeoutMs).toBe(999);
    expect(options.timeoutMs).toBe(snapshot.operationalLimits.passTimeoutMs);
    expect(options.timeoutMs).not.toBe(currentConfig.modelRequestTimeoutMs);
  });
});

describe("OpenAI structured request boundary", () => {
  it("always sends store:false and serialises only the supplied image bytes", async () => {
    const parse = vi.fn().mockResolvedValue({
      status: "completed",
      output: [],
      output_parsed: { answer: "grounded" },
      _request_id: "request-1",
      usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
    });
    const gateway = new OpenAIModelGateway({
      apiKey: "test-key",
      visionModel: "vision-model",
      synthesisModel: "synthesis-model",
      timeoutMs: 1_000,
    });
    Object.defineProperty(gateway, "client", {
      value: { responses: { parse } },
    });
    const schema = z.object({ answer: z.string() }).strict();

    const result = await gateway.runStructured({
      passId: "D1",
      schemaName: "test_schema",
      schema,
      instructions: "Return the bounded result.",
      input: { safe: "input" },
      images: [
        {
          id: "image-1",
          order: 0,
          analysisRole: "final_work",
          mimeType: "image/png",
          bytes: Buffer.from([0, 1, 2, 3]),
          detail: "high",
        },
      ],
      modelRole: "vision",
      reasoningEffort: "low",
      maxOutputTokens: 400,
    });

    expect(result).toMatchObject({
      data: { answer: "grounded" },
      model: "vision-model",
      requestId: "request-1",
    });
    expect(parse).toHaveBeenCalledOnce();
    const [payload] = parse.mock.calls[0]!;
    expect(payload).toMatchObject({
      model: "vision-model",
      store: false,
      reasoning: { context: "current_turn", effort: "low" },
      max_output_tokens: 400,
    });
    expect(payload.input[0].content).toEqual(
      expect.arrayContaining([
        { type: "input_text", text: JSON.stringify({ safe: "input" }) },
        {
          type: "input_text",
          text: JSON.stringify({
            imageBinding: {
              imageId: "image-1",
              order: 0,
              analysisRole: "final_work",
              notice: "The next image is bound to this trusted application metadata.",
            },
          }),
        },
        {
          type: "input_image",
          image_url: "data:image/png;base64,AAECAw==",
          detail: "high",
        },
      ]),
    );
    expect(JSON.stringify(payload)).toContain("image-1");
    expect(JSON.stringify(payload)).not.toContain("test-key");
  });

  it("preserves only the intentional safe message for known retryable failures", () => {
    const safe = toSafeAnalysisError(
      new AppError("upstream_rate_limit", "The service asked us to retry later.", {
        retryable: true,
      }),
    );
    expect(safe).toEqual({
      code: "rate_limit",
      message: "The service asked us to retry later.",
      retryable: true,
    });
  });
});
