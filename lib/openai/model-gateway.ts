import type { z } from "zod";

export type ModelRole = "vision" | "synthesis";

export type AnalysisImageInput = {
  id: string;
  order: number;
  analysisRole: "final_work" | "concept_development";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Buffer;
  detail: "low" | "auto" | "high" | "original";
};

export type StructuredModelRequest<TSchema extends z.ZodType> = {
  passId: string;
  schemaName: string;
  schema: TSchema;
  instructions: string;
  input: unknown;
  images?: AnalysisImageInput[];
  modelRole: ModelRole;
  model?: string;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type StructuredModelResult<T> = {
  data: T;
  model: string;
  requestId?: string;
  usage?: ModelUsage;
};

export interface ModelGateway {
  runStructured<TSchema extends z.ZodType>(
    request: StructuredModelRequest<TSchema>,
  ): Promise<StructuredModelResult<z.output<TSchema>>>;
}
