import {
  CriteriaAnalysisInputSnapshotSchema,
  DesignAnalysisInputSnapshotSchema,
  DesignFindingSchema,
  type AnalysisPassId,
} from "@/lib/domain/analysis";
import { CriteriaSnapshotSchema, type Criterion } from "@/lib/domain/criteria";

import { ReferenceValidationError, type ReferenceIssue } from "./errors";

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
  DomainPassOutputSchemas,
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
  type DomainPassOutputById,
} from "./domain";

class ReferenceCollector {
  readonly issues: ReferenceIssue[] = [];

  known(path: string, reference: string, allowed: ReadonlySet<string>, label: string): void {
    if (!allowed.has(reference)) {
      this.issues.push({
        path,
        message: `unknown ${label} reference '${reference}'`,
        reference,
      });
    }
  }

  unique(path: string, values: readonly string[], label: string): void {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        this.issues.push({
          path: `${path}[${index}]`,
          message: `duplicate ${label} reference '${value}'`,
          reference: value,
        });
      }
      seen.add(value);
    });
  }

  exact(path: string, actual: readonly string[], expected: ReadonlySet<string>, label: string): void {
    this.unique(path, actual, label);
    const actualSet = new Set(actual);
    for (const value of actualSet) {
      this.known(path, value, expected, label);
    }
    for (const value of expected) {
      if (!actualSet.has(value)) {
        this.issues.push({
          path,
          message: `missing ${label} reference '${value}'`,
          reference: value,
        });
      }
    }
  }

  finish(): void {
    if (this.issues.length > 0) {
      throw new ReferenceValidationError(this.issues);
    }
  }
}

const ids = <Value extends { id: string }>(values: readonly Value[]): Set<string> =>
  new Set(values.map(({ id }) => id));

export function parseDomainPassOutput<PassId extends AnalysisPassId>(
  passId: PassId,
  input: unknown,
): DomainPassOutputById[PassId] {
  return DomainPassOutputSchemas[passId].parse(input) as DomainPassOutputById[PassId];
}

export function validateD1References(outputInput: unknown, snapshotInput: unknown): D1Output {
  const output = D1OutputSchema.parse(outputInput);
  const snapshot = DesignAnalysisInputSnapshotSchema.parse(snapshotInput);
  const imageIds = new Set(snapshot.images.map(({ imageId }) => imageId));
  const reviewAreaIds = new Set(snapshot.reviewAreas.map(({ areaId }) => areaId));
  const collector = new ReferenceCollector();

  output.observations.forEach((observation, index) => {
    collector.known(`observations[${index}].imageId`, observation.imageId, imageIds, "image");
    collector.known(
      `observations[${index}].reviewAreaId`,
      observation.reviewAreaId,
      reviewAreaIds,
      "review area",
    );
  });
  collector.finish();
  return output;
}

export function validateD2References(
  outputInput: unknown,
  d1Input: unknown,
  snapshotInput: unknown,
): D2Output {
  const output = D2OutputSchema.parse(outputInput);
  const d1 = D1OutputSchema.parse(d1Input);
  const snapshot = DesignAnalysisInputSnapshotSchema.parse(snapshotInput);
  const evidenceIds = ids(d1.observations);
  const reviewAreaIds = new Set(snapshot.reviewAreas.map(({ areaId }) => areaId));
  const focusAreaIds = new Set(
    snapshot.reviewAreas.filter(({ mode }) => mode === "focus").map(({ areaId }) => areaId),
  );
  const collector = new ReferenceCollector();

  output.findings.forEach((finding, index) => {
    collector.unique(`findings[${index}].reviewAreaIds`, finding.reviewAreaIds, "review area");
    finding.reviewAreaIds.forEach((areaId, areaIndex) => {
      collector.known(
        `findings[${index}].reviewAreaIds[${areaIndex}]`,
        areaId,
        reviewAreaIds,
        "review area",
      );
    });
    collector.unique(
      `findings[${index}].supportingEvidenceIds`,
      finding.supportingEvidenceIds,
      "D1 evidence",
    );
    finding.supportingEvidenceIds.forEach((evidenceId, evidenceIndex) => {
      collector.known(
        `findings[${index}].supportingEvidenceIds[${evidenceIndex}]`,
        evidenceId,
        evidenceIds,
        "D1 evidence",
      );
    });

    const actuallyFocusRelated = finding.reviewAreaIds.some((areaId) => focusAreaIds.has(areaId));
    if (finding.focusRelated !== actuallyFocusRelated) {
      collector.issues.push({
        path: `findings[${index}].focusRelated`,
        message: "focusRelated must reflect whether the finding references a Focus area",
      });
    }
  });
  collector.finish();
  return output;
}

export function validateD3References(outputInput: unknown, d2Input: unknown): D3Output {
  const output = D3OutputSchema.parse(outputInput);
  const d2 = D2OutputSchema.parse(d2Input);
  const expected = ids(d2.findings);
  const collector = new ReferenceCollector();
  collector.exact(
    "alignments",
    output.alignments.map(({ findingId }) => findingId),
    expected,
    "D2 finding",
  );
  collector.finish();
  return output;
}

export function validateD4References(outputInput: unknown, d2Input: unknown): D4Output {
  const output = D4OutputSchema.parse(outputInput);
  const d2 = D2OutputSchema.parse(d2Input);
  const expected = ids(d2.findings);
  const collector = new ReferenceCollector();
  collector.exact(
    "challenges",
    output.challenges.map(({ findingId }) => findingId),
    expected,
    "D2 finding",
  );
  collector.finish();
  return output;
}

export function validateD5References(
  outputInput: unknown,
  d2Input: unknown,
  d1Input: unknown,
  snapshotInput: unknown,
): D5Output {
  const output = D5OutputSchema.parse(outputInput);
  const d2 = D2OutputSchema.parse(d2Input);
  const d1 = D1OutputSchema.parse(d1Input);
  const snapshot = DesignAnalysisInputSnapshotSchema.parse(snapshotInput);
  const candidateIds = ids(d2.findings);
  const evidenceIds = ids(d1.observations);
  const reviewAreaIds = new Set(snapshot.reviewAreas.map(({ areaId }) => areaId));
  const collector = new ReferenceCollector();
  const allSourceIds = output.decisions.flatMap(({ sourceFindingIds }) => sourceFindingIds);
  collector.exact("decisions", allSourceIds, candidateIds, "D2 finding");

  output.decisions.forEach((decision, index) => {
    if (decision.resultingFinding === undefined) return;
    const finding = decision.resultingFinding;
    if (JSON.stringify(finding.sourceFindingIds) !== JSON.stringify(decision.sourceFindingIds)) {
      collector.issues.push({
        path: `decisions[${index}].resultingFinding.sourceFindingIds`,
        message: "resulting finding source IDs must match its adjudication decision",
      });
    }
    collector.unique(
      `decisions[${index}].resultingFinding.reviewAreaIds`,
      finding.reviewAreaIds,
      "review area",
    );
    finding.reviewAreaIds.forEach((areaId, areaIndex) => {
      collector.known(
        `decisions[${index}].resultingFinding.reviewAreaIds[${areaIndex}]`,
        areaId,
        reviewAreaIds,
        "review area",
      );
    });
    collector.unique(
      `decisions[${index}].resultingFinding.supportingEvidenceIds`,
      finding.supportingEvidenceIds,
      "D1 evidence",
    );
    finding.supportingEvidenceIds.forEach((evidenceId, evidenceIndex) => {
      collector.known(
        `decisions[${index}].resultingFinding.supportingEvidenceIds[${evidenceIndex}]`,
        evidenceId,
        evidenceIds,
        "D1 evidence",
      );
    });
  });
  collector.finish();
  return output;
}

export function validateD6References(
  outputInput: unknown,
  d5Input: unknown,
  d1Input: unknown,
  snapshotInput: unknown,
): D6Output {
  const output = D6OutputSchema.parse(outputInput);
  const d5 = D5OutputSchema.parse(d5Input);
  const d1 = D1OutputSchema.parse(d1Input);
  const snapshot = DesignAnalysisInputSnapshotSchema.parse(snapshotInput);
  const findings = d5.decisions.flatMap(({ resultingFinding }) =>
    resultingFinding === undefined ? [] : [resultingFinding],
  );
  const findingIds = new Set(findings.map(({ id }) => id));
  const collector = new ReferenceCollector();
  const majorReviewAreaStatements = Object.values(
    output.synthesis.majorReviewAreas ?? {},
  ).flatMap(({ strengths, areasForImprovement }) => [
    ...strengths,
    ...areasForImprovement,
  ]);
  const process = output.synthesis.conceptAndDevelopment;
  const processStatements = process
    ? [
        process.overallReading,
        ...process.strengths,
        ...process.developmentPriorities,
        ...process.relationshipToFinalWork,
      ]
    : [];
  const statements = [
    output.synthesis.overallReading,
    ...output.synthesis.strengths,
    ...output.synthesis.developmentPriorities,
    ...majorReviewAreaStatements,
    ...output.synthesis.focusAreaFeedback,
    ...(output.synthesis.contextAlignment === undefined
      ? []
      : [output.synthesis.contextAlignment]),
    ...output.synthesis.nextSteps,
  ];
  statements.forEach((statement, index) => {
    if (findingIds.size > 0 && statement.sourceFindingIds.length === 0) {
      collector.issues.push({
        path: `synthesis.statements[${index}].sourceFindingIds`,
        message: "synthesis statements must cite an adjudicated finding",
      });
    }
    collector.unique(
      `synthesis.statements[${index}].sourceFindingIds`,
      statement.sourceFindingIds,
      "adjudicated finding",
    );
    statement.sourceFindingIds.forEach((findingId, findingIndex) => {
      collector.known(
        `synthesis.statements[${index}].sourceFindingIds[${findingIndex}]`,
        findingId,
        findingIds,
        "adjudicated finding",
      );
    });
  });

  const hasDevelopmentImages = snapshot.images.some(
    ({ analysisRole }) => analysisRole === "concept_development",
  );
  if (hasDevelopmentImages && !process) {
    collector.issues.push({
      path: "synthesis.conceptAndDevelopment",
      message: "development images require a concept-and-development synthesis",
    });
  }
  if (!hasDevelopmentImages && process) {
    collector.issues.push({
      path: "synthesis.conceptAndDevelopment",
      message: "concept-and-development synthesis requires development images",
    });
  }

  if (process) {
    const roleByImageId = new Map(
      snapshot.images.map(({ imageId, analysisRole }) => [imageId, analysisRole]),
    );
    const observationById = new Map(d1.observations.map((item) => [item.id, item]));
    const findingById = new Map(findings.map((item) => [item.id, item]));
    const rolesFor = (statement: { sourceFindingIds: string[] }) => new Set(
      statement.sourceFindingIds.flatMap((findingId) => {
        const finding = findingById.get(findingId);
        return finding?.supportingEvidenceIds.flatMap((evidenceId) => {
          const evidence = observationById.get(evidenceId);
          const role = evidence ? roleByImageId.get(evidence.imageId) : undefined;
          return role ? [role] : [];
        }) ?? [];
      }),
    );
    const hasProcessSupportedFinding = findings.some((finding) =>
      rolesFor({ sourceFindingIds: [finding.id] }).has("concept_development"),
    );
    processStatements.forEach((statement, index) => {
      const path = `synthesis.conceptAndDevelopment.statements[${index}].sourceFindingIds`;
      collector.unique(path, statement.sourceFindingIds, "adjudicated finding");
      statement.sourceFindingIds.forEach((findingId, findingIndex) => {
        collector.known(
          `${path}[${findingIndex}]`,
          findingId,
          findingIds,
          "adjudicated finding",
        );
      });
      const isNeutralOverall = index === 0 && !hasProcessSupportedFinding;
      if (statement.sourceFindingIds.length === 0 && !isNeutralOverall) {
        collector.issues.push({
          path,
          message: "grounded process statements must cite an adjudicated finding",
        });
      } else if (
        statement.sourceFindingIds.length > 0 &&
        !rolesFor(statement).has("concept_development")
      ) {
        collector.issues.push({
          path: `synthesis.conceptAndDevelopment.statements[${index}]`,
          message: "process statements must cite development-image evidence",
        });
      }
    });
    process.relationshipToFinalWork.forEach((statement, index) => {
      const roles = rolesFor(statement);
      if (!roles.has("final_work") || !roles.has("concept_development")) {
        collector.issues.push({
          path: `synthesis.conceptAndDevelopment.relationshipToFinalWork[${index}]`,
          message: "relationship statements must cite both final and development evidence",
        });
      }
    });
  }

  collector.finish();
  return output;
}

function criteriaById(criteriaInput: unknown): Map<string, Criterion> {
  return new Map(CriteriaSnapshotSchema.parse(criteriaInput).map((criterion) => [criterion.id, criterion]));
}

function c1EvidenceById(c1: C1Output): Map<string, C1Output["criteria"][number]["supportingEvidence"][number]> {
  return new Map(
    c1.criteria.flatMap(({ supportingEvidence, counterEvidence }) =>
      [...supportingEvidence, ...counterEvidence].map((evidence) => [evidence.id, evidence] as const),
    ),
  );
}

function validateCriterionDecision(
  collector: ReferenceCollector,
  path: string,
  criterion: Criterion,
  selectedJudgementStatementId: string | undefined,
  fallbackStatus: string | undefined,
): void {
  const statementIds = new Set(criterion.judgementStatements.map(({ id }) => id));
  if (criterion.judgementStatements.length === 0) {
    if (selectedJudgementStatementId !== undefined) {
      collector.issues.push({
        path: `${path}.selectedJudgementStatementId`,
        message: "a criterion without judgement statements cannot select one",
      });
    }
    if (fallbackStatus === undefined) {
      collector.issues.push({
        path: `${path}.fallbackStatus`,
        message: "a criterion without judgement statements requires a fallback status",
      });
    }
    return;
  }

  if (selectedJudgementStatementId !== undefined) {
    collector.known(
      `${path}.selectedJudgementStatementId`,
      selectedJudgementStatementId,
      statementIds,
      "judgement statement",
    );
  } else if (fallbackStatus !== "insufficient_evidence") {
    collector.issues.push({
      path: `${path}.fallbackStatus`,
      message:
        "a criterion with custom statements must select one unless evidence is insufficient",
    });
  }
}

export function validateC1References(
  outputInput: unknown,
  snapshotInput: unknown,
  designFindingsInput: unknown,
): C1Output {
  const output = C1OutputSchema.parse(outputInput);
  const snapshot = CriteriaAnalysisInputSnapshotSchema.parse(snapshotInput);
  const designFindings = DesignFindingSchema.array().parse(designFindingsInput);
  const expectedCriterionIds = new Set(snapshot.criteria.map(({ id }) => id));
  const imageIds = new Set(snapshot.images.map(({ imageId }) => imageId));
  const designFindingIds = ids(designFindings);
  const collector = new ReferenceCollector();
  collector.exact(
    "criteria",
    output.criteria.map(({ criterionId }) => criterionId),
    expectedCriterionIds,
    "criterion",
  );

  output.criteria.forEach((criterion, criterionIndex) => {
    const evidence = [...criterion.supportingEvidence, ...criterion.counterEvidence];
    evidence.forEach((item, evidenceIndex) => {
      if (item.criterionId !== criterion.criterionId) {
        collector.issues.push({
          path: `criteria[${criterionIndex}].evidence[${evidenceIndex}].criterionId`,
          message: "criterion evidence must belong to its containing criterion",
        });
      }
      collector.known(
        `criteria[${criterionIndex}].evidence[${evidenceIndex}].imageId`,
        item.imageId,
        imageIds,
        "image",
      );
      item.designFindingIds.forEach((findingId, index) => {
        collector.known(
          `criteria[${criterionIndex}].evidence[${evidenceIndex}].designFindingIds[${index}]`,
          findingId,
          designFindingIds,
          "Design finding",
        );
      });
    });
    criterion.designFindingIds.forEach((findingId, index) => {
      collector.known(
        `criteria[${criterionIndex}].designFindingIds[${index}]`,
        findingId,
        designFindingIds,
        "Design finding",
      );
    });
  });
  collector.finish();
  return output;
}

export function validateC2References(
  outputInput: unknown,
  snapshotInput: unknown,
  c1Input: unknown,
): C2Output {
  const output = C2OutputSchema.parse(outputInput);
  const snapshot = CriteriaAnalysisInputSnapshotSchema.parse(snapshotInput);
  const c1 = C1OutputSchema.parse(c1Input);
  const criteria = criteriaById(snapshot.criteria);
  const evidence = c1EvidenceById(c1);
  const collector = new ReferenceCollector();
  collector.exact(
    "comparisons",
    output.comparisons.map(({ criterionId }) => criterionId),
    new Set(criteria.keys()),
    "criterion",
  );

  output.comparisons.forEach((comparison, index) => {
    const criterion = criteria.get(comparison.criterionId);
    if (criterion === undefined) return;
    comparison.evidenceIds.forEach((evidenceId, evidenceIndex) => {
      collector.known(
        `comparisons[${index}].evidenceIds[${evidenceIndex}]`,
        evidenceId,
        new Set(evidence.keys()),
        "C1 evidence",
      );
      if (evidence.get(evidenceId)?.criterionId !== comparison.criterionId) {
        collector.issues.push({
          path: `comparisons[${index}].evidenceIds[${evidenceIndex}]`,
          message: "C1 evidence belongs to a different criterion",
          reference: evidenceId,
        });
      }
    });
    const expectedStatements = new Set(criterion.judgementStatements.map(({ id }) => id));
    collector.exact(
      `comparisons[${index}].statementComparisons`,
      comparison.statementComparisons.map(({ judgementStatementId }) => judgementStatementId),
      expectedStatements,
      "judgement statement",
    );
    comparison.adjacentStatementReasons.forEach(({ judgementStatementId }, reasonIndex) => {
      collector.known(
        `comparisons[${index}].adjacentStatementReasons[${reasonIndex}]`,
        judgementStatementId,
        expectedStatements,
        "judgement statement",
      );
    });
    validateCriterionDecision(
      collector,
      `comparisons[${index}]`,
      criterion,
      comparison.selectedJudgementStatementId,
      comparison.fallbackStatus,
    );
  });
  collector.finish();
  return output;
}

export function validateC3References(
  outputInput: unknown,
  snapshotInput: unknown,
  c1Input: unknown,
): C3Output {
  const output = C3OutputSchema.parse(outputInput);
  const snapshot = CriteriaAnalysisInputSnapshotSchema.parse(snapshotInput);
  const c1 = C1OutputSchema.parse(c1Input);
  const criteria = criteriaById(snapshot.criteria);
  const evidence = c1EvidenceById(c1);
  const collector = new ReferenceCollector();
  collector.exact(
    "challenges",
    output.challenges.map(({ criterionId }) => criterionId),
    new Set(criteria.keys()),
    "criterion",
  );

  output.challenges.forEach((challenge, index) => {
    const criterion = criteria.get(challenge.criterionId);
    if (criterion === undefined) return;
    const statementIds = new Set(criterion.judgementStatements.map(({ id }) => id));
    if (challenge.alternateJudgementStatementId !== undefined) {
      collector.known(
        `challenges[${index}].alternateJudgementStatementId`,
        challenge.alternateJudgementStatementId,
        statementIds,
        "judgement statement",
      );
    }
    if (
      criterion.judgementStatements.length > 0 &&
      challenge.alternateFallbackStatus !== undefined &&
      challenge.alternateFallbackStatus !== "insufficient_evidence"
    ) {
      collector.issues.push({
        path: `challenges[${index}].alternateFallbackStatus`,
        message: "only insufficient_evidence can replace a custom judgement statement",
      });
    }
    challenge.evidenceIds.forEach((evidenceId, evidenceIndex) => {
      collector.known(
        `challenges[${index}].evidenceIds[${evidenceIndex}]`,
        evidenceId,
        new Set(evidence.keys()),
        "C1 evidence",
      );
    });
  });
  collector.finish();
  return output;
}

export function validateC4References(
  outputInput: unknown,
  snapshotInput: unknown,
  c1Input: unknown,
): C4Output {
  const output = C4OutputSchema.parse(outputInput);
  const snapshot = CriteriaAnalysisInputSnapshotSchema.parse(snapshotInput);
  const c1 = C1OutputSchema.parse(c1Input);
  const criteria = criteriaById(snapshot.criteria);
  const evidence = c1EvidenceById(c1);
  const collector = new ReferenceCollector();
  collector.exact(
    "results",
    output.results.map(({ criterionId }) => criterionId),
    new Set(criteria.keys()),
    "criterion",
  );

  output.results.forEach((result, index) => {
    const criterion = criteria.get(result.criterionId);
    if (criterion === undefined) return;
    validateCriterionDecision(
      collector,
      `results[${index}]`,
      criterion,
      result.selectedJudgementStatementId,
      result.fallbackStatus,
    );
    [...result.supportingEvidence, ...result.counterEvidence].forEach((item, evidenceIndex) => {
      collector.known(
        `results[${index}].evidence[${evidenceIndex}].id`,
        item.id,
        new Set(evidence.keys()),
        "C1 evidence",
      );
      if (item.criterionId !== result.criterionId) {
        collector.issues.push({
          path: `results[${index}].evidence[${evidenceIndex}].criterionId`,
          message: "criterion result evidence belongs to a different criterion",
        });
      }
    });
  });
  collector.finish();
  return output;
}

export function validateC5References(
  outputInput: unknown,
  snapshotInput: unknown,
  c4Input: unknown,
): C5Output {
  const output = C5OutputSchema.parse(outputInput);
  const snapshot = CriteriaAnalysisInputSnapshotSchema.parse(snapshotInput);
  const c4 = C4OutputSchema.parse(c4Input);
  const expectedCriterionIds = new Set(snapshot.criteria.map(({ id }) => id));
  const evidenceByCriterion = new Map(
    c4.results.map((result) => [
      result.criterionId,
      new Set(
        [...result.supportingEvidence, ...result.counterEvidence].map(({ id }) => id),
      ),
    ]),
  );
  const collector = new ReferenceCollector();
  collector.exact(
    "synthesis.criteria",
    output.synthesis.criteria.map(({ criterionId }) => criterionId),
    expectedCriterionIds,
    "criterion",
  );
  output.synthesis.criteria.forEach((criterion, index) => {
    const availableEvidence = evidenceByCriterion.get(criterion.criterionId) ?? new Set<string>();
    criterion.sourceEvidenceIds.forEach((evidenceId, evidenceIndex) => {
      collector.known(
        `synthesis.criteria[${index}].sourceEvidenceIds[${evidenceIndex}]`,
        evidenceId,
        availableEvidence,
        "criterion evidence",
      );
    });
  });
  collector.finish();
  return output;
}
