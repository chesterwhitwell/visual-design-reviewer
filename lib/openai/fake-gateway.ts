import type { z } from "zod";

import { AppError } from "@/lib/http/errors";
import type {
  ModelGateway,
  StructuredModelRequest,
  StructuredModelResult,
} from "@/lib/openai/model-gateway";

export type FakePassHandler = (request: StructuredModelRequest<z.ZodType>) => unknown | Promise<unknown>;

export class FakeModelGateway implements ModelGateway {
  constructor(
    private readonly handlers: Record<string, FakePassHandler>,
    private readonly modelName = "fake-evaluation-model",
  ) {}

  async runStructured<TSchema extends z.ZodType>(
    request: StructuredModelRequest<TSchema>,
  ): Promise<StructuredModelResult<z.output<TSchema>>> {
    const handler = this.handlers[request.passId];
    if (!handler) {
      throw new AppError(
        "configuration_error",
        `No fake model handler is configured for ${request.passId}.`,
      );
    }

    const output = await handler(request as StructuredModelRequest<z.ZodType>);
    return {
      data: request.schema.parse(output),
      model: this.modelName,
      requestId: `fake-${request.passId}`,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }
}
