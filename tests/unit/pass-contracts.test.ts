import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { DesignSynthesisSchema, type AnalysisPassId } from "@/lib/domain";
import {
  C1TransportOutputSchema,
  C2TransportOutputSchema,
  C4TransportOutputSchema,
  D1TransportOutputSchema,
  D5TransportOutputSchema,
  D6TransportOutputSchema,
  DomainPassOutputSchemas,
  ReferenceValidationError,
  TransportPassOutputSchemas,
  materialiseC1Output,
  materialiseC2Output,
  materialiseC4Output,
  materialiseD1Output,
  materialiseD2Output,
  materialiseD5Output,
  materialiseD6Output,
  validateC1References,
  validateC2References,
  validateC4References,
  validateD1References,
  validateD2References,
  validateD5References,
  validateD6References,
} from "@/lib/schemas";

const NOW = "2026-08-15T02:00:00.000Z";
const modelConfiguration = {
  provider: "openai" as const,
  model: "configured-model",
  imageDetail: "original" as const,
  reasoningEffort: "medium" as const,
  store: false as const,
};
const limits = {
  maximumImages: 10,
  maximumBytesPerImage: 10_000_000,
  maximumPixelsPerImage: 30_000_000,
  maximumAggregateUploadBytes: 50_000_000,
  maximumContextCharacters: 20_000,
  maximumCriteria: 20,
  maximumJudgementStatementsPerCriterion: 10,
  maximumPassAttempts: 3,
  passTimeoutMs: 120_000,
  runTimeoutMs: 900_000,
  maximumOutputTokensPerPass: 8_000,
};
const image = {
  imageId: "image-1",
  order: 0,
  sanitizedDigest: "a".repeat(64),
  mimeType: "image/png" as const,
  width: 1200,
  height: 800,
  byteSize: 50_000,
};
const area = {
  taxonomyId: "visual-communication-design",
  taxonomyVersion: "1.0.0",
  areaId: "typography.hierarchy",
  areaLabel: "Typographic hierarchy",
  mode: "focus" as const,
};
const passConfigurations = (passIds: readonly AnalysisPassId[]) =>
  passIds.map((passId) => ({
    passId,
    modelConfiguration,
    promptVersion: "1.0.0",
    schemaVersion: "1.0.0",
  }));
const designSnapshot = {
  kind: "design" as const,
  reviewId: "review-1",
  imageRevisionId: "revision-1",
  context: "An event poster.",
  images: [image],
  reviewAreas: [area],
  passConfigurations: passConfigurations(["D1", "D2", "D3", "D4", "D5", "D6"]),
  operationalLimits: limits,
  capturedAt: NOW,
};
const criterion = {
  id: "criterion-1",
  title: "Hierarchy",
  statement: "Uses hierarchy to guide the reader.",
  judgementStatements: [
    {
      id: "statement-1",
      label: "Demonstrated",
      description: "The order is clear.",
      order: 0,
    },
    {
      id: "statement-2",
      label: "Partly demonstrated",
      description: "The order is inconsistent.",
      order: 1,
    },
  ],
  order: 0,
};
const criteriaSnapshot = {
  kind: "criteria" as const,
  reviewId: "review-1",
  imageRevisionId: "revision-1",
  designAnalysisId: "design-analysis-1",
  designAnalysisVersion: 1,
  context: designSnapshot.context,
  images: [image],
  reviewAreas: [area],
  criteria: [criterion],
  passConfigurations: passConfigurations(["C1", "C2", "C3", "C4", "C5"]),
  operationalLimits: limits,
  capturedAt: NOW,
};

const idFactory = ({ entity, ordinal }: { entity: string; ordinal: number }) =>
  `run-1.${entity}.${ordinal}`;

const d1Transport = {
  observations: [
    {
      localRef: "observation_1",
      imageId: "image-1",
      regionDescription: "upper-left headline",
      reviewAreaId: "typography.hierarchy",
      observation: "The headline is larger and heavier than the supporting text.",
      confidence: "high" as const,
      uncertainty: null,
    },
  ],
};

describe("strict Structured Outputs transport contracts", () => {
  it("requires nullable fields to be present and rejects extra model keys", () => {
    expect(D1TransportOutputSchema.safeParse(d1Transport).success).toBe(true);
    const observation = d1Transport.observations[0]!;
    const withoutRequiredNullable = {
      localRef: observation.localRef,
      imageId: observation.imageId,
      regionDescription: observation.regionDescription,
      reviewAreaId: observation.reviewAreaId,
      observation: observation.observation,
      confidence: observation.confidence,
    };
    expect(
      D1TransportOutputSchema.safeParse({ observations: [withoutRequiredNullable] }).success,
    ).toBe(false);
    expect(
      D1TransportOutputSchema.safeParse({
        observations: [{ ...d1Transport.observations[0], score: 92 }],
      }).success,
    ).toBe(false);
  });

  it("publishes a separate strict transport and domain schema for every pass", () => {
    expect(Object.keys(TransportPassOutputSchemas)).toEqual([
      "D1",
      "D2",
      "D3",
      "D4",
      "D5",
      "D6",
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
    ]);
    expect(Object.keys(DomainPassOutputSchemas)).toEqual(Object.keys(TransportPassOutputSchemas));
  });

  it("converts to a strict JSON Schema with nullable fields still required", () => {
    const schema = z.toJSONSchema(D1TransportOutputSchema) as {
      additionalProperties?: boolean;
      properties?: {
        observations?: {
          items?: { additionalProperties?: boolean; required?: string[] };
        };
      };
    };
    const observationSchema = schema.properties?.observations?.items;
    expect(schema.additionalProperties).toBe(false);
    expect(observationSchema?.additionalProperties).toBe(false);
    expect(observationSchema?.required).toContain("regionDescription");
    expect(observationSchema?.required).toContain("uncertainty");
  });

  it("enforces the D5 action and resulting-finding invariant in the transport schema", () => {
    const sharedDecision = {
      localRef: "decision_1",
      sourceFindingIds: ["finding-1"],
      rationaleSummary: "The visible evidence supports this decision.",
    };
    const resultingFinding = {
      reviewAreaIds: ["typography.hierarchy"],
      observation: "The headline is visibly dominant.",
      interpretation: "It establishes the primary entry point.",
      likelyEffect: "Readers are likely to see the headline first.",
      supportingEvidenceIds: ["evidence-1"],
      contextAlignment: null,
      alternativeInterpretation: null,
      significance: "major" as const,
      confidence: "high" as const,
      focusRelated: true,
      adversarialStatus: "confirmed" as const,
    };

    expect(
      D5TransportOutputSchema.safeParse({
        decisions: [{ ...sharedDecision, action: "reject", resultingFinding: null }],
      }).success,
    ).toBe(true);
    expect(
      D5TransportOutputSchema.safeParse({
        decisions: [{ ...sharedDecision, action: "retain", resultingFinding }],
      }).success,
    ).toBe(true);
    expect(
      D5TransportOutputSchema.safeParse({
        decisions: [{ ...sharedDecision, action: "reject", resultingFinding }],
      }).success,
    ).toBe(false);
    expect(
      D5TransportOutputSchema.safeParse({
        decisions: [{ ...sharedDecision, action: "retain", resultingFinding: null }],
      }).success,
    ).toBe(false);

    const responseFormat = zodTextFormat(D5TransportOutputSchema, "d5_adjudication");
    expect(responseFormat.type).toBe("json_schema");
    expect(responseFormat.strict).toBe(true);
    expect(responseFormat.schema).toMatchObject({ type: "object" });
  });

  it("keeps structurally valid nullable decisions for semantic/domain validation", () => {
    expect(
      C2TransportOutputSchema.safeParse({
        comparisons: [
          {
            criterionId: "criterion-1",
            evidenceIds: [],
            statementComparisons: [],
            selectedJudgementStatementId: null,
            fallbackStatus: null,
            adjacentStatementReasons: [],
            rationale: "No decision was returned.",
            confidence: "low",
          },
        ],
      }).success,
    ).toBe(true);
    expect(() =>
      materialiseC2Output({
        comparisons: [
          {
            criterionId: "criterion-1",
            evidenceIds: [],
            statementComparisons: [],
            selectedJudgementStatementId: null,
            fallbackStatus: null,
            adjacentStatementReasons: [],
            rationale: "No decision was returned.",
            confidence: "low",
          },
        ],
      }),
    ).toThrow();
  });

  it("keeps the new category section optional only for earlier persisted artifacts", () => {
    expect(
      DesignSynthesisSchema.safeParse({
        overallReading: { text: "Earlier analysis", sourceFindingIds: [] },
        strengths: [],
        developmentPriorities: [],
        focusAreaFeedback: [],
        nextSteps: [],
      }).success,
    ).toBe(true);

    expect(
      D6TransportOutputSchema.safeParse({
        synthesis: {
          overallReading: { text: "Current analysis", sourceFindingIds: [] },
          strengths: [],
          developmentPriorities: [],
          focusAreaFeedback: [],
          contextAlignment: null,
          nextSteps: [],
          uncertainty: null,
        },
      }).success,
    ).toBe(false);
  });
});

describe("application-generated IDs and Design pass references", () => {
  it("assigns canonical IDs after transport parsing", () => {
    const d1 = materialiseD1Output(d1Transport, idFactory);
    expect(d1.observations[0]?.id).toBe("run-1.evidence.0");
    expect(d1.observations[0]).not.toHaveProperty("localRef");
    expect(validateD1References(d1, designSnapshot)).toStrictEqual(d1);
  });

  it("replaces repeated model-local references with unique canonical IDs", () => {
    const output = materialiseD1Output(
      {
        observations: [
          d1Transport.observations[0],
          { ...d1Transport.observations[0] },
        ],
      },
      idFactory,
    );

    expect(output.observations.map(({ id }) => id)).toEqual([
      "run-1.evidence.0",
      "run-1.evidence.1",
    ]);
    expect(new Set(output.observations.map(({ id }) => id))).toHaveLength(2);
  });

  it("rejects a cross-pass reference that was not application supplied", () => {
    const d1 = materialiseD1Output(d1Transport, idFactory);
    const d2 = materialiseD2Output(
      {
        findings: [
          {
            localRef: "finding_1",
            reviewAreaIds: ["typography.hierarchy"],
            observation: "The headline dominates the composition.",
            interpretation: "A clear entry point is established.",
            likelyEffect: "Viewers are likely to read the title first.",
            supportingEvidenceIds: ["fabricated-evidence"],
            significance: "major",
            confidence: "high",
            focusRelated: true,
          },
        ],
      },
      idFactory,
    );

    expect(() => validateD2References(d2, d1, designSnapshot)).toThrow(
      ReferenceValidationError,
    );
  });

  it("requires D5 to cover each candidate exactly once and preserves rejected findings as null", () => {
    const d1 = materialiseD1Output(d1Transport, idFactory);
    const evidenceId = d1.observations[0]!.id;
    const d2 = materialiseD2Output(
      {
        findings: [
          {
            localRef: "finding_1",
            reviewAreaIds: ["typography.hierarchy"],
            observation: "The headline dominates the composition.",
            interpretation: "A clear entry point is established.",
            likelyEffect: null,
            supportingEvidenceIds: [evidenceId],
            significance: "major",
            confidence: "high",
            focusRelated: true,
          },
        ],
      },
      idFactory,
    );
    const findingId = d2.findings[0]!.id;
    const d5 = materialiseD5Output(
      {
        decisions: [
          {
            localRef: "decision_1",
            sourceFindingIds: [findingId],
            action: "reject",
            rationaleSummary: "The claimed effect is not sufficiently supported.",
            resultingFinding: null,
          },
        ],
      },
      idFactory,
    );
    expect(validateD5References(d5, d2, d1, designSnapshot)).toStrictEqual(d5);
    expect(d5.decisions[0]?.resultingFinding).toBeUndefined();
  });

  it("requires each major-area statement to cite a known adjudicated finding", () => {
    const d1 = materialiseD1Output(d1Transport, idFactory);
    const evidenceId = d1.observations[0]!.id;
    const d2 = materialiseD2Output(
      {
        findings: [
          {
            localRef: "finding_1",
            reviewAreaIds: ["typography.hierarchy"],
            observation: "The headline is visibly dominant.",
            interpretation: "It creates a clear primary entry point.",
            likelyEffect: "Readers are likely to see the headline first.",
            supportingEvidenceIds: [evidenceId],
            significance: "major",
            confidence: "high",
            focusRelated: true,
          },
        ],
      },
      idFactory,
    );
    const candidateId = d2.findings[0]!.id;
    const d5 = materialiseD5Output(
      {
        decisions: [
          {
            localRef: "decision_1",
            sourceFindingIds: [candidateId],
            action: "retain",
            rationaleSummary: "The hierarchy is visibly supported.",
            resultingFinding: {
              reviewAreaIds: ["typography.hierarchy"],
              observation: "The headline is visibly dominant.",
              interpretation: "It creates a clear primary entry point.",
              likelyEffect: "Readers are likely to see the headline first.",
              supportingEvidenceIds: [evidenceId],
              contextAlignment: null,
              alternativeInterpretation: null,
              significance: "major",
              confidence: "high",
              focusRelated: true,
              adversarialStatus: "confirmed",
            },
          },
        ],
      },
      idFactory,
    );
    const findingId = d5.decisions[0]!.resultingFinding!.id;
    const statement = {
      text: "The typographic hierarchy establishes a clear entry point.",
      sourceFindingIds: [findingId],
    };
    const transport = {
      synthesis: {
        overallReading: statement,
        strengths: [statement],
        developmentPriorities: [],
        majorReviewAreas: {
          elementsOfDesign: { strengths: [], areasForImprovement: [] },
          principlesOfDesign: { strengths: [], areasForImprovement: [] },
          appliedVisualCommunication: {
            strengths: [statement],
            areasForImprovement: [],
          },
        },
        conceptAndDevelopment: null,
        focusAreaFeedback: [statement],
        contextAlignment: null,
        nextSteps: [],
        uncertainty: null,
      },
    };
    const d6 = materialiseD6Output(transport);
    expect(validateD6References(d6, d5, d1, designSnapshot)).toStrictEqual(d6);

    const unknownReference = structuredClone(d6);
    unknownReference.synthesis.majorReviewAreas!.elementsOfDesign.strengths = [
      { ...statement, sourceFindingIds: ["unknown-finding"] },
    ];
    expect(() => validateD6References(unknownReference, d5, d1, designSnapshot)).toThrow(
      ReferenceValidationError,
    );
  });

  it("requires process synthesis evidence and cross-role support for final-work relationships", () => {
    const processSnapshot = {
      ...designSnapshot,
      images: [
        { ...image, analysisRole: "final_work" as const },
        {
          ...image,
          imageId: "image-2",
          order: 1,
          sanitizedDigest: "b".repeat(64),
          analysisRole: "concept_development" as const,
        },
      ],
    };
    const d1 = materialiseD1Output({
      observations: [
        ...d1Transport.observations,
        {
          localRef: "observation_2",
          imageId: "image-2",
          regionDescription: "development composition",
          reviewAreaId: "typography.hierarchy",
          observation: "An earlier arrangement uses a smaller headline.",
          confidence: "high" as const,
          uncertainty: null,
        },
      ],
    }, idFactory);
    const finalEvidenceId = d1.observations[0]!.id;
    const developmentEvidenceId = d1.observations[1]!.id;
    const d2 = materialiseD2Output({
      findings: [{
        localRef: "finding_process",
        reviewAreaIds: ["typography.hierarchy"],
        observation: "The headline becomes more dominant between development and final work.",
        interpretation: "The visible iteration strengthens the primary entry point.",
        likelyEffect: "The final reading order is clearer.",
        supportingEvidenceIds: [developmentEvidenceId, finalEvidenceId],
        significance: "major" as const,
        confidence: "high" as const,
        focusRelated: true,
      }],
    }, idFactory);
    const d5 = materialiseD5Output({
      decisions: [{
        localRef: "decision_process",
        sourceFindingIds: [d2.findings[0]!.id],
        action: "retain" as const,
        rationaleSummary: "Both stages visibly support the refinement.",
        resultingFinding: {
          reviewAreaIds: ["typography.hierarchy"],
          observation: "The headline becomes more dominant between development and final work.",
          interpretation: "The visible iteration strengthens the primary entry point.",
          likelyEffect: "The final reading order is clearer.",
          supportingEvidenceIds: [developmentEvidenceId, finalEvidenceId],
          contextAlignment: null,
          alternativeInterpretation: null,
          significance: "major" as const,
          confidence: "high" as const,
          focusRelated: true,
          adversarialStatus: "confirmed" as const,
        },
      }],
    }, idFactory);
    const findingId = d5.decisions[0]!.resultingFinding!.id;
    const statement = {
      text: "The hierarchy is visibly refined into a clearer final entry point.",
      sourceFindingIds: [findingId],
    };
    const d6 = materialiseD6Output({
      synthesis: {
        overallReading: statement,
        strengths: [statement],
        developmentPriorities: [],
        majorReviewAreas: {
          elementsOfDesign: { strengths: [], areasForImprovement: [] },
          principlesOfDesign: { strengths: [statement], areasForImprovement: [] },
          appliedVisualCommunication: { strengths: [statement], areasForImprovement: [] },
        },
        conceptAndDevelopment: {
          overallReading: statement,
          strengths: [statement],
          developmentPriorities: [],
          relationshipToFinalWork: [statement],
        },
        focusAreaFeedback: [statement],
        contextAlignment: null,
        nextSteps: [],
        uncertainty: null,
      },
    });
    expect(validateD6References(d6, d5, d1, processSnapshot)).toStrictEqual(d6);

    const missingFinalSupport = structuredClone(d5);
    missingFinalSupport.decisions[0]!.resultingFinding!.supportingEvidenceIds = [
      developmentEvidenceId,
    ];
    expect(() =>
      validateD6References(d6, missingFinalSupport, d1, processSnapshot),
    ).toThrow(ReferenceValidationError);
  });
});

describe("Criteria pass semantic contracts", () => {
  const c1Transport = {
    criteria: [
      {
        criterionId: "criterion-1",
        assessability: "assessable" as const,
        assessabilityRationale: "The hierarchy is visibly assessable.",
        supportingEvidence: [
          {
            localRef: "criterion_evidence_1",
            imageId: "image-1",
            regionDescription: "headline",
            observation: "The headline is visibly larger than the details.",
            designFindingIds: [],
          },
        ],
        counterEvidence: [],
        relevantContext: null,
        designFindingIds: [],
        uncertainty: null,
      },
    ],
  };

  it("preserves user rubric IDs and compares every supplied statement", () => {
    expect(C1TransportOutputSchema.safeParse(c1Transport).success).toBe(true);
    const c1 = materialiseC1Output(c1Transport, idFactory);
    validateC1References(c1, criteriaSnapshot, []);
    const evidenceId = c1.criteria[0]!.supportingEvidence[0]!.id;
    const c2 = materialiseC2Output({
      comparisons: [
        {
          criterionId: "criterion-1",
          evidenceIds: [evidenceId],
          statementComparisons: [
            {
              judgementStatementId: "statement-1",
              fit: "strong",
              rationale: "The hierarchy is immediately visible.",
            },
            {
              judgementStatementId: "statement-2",
              fit: "weak",
              rationale: "The information order is not materially inconsistent.",
            },
          ],
          selectedJudgementStatementId: "statement-1",
          fallbackStatus: null,
          adjacentStatementReasons: [
            {
              judgementStatementId: "statement-2",
              fit: "weak",
              rationale: "The lower statement fits less well.",
            },
          ],
          rationale: "The first statement best matches the visible evidence.",
          confidence: "high",
        },
      ],
    });
    expect(validateC2References(c2, criteriaSnapshot, c1)).toStrictEqual(c2);
  });

  it("allows insufficient evidence independently of custom statements", () => {
    const c1 = materialiseC1Output(c1Transport, idFactory);
    const comparison = materialiseC2Output({
      comparisons: [
        {
          criterionId: "criterion-1",
          evidenceIds: [],
          statementComparisons: [
            {
              judgementStatementId: "statement-1",
              fit: "not_supported",
              rationale: "The required production evidence is not visible.",
            },
            {
              judgementStatementId: "statement-2",
              fit: "not_supported",
              rationale: "The required production evidence is not visible.",
            },
          ],
          selectedJudgementStatementId: null,
          fallbackStatus: "insufficient_evidence",
          adjacentStatementReasons: [],
          rationale: "The criterion cannot be reliably decided from this view.",
          confidence: "low",
        },
      ],
    });
    expect(validateC2References(comparison, criteriaSnapshot, c1)).toStrictEqual(comparison);
  });

  it("materialises C4 evidence from C1 references instead of accepting rewritten evidence", () => {
    const c1 = materialiseC1Output(c1Transport, idFactory);
    const evidence = c1.criteria[0]!.supportingEvidence[0]!;
    const transport = {
      results: [
        {
          criterionId: "criterion-1",
          supportingEvidenceIds: [evidence.id],
          counterEvidenceIds: [],
          selectedJudgementStatementId: "statement-1",
          fallbackStatus: null,
          rationale: "The visible hierarchy supports the supplied statement.",
          alternativeJudgement: null,
          confidence: "high" as const,
          designRelationship: "aligned" as const,
        },
      ],
    };
    expect(C4TransportOutputSchema.safeParse(transport).success).toBe(true);
    const c4 = materialiseC4Output(transport, c1);
    expect(c4.results[0]!.supportingEvidence[0]).toEqual(evidence);
    expect(validateC4References(c4, criteriaSnapshot, c1)).toStrictEqual(c4);
  });
});
