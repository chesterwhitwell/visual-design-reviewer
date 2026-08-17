import { z } from "zod";

import {
  ApplicationIdSchema,
  ConfidenceSchema,
  deepFreeze,
  type DeepReadonly,
  IsoDateTimeSchema,
  JsonValueSchema,
  NonEmptyTextSchema,
  PositiveVersionSchema,
  ShortTextSchema,
  SignificanceSchema,
  addDuplicateIssues,
} from "./common";
import { CriteriaSnapshotSchema } from "./criteria";
import { ImageManifestSchema } from "./review";
import { ReviewAreaSnapshotSchema } from "./taxonomy";

export const DesignPassIdSchema = z.enum(["D1", "D2", "D3", "D4", "D5", "D6"]);
export const CriteriaPassIdSchema = z.enum(["C1", "C2", "C3", "C4", "C5"]);
export const AnalysisPassIdSchema = z.union([DesignPassIdSchema, CriteriaPassIdSchema]);
export const AnalysisKindSchema = z.enum(["design", "criteria"]);

export const ImageDetailSchema = z.enum(["low", "high", "original", "auto"]);
export const ReasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const ModelConfigurationSchema = z
  .object({
    provider: z.literal("openai"),
    model: z.string().trim().min(1).max(200),
    imageDetail: ImageDetailSchema.optional(),
    reasoningEffort: ReasoningEffortSchema.optional(),
    store: z.literal(false),
  })
  .strict();

export const PassConfigurationSnapshotSchema = z
  .object({
    passId: AnalysisPassIdSchema,
    modelConfiguration: ModelConfigurationSchema,
    promptVersion: z.string().trim().min(1).max(64),
    schemaVersion: z.string().trim().min(1).max(64),
  })
  .strict();

export const OperationalLimitsSchema = z
  .object({
    maximumImages: z.number().int().positive(),
    maximumBytesPerImage: z.number().int().positive(),
    maximumPixelsPerImage: z.number().int().positive(),
    maximumAggregateUploadBytes: z.number().int().positive(),
    maximumContextCharacters: z.number().int().nonnegative(),
    maximumCriteria: z.number().int().positive(),
    maximumJudgementStatementsPerCriterion: z.number().int().nonnegative(),
    maximumPassAttempts: z.number().int().positive(),
    passTimeoutMs: z.number().int().positive(),
    runTimeoutMs: z.number().int().positive(),
    maximumOutputTokensPerPass: z.number().int().positive(),
  })
  .strict();

const DesignSnapshotBaseSchema = z
  .object({
    kind: z.literal("design"),
    reviewId: ApplicationIdSchema,
    imageRevisionId: ApplicationIdSchema,
    context: z.string().max(20_000).nullable(),
    images: ImageManifestSchema,
    reviewAreas: z.array(ReviewAreaSnapshotSchema).min(1).max(256),
    passConfigurations: z.array(PassConfigurationSnapshotSchema).length(6),
    operationalLimits: OperationalLimitsSchema,
    capturedAt: IsoDateTimeSchema,
  })
  .strict();

export const DesignAnalysisInputSnapshotSchema = DesignSnapshotBaseSchema.superRefine(
  (snapshot, context) => {
    validateFinalWorkImage(snapshot.images, context);
    validateSnapshotAreas(snapshot.reviewAreas, context);
    validateExactPasses(
      snapshot.passConfigurations,
      DesignPassIdSchema.options,
      context,
    );
  },
);

const CriteriaSnapshotBaseSchema = z
  .object({
    kind: z.literal("criteria"),
    reviewId: ApplicationIdSchema,
    imageRevisionId: ApplicationIdSchema,
    designAnalysisId: ApplicationIdSchema,
    designAnalysisVersion: PositiveVersionSchema,
    context: z.string().max(20_000).nullable(),
    images: ImageManifestSchema,
    reviewAreas: z.array(ReviewAreaSnapshotSchema).min(1).max(256),
    criteria: CriteriaSnapshotSchema,
    passConfigurations: z.array(PassConfigurationSnapshotSchema).length(5),
    operationalLimits: OperationalLimitsSchema,
    capturedAt: IsoDateTimeSchema,
  })
  .strict();

export const CriteriaAnalysisInputSnapshotSchema = CriteriaSnapshotBaseSchema.superRefine(
  (snapshot, context) => {
    validateFinalWorkImage(snapshot.images, context);
    validateSnapshotAreas(snapshot.reviewAreas, context);
    validateExactPasses(
      snapshot.passConfigurations,
      CriteriaPassIdSchema.options,
      context,
    );
  },
);

function validateFinalWorkImage(
  images: Array<{ analysisRole: "final_work" | "concept_development" }>,
  context: z.RefinementCtx,
): void {
  if (!images.some(({ analysisRole }) => analysisRole === "final_work")) {
    context.addIssue({
      code: "custom",
      message: "an analysis snapshot requires at least one final-work image",
      path: ["images"],
    });
  }
}

export const AnalysisInputSnapshotSchema = z.discriminatedUnion("kind", [
  DesignAnalysisInputSnapshotSchema,
  CriteriaAnalysisInputSnapshotSchema,
]);

function validateSnapshotAreas(
  areas: z.infer<typeof ReviewAreaSnapshotSchema>[],
  context: z.RefinementCtx,
): void {
  addDuplicateIssues(
    areas.map(({ areaId }) => areaId),
    context,
    ["reviewAreas"],
    "snapshot review-area IDs",
  );

  const taxonomyKeys = new Set(
    areas.map(({ taxonomyId, taxonomyVersion }) => `${taxonomyId}@${taxonomyVersion}`),
  );
  if (taxonomyKeys.size !== 1) {
    context.addIssue({
      code: "custom",
      message: "all review areas must come from the same taxonomy version",
      path: ["reviewAreas"],
    });
  }
}

function validateExactPasses(
  configurations: readonly { passId: string }[],
  expectedPasses: readonly string[],
  context: z.RefinementCtx,
): void {
  const actual = configurations.map(({ passId }) => passId);
  addDuplicateIssues(actual, context, ["passConfigurations"], "pass IDs");
  const actualSet = new Set(actual);
  const missing = expectedPasses.filter((passId) => !actualSet.has(passId));
  const unexpected = actual.filter((passId) => !expectedPasses.includes(passId));

  if (missing.length > 0 || unexpected.length > 0) {
    context.addIssue({
      code: "custom",
      message: `pass configuration mismatch; missing [${missing.join(", ")}], unexpected [${unexpected.join(", ")}]`,
      path: ["passConfigurations"],
    });
  }
}

export const EvidenceItemSchema = z
  .object({
    id: ApplicationIdSchema,
    imageId: ApplicationIdSchema,
    regionDescription: z.string().trim().min(1).max(500).optional(),
    reviewAreaId: ApplicationIdSchema,
    observation: NonEmptyTextSchema.max(4_000),
    confidence: ConfidenceSchema,
    uncertainty: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

export const CandidateDesignFindingSchema = z
  .object({
    id: ApplicationIdSchema,
    reviewAreaIds: z.array(ApplicationIdSchema).min(1).max(12),
    observation: NonEmptyTextSchema.max(4_000),
    interpretation: NonEmptyTextSchema.max(4_000),
    likelyEffect: z.string().trim().min(1).max(4_000).optional(),
    supportingEvidenceIds: z.array(ApplicationIdSchema).min(1).max(30),
    significance: SignificanceSchema,
    confidence: ConfidenceSchema,
    focusRelated: z.boolean(),
  })
  .strict();

export const ContextAlignmentStatusSchema = z.enum([
  "supports_intention",
  "conflicts_with_intention",
  "mixed",
  "cannot_determine",
]);

export const ContextAlignmentRecordSchema = z
  .object({
    id: ApplicationIdSchema,
    findingId: ApplicationIdSchema,
    status: ContextAlignmentStatusSchema,
    alignment: NonEmptyTextSchema.max(4_000),
    alternativeInterpretation: z.string().trim().min(1).max(4_000).optional(),
    uncertainty: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

export const AdversarialStatusSchema = z.enum([
  "confirmed",
  "confirmed_with_qualification",
  "disputed",
  "insufficient_evidence",
]);

export const DesignChallengeSchema = z
  .object({
    id: ApplicationIdSchema,
    findingId: ApplicationIdSchema,
    status: AdversarialStatusSchema,
    counterEvidence: z.array(NonEmptyTextSchema.max(2_000)).max(12),
    alternativeInterpretation: z.string().trim().min(1).max(4_000).optional(),
    qualification: z.string().trim().min(1).max(4_000).optional(),
    rationaleSummary: NonEmptyTextSchema.max(4_000),
  })
  .strict();

export const AdjudicationActionSchema = z.enum([
  "retain",
  "modify",
  "merge",
  "reject",
]);

export const DesignFindingSchema = z
  .object({
    id: ApplicationIdSchema,
    sourceFindingIds: z.array(ApplicationIdSchema).min(1).max(20),
    reviewAreaIds: z.array(ApplicationIdSchema).min(1).max(12),
    observation: NonEmptyTextSchema.max(4_000),
    interpretation: NonEmptyTextSchema.max(4_000),
    likelyEffect: z.string().trim().min(1).max(4_000).optional(),
    supportingEvidenceIds: z.array(ApplicationIdSchema).min(1).max(30),
    contextAlignment: z.string().trim().min(1).max(4_000).optional(),
    alternativeInterpretation: z.string().trim().min(1).max(4_000).optional(),
    significance: SignificanceSchema,
    confidence: ConfidenceSchema,
    focusRelated: z.boolean(),
    adversarialStatus: AdversarialStatusSchema,
    adjudication: z.enum(["retained", "modified", "merged"]),
  })
  .strict();

export const AdjudicationDecisionSchema = z
  .object({
    id: ApplicationIdSchema,
    sourceFindingIds: z.array(ApplicationIdSchema).min(1).max(20),
    action: AdjudicationActionSchema,
    rationaleSummary: NonEmptyTextSchema.max(4_000),
    resultingFinding: DesignFindingSchema.optional(),
  })
  .strict()
  .superRefine((decision, context) => {
    const resultRequired = decision.action !== "reject";
    if (resultRequired !== (decision.resultingFinding !== undefined)) {
      context.addIssue({
        code: "custom",
        message:
          decision.action === "reject"
            ? "a rejected decision cannot contain a resulting finding"
            : "a non-rejected decision requires a resulting finding",
        path: ["resultingFinding"],
      });
    }
    if (decision.action === "merge" && decision.sourceFindingIds.length < 2) {
      context.addIssue({
        code: "custom",
        message: "a merge decision requires at least two source findings",
        path: ["sourceFindingIds"],
      });
    }
    if (decision.action !== "merge" && decision.sourceFindingIds.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "retain, modify, and reject decisions require exactly one source finding",
        path: ["sourceFindingIds"],
      });
    }
  });

export const SynthesisStatementSchema = z
  .object({
    text: NonEmptyTextSchema.max(4_000),
    sourceFindingIds: z.array(ApplicationIdSchema).max(20),
  })
  .strict();

export const MajorReviewAreaAnalysisSchema = z
  .object({
    strengths: z.array(SynthesisStatementSchema).max(8),
    areasForImprovement: z.array(SynthesisStatementSchema).max(8),
  })
  .strict();

export const MajorReviewAreasAnalysisSchema = z
  .object({
    elementsOfDesign: MajorReviewAreaAnalysisSchema,
    principlesOfDesign: MajorReviewAreaAnalysisSchema,
    appliedVisualCommunication: MajorReviewAreaAnalysisSchema,
  })
  .strict();

export const ConceptDevelopmentAnalysisSchema = z
  .object({
    overallReading: SynthesisStatementSchema,
    strengths: z.array(SynthesisStatementSchema).max(8),
    developmentPriorities: z.array(SynthesisStatementSchema).max(8),
    relationshipToFinalWork: z.array(SynthesisStatementSchema).max(8),
  })
  .strict();

export const DesignSynthesisSchema = z
  .object({
    overallReading: SynthesisStatementSchema,
    strengths: z.array(SynthesisStatementSchema).max(12),
    developmentPriorities: z.array(SynthesisStatementSchema).max(12),
    // Optional only so immutable artifacts produced before this section was
    // introduced remain readable. Current D6 transport always requires it.
    majorReviewAreas: MajorReviewAreasAnalysisSchema.optional(),
    // Older artifacts predate image-purpose tagging. Current D6 requires this
    // section whenever the immutable snapshot contains development evidence.
    conceptAndDevelopment: ConceptDevelopmentAnalysisSchema.optional(),
    focusAreaFeedback: z.array(SynthesisStatementSchema).max(20),
    contextAlignment: SynthesisStatementSchema.optional(),
    nextSteps: z.array(SynthesisStatementSchema).max(12),
    uncertainty: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict();

export const CriterionAssessabilitySchema = z.enum([
  "assessable",
  "partly_assessable",
  "not_assessable",
]);

export const CriterionEvidenceSchema = z
  .object({
    id: ApplicationIdSchema,
    criterionId: ApplicationIdSchema,
    imageId: ApplicationIdSchema,
    regionDescription: z.string().trim().min(1).max(500).optional(),
    observation: NonEmptyTextSchema.max(4_000),
    designFindingIds: z.array(ApplicationIdSchema).max(20),
  })
  .strict();

export const CriterionEvidenceSearchSchema = z
  .object({
    criterionId: ApplicationIdSchema,
    assessability: CriterionAssessabilitySchema,
    assessabilityRationale: NonEmptyTextSchema.max(4_000),
    supportingEvidence: z.array(CriterionEvidenceSchema).max(30),
    counterEvidence: z.array(CriterionEvidenceSchema).max(30),
    relevantContext: z.string().trim().min(1).max(4_000).optional(),
    designFindingIds: z.array(ApplicationIdSchema).max(30),
    uncertainty: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

export const FallbackCriterionStatusSchema = z.enum([
  "demonstrated",
  "partly_demonstrated",
  "not_demonstrated",
  "insufficient_evidence",
]);

export const JudgementFitSchema = z.enum(["strong", "partial", "weak", "not_supported"]);

export const StatementComparisonSchema = z
  .object({
    judgementStatementId: ApplicationIdSchema,
    fit: JudgementFitSchema,
    rationale: NonEmptyTextSchema.max(4_000),
  })
  .strict();

export const CriterionComparisonSchema = z
  .object({
    criterionId: ApplicationIdSchema,
    evidenceIds: z.array(ApplicationIdSchema).max(60),
    statementComparisons: z.array(StatementComparisonSchema).max(20),
    selectedJudgementStatementId: ApplicationIdSchema.optional(),
    fallbackStatus: FallbackCriterionStatusSchema.optional(),
    adjacentStatementReasons: z.array(StatementComparisonSchema).max(2),
    rationale: NonEmptyTextSchema.max(4_000),
    confidence: ConfidenceSchema,
  })
  .strict()
  .superRefine((comparison, context) => {
    const decisionCount =
      Number(comparison.selectedJudgementStatementId !== undefined) +
      Number(comparison.fallbackStatus !== undefined);
    if (decisionCount !== 1) {
      context.addIssue({
        code: "custom",
        message: "exactly one selected judgement statement or fallback status is required",
        path: ["selectedJudgementStatementId"],
      });
    }
  });

export const CriterionChallengeSchema = z
  .object({
    criterionId: ApplicationIdSchema,
    status: AdversarialStatusSchema,
    alternateJudgementStatementId: ApplicationIdSchema.optional(),
    alternateFallbackStatus: FallbackCriterionStatusSchema.optional(),
    evidenceIds: z.array(ApplicationIdSchema).max(60),
    scopeCheck: NonEmptyTextSchema.max(4_000),
    contextBiasCheck: NonEmptyTextSchema.max(4_000),
    designComplianceTension: NonEmptyTextSchema.max(4_000),
    qualification: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict()
  .superRefine((challenge, context) => {
    if (
      challenge.alternateJudgementStatementId !== undefined &&
      challenge.alternateFallbackStatus !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "an alternate judgement cannot be both a statement and a fallback status",
        path: ["alternateJudgementStatementId"],
      });
    }
  });

export const DesignRelationshipSchema = z.enum([
  "aligned",
  "criterion_conflicts_with_design_strength",
  "criterion_met_but_design_weak",
  "unrelated",
  "unclear",
]);

export const CriterionResultSchema = z
  .object({
    criterionId: ApplicationIdSchema,
    supportingEvidence: z.array(CriterionEvidenceSchema).max(30),
    counterEvidence: z.array(CriterionEvidenceSchema).max(30),
    selectedJudgementStatementId: ApplicationIdSchema.optional(),
    fallbackStatus: FallbackCriterionStatusSchema.optional(),
    rationale: NonEmptyTextSchema.max(4_000),
    alternativeJudgement: z.string().trim().min(1).max(4_000).optional(),
    confidence: ConfidenceSchema,
    designRelationship: DesignRelationshipSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const decisionCount =
      Number(result.selectedJudgementStatementId !== undefined) +
      Number(result.fallbackStatus !== undefined);
    if (decisionCount !== 1) {
      context.addIssue({
        code: "custom",
        message: "exactly one selected judgement statement or fallback status is required",
        path: ["selectedJudgementStatementId"],
      });
    }
  });

export const CriterionSynthesisSchema = z
  .object({
    criterionId: ApplicationIdSchema,
    summary: NonEmptyTextSchema.max(4_000),
    improvement: z.string().trim().min(1).max(4_000).optional(),
    sourceEvidenceIds: z.array(ApplicationIdSchema).max(60),
  })
  .strict();

export const CriteriaSynthesisSchema = z
  .object({
    overallSummary: NonEmptyTextSchema.max(6_000),
    criteria: z.array(CriterionSynthesisSchema).min(1).max(50),
    crossCriterionObservations: z.array(NonEmptyTextSchema.max(4_000)).max(12),
    uncertainty: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict();

export const PassCompletionStateSchema = z.enum(["completed", "skipped"]);

export const TokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((usage, context) => {
    if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
      context.addIssue({
        code: "custom",
        message: "totalTokens must equal inputTokens plus outputTokens",
        path: ["totalTokens"],
      });
    }
  });

export const PassProvenanceSchema = z
  .object({
    passId: AnalysisPassIdSchema,
    state: PassCompletionStateSchema,
    attemptId: ApplicationIdSchema.optional(),
    attemptNumber: z.number().int().positive().optional(),
    modelConfiguration: ModelConfigurationSchema.optional(),
    promptVersion: z.string().trim().min(1).max(64),
    schemaVersion: z.string().trim().min(1).max(64),
    durationMs: z.number().int().nonnegative().optional(),
    usage: TokenUsageSchema.optional(),
    completedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((provenance, context) => {
    const executionFields = [
      provenance.attemptId,
      provenance.attemptNumber,
      provenance.modelConfiguration,
      provenance.durationMs,
    ];
    if (
      provenance.state === "completed" &&
      executionFields.some((field) => field === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "completed pass provenance requires attempt and execution metadata",
      });
    }
    if (
      provenance.state === "skipped" &&
      executionFields.some((field) => field !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "skipped pass provenance cannot contain execution metadata",
      });
    }
  });

export const DesignAnalysisSchema = z
  .object({
    id: ApplicationIdSchema,
    reviewId: ApplicationIdSchema,
    version: PositiveVersionSchema,
    createdAt: IsoDateTimeSchema,
    inputSnapshot: DesignAnalysisInputSnapshotSchema,
    passProvenance: z.array(PassProvenanceSchema).length(6),
    evidence: z.array(EvidenceItemSchema).max(500),
    findings: z.array(DesignFindingSchema).max(150),
    synthesis: DesignSynthesisSchema,
  })
  .strict()
  .superRefine((analysis, context) => {
    if (analysis.reviewId !== analysis.inputSnapshot.reviewId) {
      context.addIssue({
        code: "custom",
        message: "reviewId must match the immutable input snapshot",
        path: ["reviewId"],
      });
    }
    validateExactPasses(analysis.passProvenance, DesignPassIdSchema.options, context);
    validateArtifactProvenance(
      analysis.passProvenance,
      analysis.inputSnapshot.passConfigurations,
      analysis.inputSnapshot.context,
      context,
    );

    const imageIds = new Set(analysis.inputSnapshot.images.map(({ imageId }) => imageId));
    const reviewAreaIds = new Set(analysis.inputSnapshot.reviewAreas.map(({ areaId }) => areaId));
    const evidenceIds = new Set(analysis.evidence.map(({ id }) => id));
    const findingIds = new Set(analysis.findings.map(({ id }) => id));
    addDuplicateIssues(
      analysis.evidence.map(({ id }) => id),
      context,
      ["evidence"],
      "Design Analysis evidence IDs",
    );
    addDuplicateIssues(
      analysis.findings.map(({ id }) => id),
      context,
      ["findings"],
      "Design Analysis finding IDs",
    );
    analysis.evidence.forEach((evidence, index) => {
      addUnknownReferenceIssue(
        evidence.imageId,
        imageIds,
        context,
        ["evidence", index, "imageId"],
        "image",
      );
      addUnknownReferenceIssue(
        evidence.reviewAreaId,
        reviewAreaIds,
        context,
        ["evidence", index, "reviewAreaId"],
        "review area",
      );
    });
    analysis.findings.forEach((finding, index) => {
      finding.reviewAreaIds.forEach((areaId, areaIndex) =>
        addUnknownReferenceIssue(
          areaId,
          reviewAreaIds,
          context,
          ["findings", index, "reviewAreaIds", areaIndex],
          "review area",
        ),
      );
      finding.supportingEvidenceIds.forEach((evidenceId, evidenceIndex) =>
        addUnknownReferenceIssue(
          evidenceId,
          evidenceIds,
          context,
          ["findings", index, "supportingEvidenceIds", evidenceIndex],
          "evidence",
        ),
      );
    });

    const synthesisStatements = [
      analysis.synthesis.overallReading,
      ...analysis.synthesis.strengths,
      ...analysis.synthesis.developmentPriorities,
      ...Object.values(analysis.synthesis.majorReviewAreas ?? {}).flatMap(
        ({ strengths, areasForImprovement }) => [...strengths, ...areasForImprovement],
      ),
      ...analysis.synthesis.focusAreaFeedback,
      ...(analysis.synthesis.contextAlignment === undefined
        ? []
        : [analysis.synthesis.contextAlignment]),
      ...analysis.synthesis.nextSteps,
    ];
    synthesisStatements.forEach((statement, index) => {
      if (findingIds.size > 0 && statement.sourceFindingIds.length === 0) {
        context.addIssue({
          code: "custom",
          message: "synthesis statements must cite an adjudicated finding",
          path: ["synthesis", "statements", index, "sourceFindingIds"],
        });
      }
      statement.sourceFindingIds.forEach((findingId, findingIndex) =>
        addUnknownReferenceIssue(
          findingId,
          findingIds,
          context,
          ["synthesis", "statements", index, "sourceFindingIds", findingIndex],
          "adjudicated finding",
        ),
      );
    });

    const process = analysis.synthesis.conceptAndDevelopment;
    const hasDevelopmentImages = analysis.inputSnapshot.images.some(
      ({ analysisRole }) => analysisRole === "concept_development",
    );
    if (hasDevelopmentImages !== (process !== undefined)) {
      context.addIssue({
        code: "custom",
        message: hasDevelopmentImages
          ? "development images require concept-and-development synthesis"
          : "concept-and-development synthesis requires development images",
        path: ["synthesis", "conceptAndDevelopment"],
      });
    }
    if (process) {
      const roleByImageId = new Map(
        analysis.inputSnapshot.images.map(({ imageId, analysisRole }) => [
          imageId,
          analysisRole,
        ]),
      );
      const evidenceById = new Map(analysis.evidence.map((item) => [item.id, item]));
      const findingById = new Map(analysis.findings.map((item) => [item.id, item]));
      const rolesForFindingIds = (sourceFindingIds: string[]) => new Set(
        sourceFindingIds.flatMap((findingId) =>
          findingById.get(findingId)?.supportingEvidenceIds.flatMap((evidenceId) => {
            const evidence = evidenceById.get(evidenceId);
            const role = evidence ? roleByImageId.get(evidence.imageId) : undefined;
            return role ? [role] : [];
          }) ?? [],
        ),
      );
      const processStatements = [
        process.overallReading,
        ...process.strengths,
        ...process.developmentPriorities,
        ...process.relationshipToFinalWork,
      ];
      const hasProcessSupportedFinding = analysis.findings.some((finding) =>
        rolesForFindingIds([finding.id]).has("concept_development"),
      );
      processStatements.forEach((statement, index) => {
        const isNeutralOverall = index === 0 && !hasProcessSupportedFinding;
        if (statement.sourceFindingIds.length === 0 && !isNeutralOverall) {
          context.addIssue({
            code: "custom",
            message: "grounded process statements must cite a finding",
            path: ["synthesis", "conceptAndDevelopment", "statements", index],
          });
        }
        statement.sourceFindingIds.forEach((findingId, findingIndex) =>
          addUnknownReferenceIssue(
            findingId,
            findingIds,
            context,
            ["synthesis", "conceptAndDevelopment", "statements", index, "sourceFindingIds", findingIndex],
            "adjudicated finding",
          ),
        );
        if (
          statement.sourceFindingIds.length > 0 &&
          !rolesForFindingIds(statement.sourceFindingIds).has("concept_development")
        ) {
          context.addIssue({
            code: "custom",
            message: "process statements must cite development-image evidence",
            path: ["synthesis", "conceptAndDevelopment", "statements", index],
          });
        }
      });
      process.relationshipToFinalWork.forEach((statement, index) => {
        const roles = rolesForFindingIds(statement.sourceFindingIds);
        if (!roles.has("final_work") || !roles.has("concept_development")) {
          context.addIssue({
            code: "custom",
            message: "final-work relationship statements must cite both image roles",
            path: ["synthesis", "conceptAndDevelopment", "relationshipToFinalWork", index],
          });
        }
      });
    }

  });

export const CriteriaAnalysisSchema = z
  .object({
    id: ApplicationIdSchema,
    reviewId: ApplicationIdSchema,
    version: PositiveVersionSchema,
    designAnalysisId: ApplicationIdSchema,
    createdAt: IsoDateTimeSchema,
    inputSnapshot: CriteriaAnalysisInputSnapshotSchema,
    passProvenance: z.array(PassProvenanceSchema).length(5),
    results: z.array(CriterionResultSchema).min(1).max(50),
    synthesis: CriteriaSynthesisSchema,
  })
  .strict()
  .superRefine((analysis, context) => {
    if (analysis.reviewId !== analysis.inputSnapshot.reviewId) {
      context.addIssue({
        code: "custom",
        message: "reviewId must match the immutable input snapshot",
        path: ["reviewId"],
      });
    }
    if (analysis.designAnalysisId !== analysis.inputSnapshot.designAnalysisId) {
      context.addIssue({
        code: "custom",
        message: "designAnalysisId must match the immutable input snapshot",
        path: ["designAnalysisId"],
      });
    }
    validateExactPasses(analysis.passProvenance, CriteriaPassIdSchema.options, context);
    validateArtifactProvenance(
      analysis.passProvenance,
      analysis.inputSnapshot.passConfigurations,
      analysis.inputSnapshot.context,
      context,
    );

    const criteriaById = new Map(
      analysis.inputSnapshot.criteria.map((criterion) => [criterion.id, criterion]),
    );
    const expectedCriterionIds = new Set(criteriaById.keys());
    const actualCriterionIds = analysis.results.map(({ criterionId }) => criterionId);
    addDuplicateIssues(actualCriterionIds, context, ["results"], "criterion result IDs");
    for (const criterionId of expectedCriterionIds) {
      if (!actualCriterionIds.includes(criterionId)) {
        context.addIssue({
          code: "custom",
          message: `missing result for criterion '${criterionId}'`,
          path: ["results"],
        });
      }
    }

    const imageIds = new Set(analysis.inputSnapshot.images.map(({ imageId }) => imageId));
    const evidenceByCriterion = new Map<string, Set<string>>();
    analysis.results.forEach((result, index) => {
      const criterion = criteriaById.get(result.criterionId);
      if (criterion === undefined) {
        context.addIssue({
          code: "custom",
          message: `unknown criterion reference '${result.criterionId}'`,
          path: ["results", index, "criterionId"],
        });
        return;
      }
      const statementIds = new Set(criterion.judgementStatements.map(({ id }) => id));
      if (result.selectedJudgementStatementId !== undefined) {
        addUnknownReferenceIssue(
          result.selectedJudgementStatementId,
          statementIds,
          context,
          ["results", index, "selectedJudgementStatementId"],
          "judgement statement",
        );
      } else if (
        criterion.judgementStatements.length > 0 &&
        result.fallbackStatus !== "insufficient_evidence"
      ) {
        context.addIssue({
          code: "custom",
          message: "custom rubric wording must be used unless evidence is insufficient",
          path: ["results", index, "fallbackStatus"],
        });
      }

      const resultEvidence = [...result.supportingEvidence, ...result.counterEvidence];
      addDuplicateIssues(
        resultEvidence.map(({ id }) => id),
        context,
        ["results", index, "evidence"],
        "criterion evidence IDs",
      );
      evidenceByCriterion.set(result.criterionId, new Set(resultEvidence.map(({ id }) => id)));
      resultEvidence.forEach((evidence, evidenceIndex) => {
        if (evidence.criterionId !== result.criterionId) {
          context.addIssue({
            code: "custom",
            message: "criterion evidence must belong to its containing result",
            path: ["results", index, "evidence", evidenceIndex, "criterionId"],
          });
        }
        addUnknownReferenceIssue(
          evidence.imageId,
          imageIds,
          context,
          ["results", index, "evidence", evidenceIndex, "imageId"],
          "image",
        );
      });
    });

    const synthesisCriterionIds = analysis.synthesis.criteria.map(({ criterionId }) => criterionId);
    addDuplicateIssues(
      synthesisCriterionIds,
      context,
      ["synthesis", "criteria"],
      "synthesis criterion IDs",
    );
    for (const criterionId of expectedCriterionIds) {
      if (!synthesisCriterionIds.includes(criterionId)) {
        context.addIssue({
          code: "custom",
          message: `missing synthesis for criterion '${criterionId}'`,
          path: ["synthesis", "criteria"],
        });
      }
    }
    analysis.synthesis.criteria.forEach((criterion, index) => {
      addUnknownReferenceIssue(
        criterion.criterionId,
        expectedCriterionIds,
        context,
        ["synthesis", "criteria", index, "criterionId"],
        "criterion",
      );
      const evidenceIds = evidenceByCriterion.get(criterion.criterionId) ?? new Set<string>();
      criterion.sourceEvidenceIds.forEach((evidenceId, evidenceIndex) =>
        addUnknownReferenceIssue(
          evidenceId,
          evidenceIds,
          context,
          ["synthesis", "criteria", index, "sourceEvidenceIds", evidenceIndex],
          "criterion evidence",
        ),
      );
    });
  });

function validateArtifactProvenance(
  provenance: readonly z.infer<typeof PassProvenanceSchema>[],
  configurations: readonly z.infer<typeof PassConfigurationSnapshotSchema>[],
  contextText: string | null,
  context: z.RefinementCtx,
): void {
  const configurationsByPass = new Map(configurations.map((item) => [item.passId, item]));
  provenance.forEach((item, index) => {
    const configuration = configurationsByPass.get(item.passId);
    if (configuration === undefined) return;
    if (
      item.promptVersion !== configuration.promptVersion ||
      item.schemaVersion !== configuration.schemaVersion
    ) {
      context.addIssue({
        code: "custom",
        message: "pass provenance versions must match the immutable configuration",
        path: ["passProvenance", index],
      });
    }
    if (
      item.state === "completed" &&
      JSON.stringify(item.modelConfiguration) !==
        JSON.stringify(configuration.modelConfiguration)
    ) {
      context.addIssue({
        code: "custom",
        message: "pass provenance model configuration must match the input snapshot",
        path: ["passProvenance", index, "modelConfiguration"],
      });
    }
    const mayBeSkipped = item.passId === "D3" && contextText === null;
    if ((item.state === "skipped") !== mayBeSkipped) {
      context.addIssue({
        code: "custom",
        message: mayBeSkipped
          ? "D3 must be marked skipped when no context was supplied"
          : "only D3 without context may be skipped",
        path: ["passProvenance", index, "state"],
      });
    }
  });
}

function addUnknownReferenceIssue(
  reference: string,
  allowed: ReadonlySet<string>,
  context: z.RefinementCtx,
  path: PropertyKey[],
  label: string,
): void {
  if (!allowed.has(reference)) {
    context.addIssue({
      code: "custom",
      message: `unknown ${label} reference '${reference}'`,
      path,
    });
  }
}

export const AnalysisRunStateSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export const AnalysisPassStateSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "skipped",
  "interrupted",
]);
export const PassAttemptStateSchema = z.enum([
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export const AnalysisErrorCodeSchema = z.enum([
  "refusal",
  "content_filter",
  "authentication",
  "rate_limit",
  "service_unavailable",
  "timeout",
  "invalid_structure",
  "invalid_semantics",
  "cancelled",
  "database",
  "missing_images",
  "unknown",
]);

export const SafeAnalysisErrorSchema = z
  .object({
    code: AnalysisErrorCodeSchema,
    message: z.string().trim().min(1).max(500),
    retryable: z.boolean(),
    retryAfterMs: z.number().int().nonnegative().optional(),
  })
  .strict();

export const SafeApiMetadataSchema = z
  .object({
    requestId: z.string().trim().min(1).max(200).optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
  })
  .strict();

export const PassAttemptSchema = z
  .object({
    id: ApplicationIdSchema,
    analysisPassRecordId: ApplicationIdSchema,
    passId: AnalysisPassIdSchema,
    attemptNumber: z.number().int().positive(),
    state: PassAttemptStateSchema,
    configuration: PassConfigurationSnapshotSchema,
    startedAt: IsoDateTimeSchema,
    finishedAt: IsoDateTimeSchema.optional(),
    durationMs: z.number().int().nonnegative().optional(),
    apiMetadata: SafeApiMetadataSchema.optional(),
    usage: TokenUsageSchema.optional(),
    validatedOutput: JsonValueSchema.optional(),
    error: SafeAnalysisErrorSchema.optional(),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.passId !== attempt.configuration.passId) {
      context.addIssue({
        code: "custom",
        message: "configuration passId must match the attempt passId",
        path: ["configuration", "passId"],
      });
    }

    if (attempt.state === "running") {
      if (
        attempt.finishedAt !== undefined ||
        attempt.durationMs !== undefined ||
        attempt.validatedOutput !== undefined ||
        attempt.error !== undefined
      ) {
        context.addIssue({
          code: "custom",
          message: "a running attempt cannot have terminal fields",
        });
      }
      return;
    }

    if (attempt.finishedAt === undefined || attempt.durationMs === undefined) {
      context.addIssue({
        code: "custom",
        message: "a terminal attempt requires finishedAt and durationMs",
      });
    }
    if (attempt.state === "completed") {
      if (attempt.validatedOutput === undefined || attempt.error !== undefined) {
        context.addIssue({
          code: "custom",
          message: "a completed attempt requires validated output and no error",
          path: ["validatedOutput"],
        });
      }
    } else if (attempt.validatedOutput !== undefined) {
      context.addIssue({
        code: "custom",
        message: "only a completed attempt may contain validated output",
        path: ["validatedOutput"],
      });
    }
    if (attempt.state === "failed" && attempt.error === undefined) {
      context.addIssue({
        code: "custom",
        message: "a failed attempt requires a safe error",
        path: ["error"],
      });
    }
  });

export const AnalysisPassRecordSchema = z
  .object({
    id: ApplicationIdSchema,
    runId: ApplicationIdSchema,
    passId: AnalysisPassIdSchema,
    state: AnalysisPassStateSchema,
    attemptCount: z.number().int().nonnegative(),
    currentAttemptId: ApplicationIdSchema.optional(),
    createdAt: IsoDateTimeSchema,
    startedAt: IsoDateTimeSchema.optional(),
    finishedAt: IsoDateTimeSchema.optional(),
    skipReason: ShortTextSchema.optional(),
    error: SafeAnalysisErrorSchema.optional(),
  })
  .strict()
  .superRefine((pass, context) => {
    if (pass.state === "pending" && pass.attemptCount !== 0 && pass.currentAttemptId === undefined) {
      context.addIssue({
        code: "custom",
        message: "a retried pending pass must retain its most recent attempt reference",
        path: ["currentAttemptId"],
      });
    }
    if (pass.state === "running" && (pass.startedAt === undefined || pass.currentAttemptId === undefined)) {
      context.addIssue({
        code: "custom",
        message: "a running pass requires startedAt and currentAttemptId",
      });
    }
    if (pass.state === "skipped" && pass.skipReason === undefined) {
      context.addIssue({
        code: "custom",
        message: "a skipped pass requires a skip reason",
        path: ["skipReason"],
      });
    }
    if (pass.state !== "skipped" && pass.skipReason !== undefined) {
      context.addIssue({
        code: "custom",
        message: "skipReason is only valid for a skipped pass",
        path: ["skipReason"],
      });
    }
    if (pass.state === "failed" && pass.error === undefined) {
      context.addIssue({
        code: "custom",
        message: "a failed pass requires a safe error",
        path: ["error"],
      });
    }
  });

export const AnalysisRunSchema = z
  .object({
    id: ApplicationIdSchema,
    kind: AnalysisKindSchema,
    reviewId: ApplicationIdSchema,
    selectedDesignAnalysisId: ApplicationIdSchema.optional(),
    inputSnapshot: AnalysisInputSnapshotSchema,
    state: AnalysisRunStateSchema,
    cancelRequested: z.boolean(),
    leaseOwner: ApplicationIdSchema.optional(),
    leaseExpiresAt: IsoDateTimeSchema.optional(),
    error: SafeAnalysisErrorSchema.optional(),
    createdAt: IsoDateTimeSchema,
    startedAt: IsoDateTimeSchema.optional(),
    finishedAt: IsoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.kind !== run.inputSnapshot.kind) {
      context.addIssue({
        code: "custom",
        message: "run kind must match the input snapshot kind",
        path: ["kind"],
      });
    }
    if (run.reviewId !== run.inputSnapshot.reviewId) {
      context.addIssue({
        code: "custom",
        message: "run reviewId must match the input snapshot reviewId",
        path: ["reviewId"],
      });
    }
    if (run.kind === "criteria" && run.inputSnapshot.kind === "criteria") {
      if (
        run.selectedDesignAnalysisId === undefined ||
        run.selectedDesignAnalysisId !== run.inputSnapshot.designAnalysisId
      ) {
        context.addIssue({
          code: "custom",
          message: "a criteria run must reference the Design Analysis in its snapshot",
          path: ["selectedDesignAnalysisId"],
        });
      }
    } else if (run.selectedDesignAnalysisId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "a design run cannot select a prior Design Analysis",
        path: ["selectedDesignAnalysisId"],
      });
    }

    const hasLeaseOwner = run.leaseOwner !== undefined;
    const hasLeaseExpiry = run.leaseExpiresAt !== undefined;
    if (hasLeaseOwner !== hasLeaseExpiry) {
      context.addIssue({
        code: "custom",
        message: "leaseOwner and leaseExpiresAt must be set together",
        path: ["leaseOwner"],
      });
    }
    if (hasLeaseOwner && run.state !== "running") {
      context.addIssue({
        code: "custom",
        message: "only a running analysis can hold a worker lease",
        path: ["leaseOwner"],
      });
    }

    if (run.state === "queued") {
      if (run.startedAt !== undefined || run.finishedAt !== undefined || run.error !== undefined) {
        context.addIssue({ code: "custom", message: "a queued run cannot have terminal fields" });
      }
    } else if (run.state === "running") {
      if (run.startedAt === undefined || run.finishedAt !== undefined || run.error !== undefined) {
        context.addIssue({ code: "custom", message: "a running run requires only startedAt" });
      }
    } else {
      if (run.finishedAt === undefined) {
        context.addIssue({
          code: "custom",
          message: "a terminal run requires finishedAt",
          path: ["finishedAt"],
        });
      }
      if (run.state === "failed" && run.error === undefined) {
        context.addIssue({
          code: "custom",
          message: "a failed run requires a safe error",
          path: ["error"],
        });
      }
    }
  });

const RUN_TRANSITIONS: Readonly<Record<z.infer<typeof AnalysisRunStateSchema>, readonly string[]>> = {
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled", "interrupted"],
  completed: [],
  failed: ["queued"],
  cancelled: [],
  interrupted: ["queued"],
};

const PASS_TRANSITIONS: Readonly<Record<z.infer<typeof AnalysisPassStateSchema>, readonly string[]>> = {
  pending: ["running", "skipped", "cancelled"],
  running: ["completed", "failed", "cancelled", "interrupted"],
  completed: [],
  failed: ["pending"],
  cancelled: [],
  skipped: [],
  interrupted: ["pending"],
};

export function canTransitionAnalysisRun(
  from: z.infer<typeof AnalysisRunStateSchema>,
  to: z.infer<typeof AnalysisRunStateSchema>,
): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function assertAnalysisRunTransition(
  from: z.infer<typeof AnalysisRunStateSchema>,
  to: z.infer<typeof AnalysisRunStateSchema>,
): void {
  if (!canTransitionAnalysisRun(from, to)) {
    throw new Error(`Invalid analysis-run transition: ${from} -> ${to}`);
  }
}

export function canTransitionAnalysisPass(
  from: z.infer<typeof AnalysisPassStateSchema>,
  to: z.infer<typeof AnalysisPassStateSchema>,
): boolean {
  return PASS_TRANSITIONS[from].includes(to);
}

export function assertAnalysisPassTransition(
  from: z.infer<typeof AnalysisPassStateSchema>,
  to: z.infer<typeof AnalysisPassStateSchema>,
): void {
  if (!canTransitionAnalysisPass(from, to)) {
    throw new Error(`Invalid analysis-pass transition: ${from} -> ${to}`);
  }
}

export function assertCriteriaSnapshotMatchesDesignSnapshot(
  criteriaInput: unknown,
  designInput: unknown,
): void {
  const criteria = CriteriaAnalysisInputSnapshotSchema.parse(criteriaInput);
  const design = DesignAnalysisInputSnapshotSchema.parse(designInput);
  const criteriaManifest = JSON.stringify(criteria.images);
  const designManifest = JSON.stringify(design.images);
  const criteriaAreas = JSON.stringify(criteria.reviewAreas);
  const designAreas = JSON.stringify(design.reviewAreas);

  if (criteria.reviewId !== design.reviewId) {
    throw new Error("Criteria and Design Analysis snapshots belong to different reviews");
  }
  if (criteria.imageRevisionId !== design.imageRevisionId || criteriaManifest !== designManifest) {
    throw new Error("Criteria Analysis must use the Design Analysis image revision");
  }
  if (criteria.context !== design.context) {
    throw new Error("Criteria Analysis must use the Design Analysis context snapshot");
  }
  if (criteriaAreas !== designAreas) {
    throw new Error("Criteria Analysis must preserve the Design Analysis review-area snapshot");
  }
}

export function parseImmutableDesignAnalysisInputSnapshot(
  input: unknown,
): DeepReadonly<z.infer<typeof DesignAnalysisInputSnapshotSchema>> {
  return deepFreeze(DesignAnalysisInputSnapshotSchema.parse(input));
}

export function parseImmutableCriteriaAnalysisInputSnapshot(
  input: unknown,
): DeepReadonly<z.infer<typeof CriteriaAnalysisInputSnapshotSchema>> {
  return deepFreeze(CriteriaAnalysisInputSnapshotSchema.parse(input));
}

export function parseImmutableDesignAnalysis(
  input: unknown,
): DeepReadonly<z.infer<typeof DesignAnalysisSchema>> {
  return deepFreeze(DesignAnalysisSchema.parse(input));
}

export function parseImmutableCriteriaAnalysis(
  input: unknown,
): DeepReadonly<z.infer<typeof CriteriaAnalysisSchema>> {
  return deepFreeze(CriteriaAnalysisSchema.parse(input));
}

export type AnalysisPassId = z.infer<typeof AnalysisPassIdSchema>;
export type DesignPassId = z.infer<typeof DesignPassIdSchema>;
export type CriteriaPassId = z.infer<typeof CriteriaPassIdSchema>;
export type ModelConfiguration = z.infer<typeof ModelConfigurationSchema>;
export type PassConfigurationSnapshot = z.infer<typeof PassConfigurationSnapshotSchema>;
export type OperationalLimits = z.infer<typeof OperationalLimitsSchema>;
export type DesignAnalysisInputSnapshot = z.infer<typeof DesignAnalysisInputSnapshotSchema>;
export type CriteriaAnalysisInputSnapshot = z.infer<typeof CriteriaAnalysisInputSnapshotSchema>;
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type CandidateDesignFinding = z.infer<typeof CandidateDesignFindingSchema>;
export type ContextAlignmentRecord = z.infer<typeof ContextAlignmentRecordSchema>;
export type DesignChallenge = z.infer<typeof DesignChallengeSchema>;
export type DesignFinding = z.infer<typeof DesignFindingSchema>;
export type AdjudicationDecision = z.infer<typeof AdjudicationDecisionSchema>;
export type MajorReviewAreaAnalysis = z.infer<typeof MajorReviewAreaAnalysisSchema>;
export type MajorReviewAreasAnalysis = z.infer<typeof MajorReviewAreasAnalysisSchema>;
export type DesignSynthesis = z.infer<typeof DesignSynthesisSchema>;
export type ConceptDevelopmentAnalysis = z.infer<typeof ConceptDevelopmentAnalysisSchema>;
export type CriterionEvidence = z.infer<typeof CriterionEvidenceSchema>;
export type CriterionEvidenceSearch = z.infer<typeof CriterionEvidenceSearchSchema>;
export type CriterionComparison = z.infer<typeof CriterionComparisonSchema>;
export type CriterionChallenge = z.infer<typeof CriterionChallengeSchema>;
export type CriterionResult = z.infer<typeof CriterionResultSchema>;
export type CriteriaSynthesis = z.infer<typeof CriteriaSynthesisSchema>;
export type DesignAnalysis = z.infer<typeof DesignAnalysisSchema>;
export type CriteriaAnalysis = z.infer<typeof CriteriaAnalysisSchema>;
export type AnalysisRunState = z.infer<typeof AnalysisRunStateSchema>;
export type AnalysisPassState = z.infer<typeof AnalysisPassStateSchema>;
export type AnalysisErrorCode = z.infer<typeof AnalysisErrorCodeSchema>;
export type SafeAnalysisError = z.infer<typeof SafeAnalysisErrorSchema>;
export type SafeApiMetadata = z.infer<typeof SafeApiMetadataSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type PassAttempt = z.infer<typeof PassAttemptSchema>;
export type AnalysisPassRecord = z.infer<typeof AnalysisPassRecordSchema>;
export type AnalysisRun = z.infer<typeof AnalysisRunSchema>;
