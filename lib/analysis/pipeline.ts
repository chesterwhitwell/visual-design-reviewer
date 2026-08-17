import { randomUUID } from "node:crypto";
import { z } from "zod";

import type {
  AnalysisPassId,
  CriteriaAnalysisInputSnapshot,
  DesignAnalysisInputSnapshot,
  DesignFinding,
  SafeAnalysisError,
} from "@/lib/domain";
import { AppError } from "@/lib/http/errors";
import type {
  AnalysisImageInput,
  ModelGateway,
  StructuredModelResult,
} from "@/lib/openai";
import {
  C1InputSchema,
  C2InputSchema,
  C3InputSchema,
  C4InputSchema,
  C5InputSchema,
  D1InputSchema,
  D2InputSchema,
  D3InputSchema,
  D4InputSchema,
  D5InputSchema,
  D6InputSchema,
  ReferenceValidationError,
  TransportPassOutputSchemas,
  materialiseC1Output,
  materialiseC2Output,
  materialiseC3Output,
  materialiseC4Output,
  materialiseC5Output,
  materialiseD1Output,
  materialiseD2Output,
  materialiseD3Output,
  materialiseD4Output,
  materialiseD5Output,
  materialiseD6Output,
  validateC1References,
  validateC2References,
  validateC3References,
  validateC4References,
  validateC5References,
  validateD1References,
  validateD2References,
  validateD3References,
  validateD4References,
  validateD5References,
  validateD6References,
  type C1Output,
  type C2Output,
  type C3Output,
  type C4Output,
  type C5Output,
  type D1Output,
  type D2Output,
  type D3Output,
  type D4Output,
  type D5Output,
  type D6Output,
} from "@/lib/schemas";
import { getPromptDefinition } from "@/lib/analysis/prompts";

export type PipelineAttemptStarted = {
  passId: AnalysisPassId;
  attemptNumber: number;
  startedAt: string;
};

export type PipelinePassCompleted = {
  passId: AnalysisPassId;
  attemptNumber: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  output: unknown;
  result: StructuredModelResult<unknown>;
};

export type PipelineAttemptFailed = {
  passId: AnalysisPassId;
  attemptNumber: number;
  startedAt: string;
  failedAt: string;
  durationMs: number;
  error: SafeAnalysisError;
  semanticIssuePaths?: string[];
};

export type PipelineObserver = {
  onAttemptStarted?(event: PipelineAttemptStarted): void | Promise<void>;
  onPassCompleted?(event: PipelinePassCompleted): void | Promise<void>;
  onAttemptFailed?(event: PipelineAttemptFailed): void | Promise<void>;
  onPassSkipped?(event: {
    passId: AnalysisPassId;
    reason: string;
    completedAt: string;
  }): void | Promise<void>;
};

export type PipelineExecutionOptions = {
  gateway: ModelGateway;
  images: AnalysisImageInput[];
  /** Validated outputs from completed passes when resuming a durable run. */
  resumedPassOutputs?: Partial<Record<AnalysisPassId, unknown>>;
  observer?: PipelineObserver;
  signal?: AbortSignal;
};

export type DesignPipelineResult = {
  passOutputs: {
    D1: D1Output;
    D2: D2Output;
    D3?: D3Output;
    D4: D4Output;
    D5: D5Output;
    D6: D6Output;
  };
  evidence: D1Output["observations"];
  findings: DesignFinding[];
  synthesis: D6Output["synthesis"];
};

export type CriteriaPipelineResult = {
  passOutputs: {
    C1: C1Output;
    C2: C2Output;
    C3: C3Output;
    C4: C4Output;
    C5: C5Output;
  };
  results: C4Output["results"];
  synthesis: C5Output["synthesis"];
};

type ExecuteStageOptions<TTransportSchema extends z.ZodType, TDomain> = {
  passId: AnalysisPassId;
  input: unknown;
  inputSchema: z.ZodType;
  transportSchema: TTransportSchema;
  materialise: (transport: z.output<TTransportSchema>) => TDomain;
  validate: (domain: TDomain) => TDomain;
  snapshot: DesignAnalysisInputSnapshot | CriteriaAnalysisInputSnapshot;
  execution: PipelineExecutionOptions;
};

export async function executeDesignPipeline(
  snapshot: DesignAnalysisInputSnapshot,
  execution: PipelineExecutionOptions,
): Promise<DesignPipelineResult> {
  assertCurrentPassContracts(snapshot);
  const D1 = resumedOutput(execution, "D1", (value) =>
    validateD1References(value, snapshot),
  ) ?? await executeStage({
    passId: "D1",
    input: { snapshot },
    inputSchema: D1InputSchema,
    transportSchema: TransportPassOutputSchemas.D1,
    materialise: (transport) => materialiseD1Output(transport, applicationIdFactory),
    validate: (domain) => validateD1References(domain, snapshot),
    snapshot,
    execution,
  });

  const D2 = resumedOutput(execution, "D2", (value) =>
    validateD2References(value, D1, snapshot),
  ) ?? await executeStage({
    passId: "D2",
    input: { snapshot, d1: D1 },
    inputSchema: D2InputSchema,
    transportSchema: TransportPassOutputSchemas.D2,
    materialise: (transport) => materialiseD2Output(transport, applicationIdFactory),
    validate: (domain) => validateD2References(domain, D1, snapshot),
    snapshot,
    execution,
  });

  let D3: D3Output | undefined;
  if (snapshot.context === null) {
    await execution.observer?.onPassSkipped?.({
      passId: "D3",
      reason: "No intention or context was supplied.",
      completedAt: new Date().toISOString(),
    });
  } else {
    D3 = resumedOutput(execution, "D3", (value) =>
      validateD3References(value, D2),
    ) ?? await executeStage({
      passId: "D3",
      input: { snapshot, d1: D1, d2: D2 },
      inputSchema: D3InputSchema,
      transportSchema: TransportPassOutputSchemas.D3,
      materialise: (transport) => materialiseD3Output(transport, applicationIdFactory),
      validate: (domain) => validateD3References(domain, D2),
      snapshot,
      execution,
    });
  }

  const D4 = resumedOutput(execution, "D4", (value) =>
    validateD4References(value, D2),
  ) ?? await executeStage({
    passId: "D4",
    input: { snapshot, d1: D1, d2: D2, ...(D3 ? { d3: D3 } : {}) },
    inputSchema: D4InputSchema,
    transportSchema: TransportPassOutputSchemas.D4,
    materialise: (transport) => materialiseD4Output(transport, applicationIdFactory),
    validate: (domain) => validateD4References(domain, D2),
    snapshot,
    execution,
  });

  const D5 = resumedOutput(execution, "D5", (value) =>
    validateD5References(value, D2, D1, snapshot),
  ) ?? await executeStage({
    passId: "D5",
    input: { snapshot, d1: D1, d2: D2, ...(D3 ? { d3: D3 } : {}), d4: D4 },
    inputSchema: D5InputSchema,
    transportSchema: TransportPassOutputSchemas.D5,
    materialise: (transport) => materialiseD5Output(transport, applicationIdFactory),
    validate: (domain) => validateD5References(domain, D2, D1, snapshot),
    snapshot,
    execution,
  });

  const D6 = resumedOutput(execution, "D6", (value) =>
    validateD6References(value, D5, D1, snapshot),
  ) ?? await executeStage({
    passId: "D6",
    input: { snapshot, d1: D1, d5: D5 },
    inputSchema: D6InputSchema,
    transportSchema: TransportPassOutputSchemas.D6,
    materialise: materialiseD6Output,
    validate: (domain) => validateD6References(domain, D5, D1, snapshot),
    snapshot,
    execution,
  });

  const findings = D5.decisions.flatMap(({ resultingFinding }) =>
    resultingFinding ? [resultingFinding] : [],
  );
  return {
    passOutputs: { D1, D2, ...(D3 ? { D3 } : {}), D4, D5, D6 },
    evidence: D1.observations,
    findings,
    synthesis: D6.synthesis,
  };
}

export async function executeCriteriaPipeline(
  snapshot: CriteriaAnalysisInputSnapshot,
  designFindings: DesignFinding[],
  execution: PipelineExecutionOptions,
): Promise<CriteriaPipelineResult> {
  assertCurrentPassContracts(snapshot);
  const C1 = resumedOutput(execution, "C1", (value) =>
    validateC1References(value, snapshot, designFindings),
  ) ?? await executeStage({
    passId: "C1",
    input: { snapshot, designFindings },
    inputSchema: C1InputSchema,
    transportSchema: TransportPassOutputSchemas.C1,
    materialise: (transport) => materialiseC1Output(transport, applicationIdFactory),
    validate: (domain) => validateC1References(domain, snapshot, designFindings),
    snapshot,
    execution,
  });
  const C2 = resumedOutput(execution, "C2", (value) =>
    validateC2References(value, snapshot, C1),
  ) ?? await executeStage({
    passId: "C2",
    input: { snapshot, c1: C1 },
    inputSchema: C2InputSchema,
    transportSchema: TransportPassOutputSchemas.C2,
    materialise: materialiseC2Output,
    validate: (domain) => validateC2References(domain, snapshot, C1),
    snapshot,
    execution,
  });
  const C3 = resumedOutput(execution, "C3", (value) =>
    validateC3References(value, snapshot, C1),
  ) ?? await executeStage({
    passId: "C3",
    input: { snapshot, c1: C1, c2: C2 },
    inputSchema: C3InputSchema,
    transportSchema: TransportPassOutputSchemas.C3,
    materialise: materialiseC3Output,
    validate: (domain) => validateC3References(domain, snapshot, C1),
    snapshot,
    execution,
  });
  const C4 = resumedOutput(execution, "C4", (value) =>
    validateC4References(value, snapshot, C1),
  ) ?? await executeStage({
    passId: "C4",
    input: { snapshot, c1: C1, c2: C2, c3: C3 },
    inputSchema: C4InputSchema,
    transportSchema: TransportPassOutputSchemas.C4,
    materialise: (transport) => materialiseC4Output(transport, C1),
    validate: (domain) => validateC4References(domain, snapshot, C1),
    snapshot,
    execution,
  });
  const C5 = resumedOutput(execution, "C5", (value) =>
    validateC5References(value, snapshot, C4),
  ) ?? await executeStage({
    passId: "C5",
    input: { snapshot, c4: C4 },
    inputSchema: C5InputSchema,
    transportSchema: TransportPassOutputSchemas.C5,
    materialise: materialiseC5Output,
    validate: (domain) => validateC5References(domain, snapshot, C4),
    snapshot,
    execution,
  });

  return {
    passOutputs: { C1, C2, C3, C4, C5 },
    results: C4.results,
    synthesis: C5.synthesis,
  };
}

function resumedOutput<T>(
  execution: PipelineExecutionOptions,
  passId: AnalysisPassId,
  validate: (value: unknown) => T,
): T | undefined {
  const value = execution.resumedPassOutputs?.[passId];
  return value === undefined ? undefined : validate(value);
}

function assertCurrentPassContracts(
  snapshot: DesignAnalysisInputSnapshot | CriteriaAnalysisInputSnapshot,
): void {
  for (const configuration of snapshot.passConfigurations) {
    const current = getPromptDefinition(configuration.passId);
    if (
      configuration.promptVersion !== current.version ||
      configuration.schemaVersion !== current.schemaVersion
    ) {
      throw new AppError(
        "configuration_error",
        "This analysis run uses a prompt or schema version that is unavailable in this application build. Start a new analysis with the current configuration.",
      );
    }
  }
}

async function executeStage<TTransportSchema extends z.ZodType, TDomain>(
  options: ExecuteStageOptions<TTransportSchema, TDomain>,
): Promise<TDomain> {
  const { passId, snapshot, execution } = options;
  const prompt = getPromptDefinition(passId);
  const configuration = snapshot.passConfigurations.find(
    (candidate) => candidate.passId === passId,
  );
  if (!configuration) {
    throw new AppError(
      "configuration_error",
      `The immutable run snapshot has no configuration for ${passId}.`,
    );
  }
  const validatedInput = options.inputSchema.parse(options.input);
  const maximumAttempts = snapshot.operationalLimits.maximumPassAttempts;

  for (let attemptNumber = 1; attemptNumber <= maximumAttempts; attemptNumber += 1) {
    throwIfAborted(execution.signal);
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    await execution.observer?.onAttemptStarted?.({ passId, attemptNumber, startedAt });

    try {
      const result = await execution.gateway.runStructured({
        passId,
        schemaName: `visual_design_reviewer_${passId.toLowerCase()}`,
        schema: options.transportSchema,
        instructions: prompt.instructions,
        input: validatedInput,
        images: prompt.requiresImages ? execution.images : undefined,
        modelRole: prompt.modelRole,
        model: configuration.modelConfiguration.model,
        reasoningEffort: configuration.modelConfiguration.reasoningEffort,
        maxOutputTokens: snapshot.operationalLimits.maximumOutputTokensPerPass,
        signal: execution.signal,
      });
      const materialised = options.materialise(result.data);
      const output = options.validate(materialised);
      const completed = Date.now();
      await execution.observer?.onPassCompleted?.({
        passId,
        attemptNumber,
        startedAt,
        completedAt: new Date(completed).toISOString(),
        durationMs: completed - started,
        output,
        result: result as StructuredModelResult<unknown>,
      });
      return output;
    } catch (error) {
      const failed = Date.now();
      const safeError = toSafeAnalysisError(error);
      await execution.observer?.onAttemptFailed?.({
        passId,
        attemptNumber,
        startedAt,
        failedAt: new Date(failed).toISOString(),
        durationMs: failed - started,
        error: safeError,
        ...(error instanceof ReferenceValidationError
          ? {
              semanticIssuePaths: [
                ...new Set(error.issues.map(({ path }) => path)),
              ].slice(0, 12),
            }
          : {}),
      });

      if (!safeError.retryable || attemptNumber >= maximumAttempts) {
        throw error;
      }
      await retryDelay(attemptNumber, execution.signal);
    }
  }

  throw new AppError("internal_error", `Analysis pass ${passId} exhausted its attempts.`);
}

function applicationIdFactory(): string {
  return randomUUID();
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new AppError("upstream_timeout", "The analysis run was cancelled.", {
      retryable: false,
    });
  }
}

function retryDelay(attemptNumber: number, signal: AbortSignal | undefined): Promise<void> {
  const delay = Math.min(2_000, 250 * 2 ** (attemptNumber - 1)) + Math.floor(Math.random() * 100);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, delay);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(
          new AppError("upstream_timeout", "The analysis run was cancelled.", {
            retryable: false,
          }),
        );
      },
      { once: true },
    );
  });
}

export function toSafeAnalysisError(error: unknown): SafeAnalysisError {
  if (error instanceof AppError) {
    const codeByAppError: Partial<Record<AppError["code"], SafeAnalysisError["code"]>> = {
      upstream_authentication: "authentication",
      upstream_rate_limit: "rate_limit",
      upstream_timeout: "timeout",
      upstream_refusal: "refusal",
      upstream_invalid_output: "invalid_structure",
      upstream_unavailable: "service_unavailable",
      image_missing: "missing_images",
      database_error: "database",
    };
    return {
      code: codeByAppError[error.code] ?? "unknown",
      message: error.message.slice(0, 500),
      retryable: error.retryable,
    };
  }

  if (error instanceof z.ZodError) {
    return {
      code: "invalid_structure",
      message: "The model output did not match the required structure.",
      retryable: true,
    };
  }

  if (error instanceof Error && error.name === "ReferenceValidationError") {
    return {
      code: "invalid_semantics",
      message: "The model output contained invalid evidence references.",
      retryable: true,
    };
  }

  return {
    code: "unknown",
    message: "The analysis pass failed unexpectedly.",
    retryable: false,
  };
}
