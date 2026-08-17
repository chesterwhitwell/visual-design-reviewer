import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";

import { AppError } from "@/lib/http/errors";
import type {
  ModelGateway,
  StructuredModelRequest,
  StructuredModelResult,
} from "@/lib/openai/model-gateway";

export type OpenAIModelGatewayOptions = {
  apiKey: string;
  visionModel: string;
  synthesisModel: string;
  timeoutMs: number;
  maxRetries?: number;
};

export class OpenAIModelGateway implements ModelGateway {
  private readonly client: OpenAI;
  private readonly visionModel: string;
  private readonly synthesisModel: string;

  constructor(options: OpenAIModelGatewayOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      timeout: options.timeoutMs,
      maxRetries: options.maxRetries ?? 0,
    });
    this.visionModel = options.visionModel;
    this.synthesisModel = options.synthesisModel;
  }

  async runStructured<TSchema extends z.ZodType>(
    request: StructuredModelRequest<TSchema>,
  ): Promise<StructuredModelResult<z.output<TSchema>>> {
    const model =
      request.model ??
      (request.modelRole === "vision" ? this.visionModel : this.synthesisModel);
    const content: OpenAI.Responses.ResponseInputContent[] = [
      {
        type: "input_text",
        text: JSON.stringify(request.input),
      },
      ...(request.images ?? []).flatMap(
        (image): OpenAI.Responses.ResponseInputContent[] => [{
          type: "input_text",
          text: JSON.stringify({
            imageBinding: {
              imageId: image.id,
              order: image.order,
              analysisRole: image.analysisRole,
              notice: "The next image is bound to this trusted application metadata.",
            },
          }),
        }, {
          type: "input_image",
          image_url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}`,
          detail: image.detail,
        }],
      ),
    ];

    try {
      const response = await this.client.responses.parse(
        {
          model,
          store: false,
          instructions: request.instructions,
          input: [{ role: "user", content }],
          text: {
            format: zodTextFormat(request.schema, request.schemaName),
          },
          reasoning: {
            context: "current_turn",
            effort: request.reasoningEffort ?? "medium",
          },
          ...(request.maxOutputTokens
            ? { max_output_tokens: request.maxOutputTokens }
            : {}),
        },
        { signal: request.signal },
      );

      const refusal = response.output
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content)
        .find((item) => item.type === "refusal");

      if (refusal?.type === "refusal") {
        throw new AppError("upstream_refusal", "The model declined this analysis pass.", {
          retryable: false,
        });
      }

      if (response.status !== "completed") {
        throw new AppError(
          "upstream_invalid_output",
          "The model response did not complete successfully.",
          { retryable: response.status === "incomplete" },
        );
      }

      if (response.output_parsed === null || response.output_parsed === undefined) {
        throw new AppError(
          "upstream_invalid_output",
          "The model returned no schema-valid analysis output.",
          { retryable: true },
        );
      }

      return {
        data: request.schema.parse(response.output_parsed),
        model,
        requestId: response._request_id ?? undefined,
        usage: response.usage
          ? {
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      throw classifyOpenAIError(error);
    }
  }
}

function classifyOpenAIError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof AuthenticationError) {
    return new AppError(
      "upstream_authentication",
      "OpenAI authentication failed. Check the server-side API key.",
      { cause: error },
    );
  }

  if (error instanceof RateLimitError) {
    return new AppError(
      "upstream_rate_limit",
      "OpenAI rate-limited the request. It can be retried safely.",
      { retryable: true, cause: error },
    );
  }

  if (error instanceof APIConnectionTimeoutError) {
    return new AppError(
      "upstream_timeout",
      "The OpenAI request timed out. It can be retried safely.",
      { retryable: true, cause: error },
    );
  }

  if (error instanceof APIConnectionError) {
    return new AppError(
      "upstream_unavailable",
      "The application could not reach OpenAI.",
      { retryable: true, cause: error },
    );
  }

  if (error instanceof APIError) {
    const retryable = error.status === undefined || error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
    return new AppError(
      retryable ? "upstream_unavailable" : "upstream_invalid_output",
      retryable
        ? "OpenAI is temporarily unavailable. The pass can be retried."
        : "OpenAI rejected the analysis request.",
      { retryable, cause: error },
    );
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new AppError("upstream_timeout", "The model request was cancelled or timed out.", {
      retryable: true,
      cause: error,
    });
  }

  return new AppError(
    "upstream_invalid_output",
    "The model response could not be validated.",
    { retryable: true, cause: error },
  );
}
