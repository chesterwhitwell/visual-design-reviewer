import {
  ApplicationIdSchema,
  type ApplicationId,
} from "@/lib/domain/common";

import {
  C1OutputSchema,
  C2OutputSchema,
  C3OutputSchema,
  C4OutputSchema,
  C5OutputSchema,
  D1OutputSchema,
  D2OutputSchema,
  D3OutputSchema,
  D4OutputSchema,
  D5OutputSchema,
  D6OutputSchema,
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
} from "./domain";
import { ReferenceValidationError } from "./errors";
import {
  C1TransportOutputSchema,
  C2TransportOutputSchema,
  C3TransportOutputSchema,
  C4TransportOutputSchema,
  C5TransportOutputSchema,
  D1TransportOutputSchema,
  D2TransportOutputSchema,
  D3TransportOutputSchema,
  D4TransportOutputSchema,
  D5TransportOutputSchema,
  D6TransportOutputSchema,
} from "./transport";

export type ApplicationGeneratedEntity =
  | "evidence"
  | "candidate_finding"
  | "context_alignment"
  | "design_challenge"
  | "adjudication_decision"
  | "design_finding"
  | "criterion_evidence";

export interface ApplicationIdRequest {
  entity: ApplicationGeneratedEntity;
  localRef: string;
  ordinal: number;
  parentRef?: string;
}

export type ApplicationIdFactory = (request: ApplicationIdRequest) => string;

function canonicalId(factory: ApplicationIdFactory, request: ApplicationIdRequest): ApplicationId {
  return ApplicationIdSchema.parse(factory(request));
}

function optionalText<Key extends string>(
  key: Key,
  value: string | null,
): Partial<Record<Key, string>> {
  return value === null ? {} : ({ [key]: value } as Record<Key, string>);
}

export function materialiseD1Output(
  input: unknown,
  idFactory: ApplicationIdFactory,
): D1Output {
  const transport = D1TransportOutputSchema.parse(input);
  return D1OutputSchema.parse({
    observations: transport.observations.map((observation, ordinal) => ({
      id: canonicalId(idFactory, {
        entity: "evidence",
        localRef: observation.localRef,
        ordinal,
      }),
      imageId: observation.imageId,
      ...optionalText("regionDescription", observation.regionDescription),
      reviewAreaId: observation.reviewAreaId,
      observation: observation.observation,
      confidence: observation.confidence,
      ...optionalText("uncertainty", observation.uncertainty),
    })),
  });
}

export function materialiseD2Output(
  input: unknown,
  idFactory: ApplicationIdFactory,
): D2Output {
  const transport = D2TransportOutputSchema.parse(input);
  return D2OutputSchema.parse({
    findings: transport.findings.map((finding, ordinal) => ({
      id: canonicalId(idFactory, {
        entity: "candidate_finding",
        localRef: finding.localRef,
        ordinal,
      }),
      reviewAreaIds: finding.reviewAreaIds,
      observation: finding.observation,
      interpretation: finding.interpretation,
      ...optionalText("likelyEffect", finding.likelyEffect),
      supportingEvidenceIds: finding.supportingEvidenceIds,
      significance: finding.significance,
      confidence: finding.confidence,
      focusRelated: finding.focusRelated,
    })),
  });
}

export function materialiseD3Output(
  input: unknown,
  idFactory: ApplicationIdFactory,
): D3Output {
  const transport = D3TransportOutputSchema.parse(input);
  return D3OutputSchema.parse({
    alignments: transport.alignments.map((alignment, ordinal) => ({
      id: canonicalId(idFactory, {
        entity: "context_alignment",
        localRef: alignment.localRef,
        ordinal,
      }),
      findingId: alignment.findingId,
      status: alignment.status,
      alignment: alignment.alignment,
      ...optionalText("alternativeInterpretation", alignment.alternativeInterpretation),
      ...optionalText("uncertainty", alignment.uncertainty),
    })),
  });
}

export function materialiseD4Output(
  input: unknown,
  idFactory: ApplicationIdFactory,
): D4Output {
  const transport = D4TransportOutputSchema.parse(input);
  return D4OutputSchema.parse({
    challenges: transport.challenges.map((challenge, ordinal) => ({
      id: canonicalId(idFactory, {
        entity: "design_challenge",
        localRef: challenge.localRef,
        ordinal,
      }),
      findingId: challenge.findingId,
      status: challenge.status,
      counterEvidence: challenge.counterEvidence,
      ...optionalText("alternativeInterpretation", challenge.alternativeInterpretation),
      ...optionalText("qualification", challenge.qualification),
      rationaleSummary: challenge.rationaleSummary,
    })),
  });
}

export function materialiseD5Output(
  input: unknown,
  idFactory: ApplicationIdFactory,
): D5Output {
  const transport = D5TransportOutputSchema.parse(input);
  return D5OutputSchema.parse({
    decisions: transport.decisions.map((decision, ordinal) => {
      const decisionId = canonicalId(idFactory, {
        entity: "adjudication_decision",
        localRef: decision.localRef,
        ordinal,
      });
      const resultingFinding =
        decision.resultingFinding === null
          ? undefined
          : {
              id: canonicalId(idFactory, {
                entity: "design_finding",
                localRef: decision.localRef,
                ordinal,
                parentRef: decisionId,
              }),
              sourceFindingIds: decision.sourceFindingIds,
              reviewAreaIds: decision.resultingFinding.reviewAreaIds,
              observation: decision.resultingFinding.observation,
              interpretation: decision.resultingFinding.interpretation,
              ...optionalText("likelyEffect", decision.resultingFinding.likelyEffect),
              supportingEvidenceIds: decision.resultingFinding.supportingEvidenceIds,
              ...optionalText("contextAlignment", decision.resultingFinding.contextAlignment),
              ...optionalText(
                "alternativeInterpretation",
                decision.resultingFinding.alternativeInterpretation,
              ),
              significance: decision.resultingFinding.significance,
              confidence: decision.resultingFinding.confidence,
              focusRelated: decision.resultingFinding.focusRelated,
              adversarialStatus: decision.resultingFinding.adversarialStatus,
              adjudication:
                decision.action === "retain"
                  ? ("retained" as const)
                  : decision.action === "modify"
                    ? ("modified" as const)
                    : ("merged" as const),
            };

      return {
        id: decisionId,
        sourceFindingIds: decision.sourceFindingIds,
        action: decision.action,
        rationaleSummary: decision.rationaleSummary,
        ...(resultingFinding === undefined ? {} : { resultingFinding }),
      };
    }),
  });
}

export function materialiseD6Output(input: unknown): D6Output {
  const transport = D6TransportOutputSchema.parse(input);
  return D6OutputSchema.parse({
    synthesis: {
      overallReading: transport.synthesis.overallReading,
      strengths: transport.synthesis.strengths,
      developmentPriorities: transport.synthesis.developmentPriorities,
      majorReviewAreas: transport.synthesis.majorReviewAreas,
      ...(transport.synthesis.conceptAndDevelopment === null
        ? {}
        : { conceptAndDevelopment: transport.synthesis.conceptAndDevelopment }),
      focusAreaFeedback: transport.synthesis.focusAreaFeedback,
      ...(transport.synthesis.contextAlignment === null
        ? {}
        : { contextAlignment: transport.synthesis.contextAlignment }),
      nextSteps: transport.synthesis.nextSteps,
      ...optionalText("uncertainty", transport.synthesis.uncertainty),
    },
  });
}

export function materialiseC1Output(
  input: unknown,
  idFactory: ApplicationIdFactory,
): C1Output {
  const transport = C1TransportOutputSchema.parse(input);
  let evidenceOrdinal = 0;

  return C1OutputSchema.parse({
    criteria: transport.criteria.map((criterion) => {
      const mapEvidence = (
        evidence: (typeof criterion.supportingEvidence)[number],
      ) => ({
        id: canonicalId(idFactory, {
          entity: "criterion_evidence",
          localRef: evidence.localRef,
          ordinal: evidenceOrdinal++,
          parentRef: criterion.criterionId,
        }),
        criterionId: criterion.criterionId,
        imageId: evidence.imageId,
        ...optionalText("regionDescription", evidence.regionDescription),
        observation: evidence.observation,
        designFindingIds: evidence.designFindingIds,
      });

      return {
        criterionId: criterion.criterionId,
        assessability: criterion.assessability,
        assessabilityRationale: criterion.assessabilityRationale,
        supportingEvidence: criterion.supportingEvidence.map(mapEvidence),
        counterEvidence: criterion.counterEvidence.map(mapEvidence),
        ...optionalText("relevantContext", criterion.relevantContext),
        designFindingIds: criterion.designFindingIds,
        ...optionalText("uncertainty", criterion.uncertainty),
      };
    }),
  });
}

export function materialiseC2Output(input: unknown): C2Output {
  const transport = C2TransportOutputSchema.parse(input);
  return C2OutputSchema.parse({
    comparisons: transport.comparisons.map((comparison) => ({
      criterionId: comparison.criterionId,
      evidenceIds: comparison.evidenceIds,
      statementComparisons: comparison.statementComparisons,
      ...(comparison.selectedJudgementStatementId === null
        ? {}
        : { selectedJudgementStatementId: comparison.selectedJudgementStatementId }),
      ...(comparison.fallbackStatus === null
        ? {}
        : { fallbackStatus: comparison.fallbackStatus }),
      adjacentStatementReasons: comparison.adjacentStatementReasons,
      rationale: comparison.rationale,
      confidence: comparison.confidence,
    })),
  });
}

export function materialiseC3Output(input: unknown): C3Output {
  const transport = C3TransportOutputSchema.parse(input);
  return C3OutputSchema.parse({
    challenges: transport.challenges.map((challenge) => ({
      criterionId: challenge.criterionId,
      status: challenge.status,
      ...(challenge.alternateJudgementStatementId === null
        ? {}
        : { alternateJudgementStatementId: challenge.alternateJudgementStatementId }),
      ...(challenge.alternateFallbackStatus === null
        ? {}
        : { alternateFallbackStatus: challenge.alternateFallbackStatus }),
      evidenceIds: challenge.evidenceIds,
      scopeCheck: challenge.scopeCheck,
      contextBiasCheck: challenge.contextBiasCheck,
      designComplianceTension: challenge.designComplianceTension,
      ...optionalText("qualification", challenge.qualification),
    })),
  });
}

export function materialiseC4Output(input: unknown, c1Input: unknown): C4Output {
  const transport = C4TransportOutputSchema.parse(input);
  const c1 = C1OutputSchema.parse(c1Input);
  const evidenceById = new Map(
    c1.criteria.flatMap(({ supportingEvidence, counterEvidence }) =>
      [...supportingEvidence, ...counterEvidence].map((evidence) => [evidence.id, evidence] as const),
    ),
  );

  const resolveEvidence = (evidenceId: string) => {
    const evidence = evidenceById.get(evidenceId);
    if (evidence === undefined) {
      throw new ReferenceValidationError([
        {
          path: "results.evidenceIds",
          message: "C4 references unknown C1 evidence",
          reference: evidenceId,
        },
      ]);
    }
    return evidence;
  };

  return C4OutputSchema.parse({
    results: transport.results.map((result) => ({
      criterionId: result.criterionId,
      supportingEvidence: result.supportingEvidenceIds.map(resolveEvidence),
      counterEvidence: result.counterEvidenceIds.map(resolveEvidence),
      ...(result.selectedJudgementStatementId === null
        ? {}
        : { selectedJudgementStatementId: result.selectedJudgementStatementId }),
      ...(result.fallbackStatus === null ? {} : { fallbackStatus: result.fallbackStatus }),
      rationale: result.rationale,
      ...optionalText("alternativeJudgement", result.alternativeJudgement),
      confidence: result.confidence,
      designRelationship: result.designRelationship,
    })),
  });
}

export function materialiseC5Output(input: unknown): C5Output {
  const transport = C5TransportOutputSchema.parse(input);
  return C5OutputSchema.parse({
    synthesis: {
      overallSummary: transport.synthesis.overallSummary,
      criteria: transport.synthesis.criteria.map((criterion) => ({
        criterionId: criterion.criterionId,
        summary: criterion.summary,
        ...optionalText("improvement", criterion.improvement),
        sourceEvidenceIds: criterion.sourceEvidenceIds,
      })),
      crossCriterionObservations: transport.synthesis.crossCriterionObservations,
      ...optionalText("uncertainty", transport.synthesis.uncertainty),
    },
  });
}
