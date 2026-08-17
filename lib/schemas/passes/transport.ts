import { z } from "zod";

import {
  AdversarialStatusSchema,
  ContextAlignmentStatusSchema,
  CriterionAssessabilitySchema,
  ConceptDevelopmentAnalysisSchema,
  DesignRelationshipSchema,
  FallbackCriterionStatusSchema,
  JudgementFitSchema,
  MajorReviewAreaAnalysisSchema,
} from "@/lib/domain/analysis";
import {
  ApplicationIdSchema,
  ConfidenceSchema,
  NonEmptyTextSchema,
  SignificanceSchema,
} from "@/lib/domain/common";

export const TransportLocalRefSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, "must be a local ordinal reference");

export const D1TransportObservationSchema = z
  .object({
    localRef: TransportLocalRefSchema,
    imageId: ApplicationIdSchema,
    regionDescription: z.string().min(1).max(500).nullable(),
    reviewAreaId: ApplicationIdSchema,
    observation: NonEmptyTextSchema.max(4_000),
    confidence: ConfidenceSchema,
    uncertainty: z.string().min(1).max(2_000).nullable(),
  })
  .strict();

export const D1TransportOutputSchema = z
  .object({ observations: z.array(D1TransportObservationSchema).max(500) })
  .strict();

export const D2TransportFindingSchema = z
  .object({
    localRef: TransportLocalRefSchema,
    reviewAreaIds: z.array(ApplicationIdSchema).min(1).max(12),
    observation: NonEmptyTextSchema.max(4_000),
    interpretation: NonEmptyTextSchema.max(4_000),
    likelyEffect: z.string().min(1).max(4_000).nullable(),
    supportingEvidenceIds: z.array(ApplicationIdSchema).min(1).max(30),
    significance: SignificanceSchema,
    confidence: ConfidenceSchema,
    focusRelated: z.boolean(),
  })
  .strict();

export const D2TransportOutputSchema = z
  .object({ findings: z.array(D2TransportFindingSchema).max(150) })
  .strict();

export const D3TransportAlignmentSchema = z
  .object({
    localRef: TransportLocalRefSchema,
    findingId: ApplicationIdSchema,
    status: ContextAlignmentStatusSchema,
    alignment: NonEmptyTextSchema.max(4_000),
    alternativeInterpretation: z.string().min(1).max(4_000).nullable(),
    uncertainty: z.string().min(1).max(2_000).nullable(),
  })
  .strict();

export const D3TransportOutputSchema = z
  .object({ alignments: z.array(D3TransportAlignmentSchema).max(150) })
  .strict();

export const D4TransportChallengeSchema = z
  .object({
    localRef: TransportLocalRefSchema,
    findingId: ApplicationIdSchema,
    status: AdversarialStatusSchema,
    counterEvidence: z.array(NonEmptyTextSchema.max(2_000)).max(12),
    alternativeInterpretation: z.string().min(1).max(4_000).nullable(),
    qualification: z.string().min(1).max(4_000).nullable(),
    rationaleSummary: NonEmptyTextSchema.max(4_000),
  })
  .strict();

export const D4TransportOutputSchema = z
  .object({ challenges: z.array(D4TransportChallengeSchema).max(150) })
  .strict();

export const D5TransportResultingFindingSchema = z
  .object({
    reviewAreaIds: z.array(ApplicationIdSchema).min(1).max(12),
    observation: NonEmptyTextSchema.max(4_000),
    interpretation: NonEmptyTextSchema.max(4_000),
    likelyEffect: z.string().min(1).max(4_000).nullable(),
    supportingEvidenceIds: z.array(ApplicationIdSchema).min(1).max(30),
    contextAlignment: z.string().min(1).max(4_000).nullable(),
    alternativeInterpretation: z.string().min(1).max(4_000).nullable(),
    significance: SignificanceSchema,
    confidence: ConfidenceSchema,
    focusRelated: z.boolean(),
    adversarialStatus: AdversarialStatusSchema,
  })
  .strict();

const D5TransportDecisionBaseShape = {
  localRef: TransportLocalRefSchema,
  sourceFindingIds: z.array(ApplicationIdSchema).min(1).max(20),
  rationaleSummary: NonEmptyTextSchema.max(4_000),
};

export const D5TransportDecisionSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...D5TransportDecisionBaseShape,
      action: z.literal("retain"),
      resultingFinding: D5TransportResultingFindingSchema,
    })
    .strict(),
  z
    .object({
      ...D5TransportDecisionBaseShape,
      action: z.literal("modify"),
      resultingFinding: D5TransportResultingFindingSchema,
    })
    .strict(),
  z
    .object({
      ...D5TransportDecisionBaseShape,
      action: z.literal("merge"),
      resultingFinding: D5TransportResultingFindingSchema,
    })
    .strict(),
  z
    .object({
      ...D5TransportDecisionBaseShape,
      action: z.literal("reject"),
      resultingFinding: z.null(),
    })
    .strict(),
]);

export const D5TransportOutputSchema = z
  .object({ decisions: z.array(D5TransportDecisionSchema).max(150) })
  .strict();

export const D6TransportStatementSchema = z
  .object({
    text: NonEmptyTextSchema.max(4_000),
    sourceFindingIds: z.array(ApplicationIdSchema).max(20),
  })
  .strict();

const D6TransportMajorReviewAreaSchema = MajorReviewAreaAnalysisSchema;

export const D6TransportOutputSchema = z
  .object({
    synthesis: z
      .object({
        overallReading: D6TransportStatementSchema,
        strengths: z.array(D6TransportStatementSchema).max(12),
        developmentPriorities: z.array(D6TransportStatementSchema).max(12),
        majorReviewAreas: z
          .object({
            elementsOfDesign: D6TransportMajorReviewAreaSchema,
            principlesOfDesign: D6TransportMajorReviewAreaSchema,
            appliedVisualCommunication: D6TransportMajorReviewAreaSchema,
          })
          .strict(),
        conceptAndDevelopment: ConceptDevelopmentAnalysisSchema.nullable(),
        focusAreaFeedback: z.array(D6TransportStatementSchema).max(20),
        contextAlignment: D6TransportStatementSchema.nullable(),
        nextSteps: z.array(D6TransportStatementSchema).max(12),
        uncertainty: z.string().min(1).max(4_000).nullable(),
      })
      .strict(),
  })
  .strict();

export const C1TransportEvidenceSchema = z
  .object({
    localRef: TransportLocalRefSchema,
    imageId: ApplicationIdSchema,
    regionDescription: z.string().min(1).max(500).nullable(),
    observation: NonEmptyTextSchema.max(4_000),
    designFindingIds: z.array(ApplicationIdSchema).max(20),
  })
  .strict();

export const C1TransportCriterionSchema = z
  .object({
    criterionId: ApplicationIdSchema,
    assessability: CriterionAssessabilitySchema,
    assessabilityRationale: NonEmptyTextSchema.max(4_000),
    supportingEvidence: z.array(C1TransportEvidenceSchema).max(30),
    counterEvidence: z.array(C1TransportEvidenceSchema).max(30),
    relevantContext: z.string().min(1).max(4_000).nullable(),
    designFindingIds: z.array(ApplicationIdSchema).max(30),
    uncertainty: z.string().min(1).max(2_000).nullable(),
  })
  .strict();

export const C1TransportOutputSchema = z
  .object({ criteria: z.array(C1TransportCriterionSchema).min(1).max(50) })
  .strict();

export const TransportStatementComparisonSchema = z
  .object({
    judgementStatementId: ApplicationIdSchema,
    fit: JudgementFitSchema,
    rationale: NonEmptyTextSchema.max(4_000),
  })
  .strict();

export const C2TransportComparisonSchema = z
  .object({
    criterionId: ApplicationIdSchema,
    evidenceIds: z.array(ApplicationIdSchema).max(60),
    statementComparisons: z.array(TransportStatementComparisonSchema).max(20),
    selectedJudgementStatementId: ApplicationIdSchema.nullable(),
    fallbackStatus: FallbackCriterionStatusSchema.nullable(),
    adjacentStatementReasons: z.array(TransportStatementComparisonSchema).max(2),
    rationale: NonEmptyTextSchema.max(4_000),
    confidence: ConfidenceSchema,
  })
  .strict();

export const C2TransportOutputSchema = z
  .object({ comparisons: z.array(C2TransportComparisonSchema).min(1).max(50) })
  .strict();

export const C3TransportChallengeSchema = z
  .object({
    criterionId: ApplicationIdSchema,
    status: AdversarialStatusSchema,
    alternateJudgementStatementId: ApplicationIdSchema.nullable(),
    alternateFallbackStatus: FallbackCriterionStatusSchema.nullable(),
    evidenceIds: z.array(ApplicationIdSchema).max(60),
    scopeCheck: NonEmptyTextSchema.max(4_000),
    contextBiasCheck: NonEmptyTextSchema.max(4_000),
    designComplianceTension: NonEmptyTextSchema.max(4_000),
    qualification: z.string().min(1).max(4_000).nullable(),
  })
  .strict();

export const C3TransportOutputSchema = z
  .object({ challenges: z.array(C3TransportChallengeSchema).min(1).max(50) })
  .strict();

export const C4TransportResultSchema = z
  .object({
    criterionId: ApplicationIdSchema,
    supportingEvidenceIds: z.array(ApplicationIdSchema).max(30),
    counterEvidenceIds: z.array(ApplicationIdSchema).max(30),
    selectedJudgementStatementId: ApplicationIdSchema.nullable(),
    fallbackStatus: FallbackCriterionStatusSchema.nullable(),
    rationale: NonEmptyTextSchema.max(4_000),
    alternativeJudgement: z.string().min(1).max(4_000).nullable(),
    confidence: ConfidenceSchema,
    designRelationship: DesignRelationshipSchema,
  })
  .strict();

export const C4TransportOutputSchema = z
  .object({ results: z.array(C4TransportResultSchema).min(1).max(50) })
  .strict();

export const C5TransportCriterionSynthesisSchema = z
  .object({
    criterionId: ApplicationIdSchema,
    summary: NonEmptyTextSchema.max(4_000),
    improvement: z.string().min(1).max(4_000).nullable(),
    sourceEvidenceIds: z.array(ApplicationIdSchema).max(60),
  })
  .strict();

export const C5TransportOutputSchema = z
  .object({
    synthesis: z
      .object({
        overallSummary: NonEmptyTextSchema.max(6_000),
        criteria: z.array(C5TransportCriterionSynthesisSchema).min(1).max(50),
        crossCriterionObservations: z.array(NonEmptyTextSchema.max(4_000)).max(12),
        uncertainty: z.string().min(1).max(4_000).nullable(),
      })
      .strict(),
  })
  .strict();

export const TransportPassOutputSchemas = {
  D1: D1TransportOutputSchema,
  D2: D2TransportOutputSchema,
  D3: D3TransportOutputSchema,
  D4: D4TransportOutputSchema,
  D5: D5TransportOutputSchema,
  D6: D6TransportOutputSchema,
  C1: C1TransportOutputSchema,
  C2: C2TransportOutputSchema,
  C3: C3TransportOutputSchema,
  C4: C4TransportOutputSchema,
  C5: C5TransportOutputSchema,
} as const;

export type D1TransportOutput = z.infer<typeof D1TransportOutputSchema>;
export type D2TransportOutput = z.infer<typeof D2TransportOutputSchema>;
export type D3TransportOutput = z.infer<typeof D3TransportOutputSchema>;
export type D4TransportOutput = z.infer<typeof D4TransportOutputSchema>;
export type D5TransportOutput = z.infer<typeof D5TransportOutputSchema>;
export type D6TransportOutput = z.infer<typeof D6TransportOutputSchema>;
export type C1TransportOutput = z.infer<typeof C1TransportOutputSchema>;
export type C2TransportOutput = z.infer<typeof C2TransportOutputSchema>;
export type C3TransportOutput = z.infer<typeof C3TransportOutputSchema>;
export type C4TransportOutput = z.infer<typeof C4TransportOutputSchema>;
export type C5TransportOutput = z.infer<typeof C5TransportOutputSchema>;
