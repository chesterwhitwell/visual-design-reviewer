import "server-only";

import { z } from "zod";

import {
  ApplicationIdSchema,
  CriteriaAnalysisSchema,
  DesignAnalysisSchema,
  type CriteriaAnalysis,
  type Criterion,
  type CriterionResult,
  type DesignAnalysis,
  type DesignFinding,
} from "@/lib/domain";
import {
  createRepositories,
  type CriteriaAnalysisRow,
  type DesignAnalysisRow,
} from "@/lib/db";
import { AppError } from "@/lib/http/errors";

const exportSelectionSchema = z
  .object({
    designAnalysisId: ApplicationIdSchema.optional(),
    criteriaAnalysisId: ApplicationIdSchema.optional(),
  })
  .strict();

export type ExportSelection = z.infer<typeof exportSelectionSchema>;

export type AnalysisVersionInformation = {
  schemaVersion: string;
  promptSetVersion: string;
};

export type IntegratedRelationship = {
  criterionId: string;
  criterionTitle: string;
  decision: {
    kind: "judgement_statement" | "fallback_status";
    id: string | null;
    label: string;
  };
  confidence: CriterionResult["confidence"];
  designRelationship: CriterionResult["designRelationship"];
  rationale: string;
  linkedDesignFindings: Array<
    Pick<DesignFinding, "id" | "observation" | "significance" | "confidence">
  >;
};

export type IntegratedReview = {
  kind: "deterministic_relationship_view";
  designAnalysisId: string;
  criteriaAnalysisId: string;
  relationships: IntegratedRelationship[];
};

export type ReviewExport = {
  exportSchemaVersion: "1.1.0";
  review: {
    id: string;
    title: string | null;
    lifecycle: "active" | "closed";
    createdAt: string;
    updatedAt: string;
  };
  designAnalysis: DesignAnalysis | null;
  designAnalysisVersion: AnalysisVersionInformation | null;
  criteriaAnalysis: CriteriaAnalysis | null;
  criteriaAnalysisVersion: AnalysisVersionInformation | null;
  integratedReview: IntegratedReview | null;
};

export type PreparedReviewExport = {
  bundle: ReviewExport;
  filenameStem: string;
};

/**
 * Selects only immutable, completed artifacts. Mutable review criteria and area
 * selections are deliberately not mixed into a historical analysis export.
 */
export function prepareReviewExport(
  reviewIdInput: string,
  selectionInput: ExportSelection = {},
): PreparedReviewExport {
  const reviewId = ApplicationIdSchema.parse(reviewIdInput);
  const selection = exportSelectionSchema.parse(selectionInput);
  const repositories = createRepositories();
  const aggregate = repositories.reviews.getAggregate(reviewId);

  if (!aggregate) {
    throw new AppError("not_found", "The review was not found.");
  }

  const designRows = repositories.analysisArtifacts.listDesignAnalyses(reviewId);
  const criteriaRows = repositories.analysisArtifacts.listCriteriaAnalyses(reviewId);
  const selectedRows = selectArtifactRows(designRows, criteriaRows, selection);

  if (!selectedRows.design && !selectedRows.criteria) {
    throw new AppError(
      "analysis_not_ready",
      "This review does not have a completed analysis to export.",
    );
  }

  const designAnalysis = selectedRows.design
    ? materialiseDesignAnalysis(selectedRows.design)
    : null;
  const criteriaAnalysis = selectedRows.criteria
    ? materialiseCriteriaAnalysis(selectedRows.criteria)
    : null;

  const bundle: ReviewExport = {
    exportSchemaVersion: "1.1.0",
    review: {
      id: aggregate.review.id,
      title: aggregate.review.title,
      lifecycle: aggregate.review.lifecycle,
      createdAt: aggregate.review.createdAt,
      updatedAt: aggregate.review.updatedAt,
    },
    designAnalysis,
    designAnalysisVersion: selectedRows.design
      ? versionInformation(selectedRows.design)
      : null,
    criteriaAnalysis,
    criteriaAnalysisVersion: selectedRows.criteria
      ? versionInformation(selectedRows.criteria)
      : null,
    integratedReview:
      designAnalysis &&
      criteriaAnalysis &&
      criteriaAnalysis.designAnalysisId === designAnalysis.id
        ? buildIntegratedReview(designAnalysis, criteriaAnalysis)
        : null,
  };

  return {
    bundle,
    filenameStem: safeExportFilenameStem(aggregate.review.title, aggregate.review.id),
  };
}

function selectArtifactRows(
  designRows: DesignAnalysisRow[],
  criteriaRows: CriteriaAnalysisRow[],
  selection: ExportSelection,
): { design: DesignAnalysisRow | null; criteria: CriteriaAnalysisRow | null } {
  const explicitCriteria = selection.criteriaAnalysisId
    ? criteriaRows.find(({ id }) => id === selection.criteriaAnalysisId)
    : undefined;

  if (selection.criteriaAnalysisId && !explicitCriteria) {
    throw new AppError(
      "not_found",
      "The requested Criteria Analysis was not found for this review.",
    );
  }

  const explicitDesign = selection.designAnalysisId
    ? designRows.find(({ id }) => id === selection.designAnalysisId)
    : undefined;

  if (selection.designAnalysisId && !explicitDesign) {
    throw new AppError(
      "not_found",
      "The requested Design Analysis was not found for this review.",
    );
  }

  if (
    explicitCriteria &&
    explicitDesign &&
    explicitCriteria.designAnalysisId !== explicitDesign.id
  ) {
    throw new AppError(
      "bad_request",
      "The requested Criteria Analysis was produced from a different Design Analysis.",
    );
  }

  if (explicitCriteria) {
    const linkedDesign =
      explicitDesign ??
      designRows.find(({ id }) => id === explicitCriteria.designAnalysisId);
    if (!linkedDesign) {
      throw new AppError(
        "database_error",
        "The completed Criteria Analysis no longer has its source Design Analysis.",
      );
    }
    return { design: linkedDesign, criteria: explicitCriteria };
  }

  if (explicitDesign) {
    const matchingCriteria = criteriaRows
      .filter(({ designAnalysisId }) => designAnalysisId === explicitDesign.id)
      .at(-1);
    return { design: explicitDesign, criteria: matchingCriteria ?? null };
  }

  const latestCriteria = criteriaRows.at(-1);
  if (latestCriteria) {
    const linkedDesign = designRows.find(({ id }) => id === latestCriteria.designAnalysisId);
    if (!linkedDesign) {
      throw new AppError(
        "database_error",
        "The completed Criteria Analysis no longer has its source Design Analysis.",
      );
    }
    return { design: linkedDesign, criteria: latestCriteria };
  }

  return { design: designRows.at(-1) ?? null, criteria: null };
}

function materialiseDesignAnalysis(row: DesignAnalysisRow): DesignAnalysis {
  const artifact = recordArtifact(row.artifact, "Design Analysis");
  const parsed = DesignAnalysisSchema.safeParse({
    id: row.id,
    reviewId: row.reviewId,
    version: row.version,
    createdAt: row.createdAt,
    inputSnapshot: row.inputSnapshot,
    passProvenance: row.passProvenance,
    evidence: artifact.evidence,
    findings: artifact.findings,
    synthesis: artifact.synthesis,
  });

  if (!parsed.success) {
    throw new AppError(
      "database_error",
      "The completed Design Analysis could not be validated for export.",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function materialiseCriteriaAnalysis(row: CriteriaAnalysisRow): CriteriaAnalysis {
  const artifact = recordArtifact(row.artifact, "Criteria Analysis");
  const parsed = CriteriaAnalysisSchema.safeParse({
    id: row.id,
    reviewId: row.reviewId,
    version: row.version,
    designAnalysisId: row.designAnalysisId,
    createdAt: row.createdAt,
    inputSnapshot: row.inputSnapshot,
    passProvenance: row.passProvenance,
    results: artifact.results,
    synthesis: artifact.synthesis,
  });

  if (!parsed.success) {
    throw new AppError(
      "database_error",
      "The completed Criteria Analysis could not be validated for export.",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function recordArtifact(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("database_error", `The completed ${label} artifact is invalid.`);
  }
  return value as Record<string, unknown>;
}

function versionInformation(
  row: DesignAnalysisRow | CriteriaAnalysisRow,
): AnalysisVersionInformation {
  return {
    schemaVersion: row.schemaVersion,
    promptSetVersion: row.promptSetVersion,
  };
}

export function buildIntegratedReview(
  design: DesignAnalysis,
  criteria: CriteriaAnalysis,
): IntegratedReview {
  const criteriaById = new Map(
    criteria.inputSnapshot.criteria.map((criterion) => [criterion.id, criterion]),
  );
  const designFindingsById = new Map(design.findings.map((finding) => [finding.id, finding]));

  return {
    kind: "deterministic_relationship_view",
    designAnalysisId: design.id,
    criteriaAnalysisId: criteria.id,
    relationships: criteria.results.map((result) => {
      const criterion = criteriaById.get(result.criterionId);
      if (!criterion) {
        throw new AppError(
          "database_error",
          "A completed criterion result no longer matches its immutable snapshot.",
        );
      }

      const linkedIds = new Set(
        [...result.supportingEvidence, ...result.counterEvidence].flatMap(
          ({ designFindingIds }) => designFindingIds,
        ),
      );
      const linkedDesignFindings = [...linkedIds]
        .map((findingId) => designFindingsById.get(findingId))
        .filter((finding): finding is DesignFinding => finding !== undefined)
        .map(({ id, observation, significance, confidence }) => ({
          id,
          observation,
          significance,
          confidence,
        }));

      return {
        criterionId: result.criterionId,
        criterionTitle: criterion.title,
        decision: criterionDecision(criterion, result),
        confidence: result.confidence,
        designRelationship: result.designRelationship,
        rationale: result.rationale,
        linkedDesignFindings,
      };
    }),
  };
}

function criterionDecision(
  criterion: Criterion,
  result: CriterionResult,
): IntegratedRelationship["decision"] {
  if (result.selectedJudgementStatementId) {
    const statement = criterion.judgementStatements.find(
      ({ id }) => id === result.selectedJudgementStatementId,
    );
    if (!statement) {
      throw new AppError(
        "database_error",
        "A completed criterion decision no longer matches its immutable snapshot.",
      );
    }
    return {
      kind: "judgement_statement",
      id: statement.id,
      label: statement.label,
    };
  }

  if (!result.fallbackStatus) {
    throw new AppError("database_error", "A completed criterion decision is missing.");
  }
  return {
    kind: "fallback_status",
    id: null,
    label: humaniseIdentifier(result.fallbackStatus),
  };
}

export function renderReviewExportJson(bundle: ReviewExport): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function renderReviewExportMarkdown(bundle: ReviewExport): string {
  const lines: string[] = [];
  const reviewTitle = bundle.review.title ?? "Untitled review";

  lines.push(`# ${markdownText(reviewTitle)}`, "", "## Review metadata", "");
  lines.push(`- Review ID: ${markdownText(bundle.review.id)}`);
  lines.push(`- Lifecycle: ${markdownText(humaniseIdentifier(bundle.review.lifecycle))}`);
  lines.push(`- Created: ${markdownText(bundle.review.createdAt)}`);
  lines.push(`- Last updated: ${markdownText(bundle.review.updatedAt)}`, "");

  const capturedContext =
    bundle.criteriaAnalysis?.inputSnapshot.context ??
    bundle.designAnalysis?.inputSnapshot.context ??
    null;
  lines.push("## Context captured for analysis", "");
  lines.push(capturedContext ? markdownText(capturedContext) : "No context was supplied.", "");

  renderVersionInformation(lines, bundle);
  if (bundle.designAnalysis) renderDesignAnalysis(lines, bundle.designAnalysis);
  if (bundle.criteriaAnalysis) renderCriteriaAnalysis(lines, bundle.criteriaAnalysis);
  if (bundle.integratedReview) renderIntegratedReview(lines, bundle.integratedReview);

  lines.push(
    "## Export note",
    "",
    "This report was generated deterministically from completed, persisted structured analyses. It contains no source images and did not trigger a model request.",
    "",
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderVersionInformation(lines: string[], bundle: ReviewExport): void {
  lines.push("## Analysis versions", "");

  if (bundle.designAnalysis && bundle.designAnalysisVersion) {
    lines.push("### Design Analysis", "");
    renderAnalysisVersion(
      lines,
      bundle.designAnalysis,
      bundle.designAnalysisVersion,
    );
  } else {
    lines.push("No Design Analysis is included.", "");
  }

  if (bundle.criteriaAnalysis && bundle.criteriaAnalysisVersion) {
    lines.push("### Criteria Analysis", "");
    renderAnalysisVersion(
      lines,
      bundle.criteriaAnalysis,
      bundle.criteriaAnalysisVersion,
    );
  } else {
    lines.push("No Criteria Analysis is included.", "");
  }
}

function renderAnalysisVersion(
  lines: string[],
  analysis: DesignAnalysis | CriteriaAnalysis,
  version: AnalysisVersionInformation,
): void {
  lines.push(`- Artifact ID: ${markdownText(analysis.id)}`);
  lines.push(`- Version: ${analysis.version}`);
  lines.push(`- Created: ${markdownText(analysis.createdAt)}`);
  lines.push(`- Domain schema: ${markdownText(version.schemaVersion)}`);
  lines.push(`- Prompt set: ${markdownText(version.promptSetVersion)}`);
  lines.push("- Image purposes:");
  for (const image of analysis.inputSnapshot.images) {
    lines.push(
      `  - ${markdownText(image.imageId)}: ${image.analysisRole === "concept_development" ? "Concept & development" : "Final work"}`,
    );
  }
  lines.push("- Passes:");
  for (const pass of analysis.passProvenance) {
    const model = pass.modelConfiguration?.model
      ? `; model ${markdownText(pass.modelConfiguration.model)}`
      : "";
    lines.push(
      `  - ${markdownText(pass.passId)}: ${markdownText(pass.state)}; prompt ${markdownText(pass.promptVersion)}; schema ${markdownText(pass.schemaVersion)}${model}`,
    );
  }
  lines.push("");
}

function renderDesignAnalysis(lines: string[], analysis: DesignAnalysis): void {
  const synthesis = analysis.synthesis;
  lines.push("## Design Review", "", "### Overall reading", "");
  lines.push(markdownText(synthesis.overallReading.text), "");

  renderStatementSection(lines, "Strengths", synthesis.strengths);
  renderStatementSection(lines, "Development priorities", synthesis.developmentPriorities);
  if (synthesis.majorReviewAreas) {
    lines.push("### Major review areas", "");
    renderMajorReviewArea(
      lines,
      "Elements of design",
      synthesis.majorReviewAreas.elementsOfDesign,
    );
    renderMajorReviewArea(
      lines,
      "Principles of design",
      synthesis.majorReviewAreas.principlesOfDesign,
    );
    renderMajorReviewArea(
      lines,
      "Applied visual communication",
      synthesis.majorReviewAreas.appliedVisualCommunication,
    );
  }
  if (synthesis.conceptAndDevelopment) {
    lines.push("### Concept and development", "", "#### Process overview", "");
    lines.push(markdownText(synthesis.conceptAndDevelopment.overallReading.text), "");
    renderStatementSection(
      lines,
      "Process strengths",
      synthesis.conceptAndDevelopment.strengths,
    );
    renderStatementSection(
      lines,
      "Process development priorities",
      synthesis.conceptAndDevelopment.developmentPriorities,
    );
    renderStatementSection(
      lines,
      "Relationship to the final work",
      synthesis.conceptAndDevelopment.relationshipToFinalWork,
    );
  }
  renderStatementSection(lines, "Focus-area feedback", synthesis.focusAreaFeedback);
  if (synthesis.contextAlignment) {
    lines.push("### Context alignment", "", markdownText(synthesis.contextAlignment.text), "");
  }
  renderStatementSection(lines, "Next steps", synthesis.nextSteps);
  if (synthesis.uncertainty) {
    lines.push("### Uncertainty", "", markdownText(synthesis.uncertainty), "");
  }

  lines.push("### Adjudicated findings", "");
  if (analysis.findings.length === 0) {
    lines.push("No adjudicated findings were recorded.", "");
    return;
  }

  analysis.findings.forEach((finding, index) => {
    lines.push(`#### Finding ${index + 1}`, "");
    lines.push(`- Significance: ${markdownText(humaniseIdentifier(finding.significance))}`);
    lines.push(`- Confidence: ${markdownText(humaniseIdentifier(finding.confidence))}`);
    lines.push(
      `- Review areas: ${finding.reviewAreaIds.map(markdownText).join(", ")}`,
    );
    lines.push(`- Focus related: ${finding.focusRelated ? "Yes" : "No"}`, "");
    lines.push(`Observation: ${markdownText(finding.observation)}`, "");
    lines.push(`Interpretation: ${markdownText(finding.interpretation)}`, "");
    if (finding.likelyEffect) {
      lines.push(`Likely effect: ${markdownText(finding.likelyEffect)}`, "");
    }
    if (finding.alternativeInterpretation) {
      lines.push(
        `Alternative interpretation: ${markdownText(finding.alternativeInterpretation)}`,
        "",
      );
    }
  });
}

function renderMajorReviewArea(
  lines: string[],
  heading: string,
  analysis: {
    strengths: Array<{ text: string }>;
    areasForImprovement: Array<{ text: string }>;
  },
): void {
  lines.push(`#### ${heading}`, "", "##### Strengths", "");
  if (analysis.strengths.length === 0) {
    lines.push("None recorded.", "");
  } else {
    analysis.strengths.forEach(({ text }) => lines.push(`- ${markdownText(text)}`));
    lines.push("");
  }
  lines.push("##### Areas for improvement", "");
  if (analysis.areasForImprovement.length === 0) {
    lines.push("None recorded.", "");
  } else {
    analysis.areasForImprovement.forEach(({ text }) =>
      lines.push(`- ${markdownText(text)}`),
    );
    lines.push("");
  }
}

function renderStatementSection(
  lines: string[],
  heading: string,
  statements: Array<{ text: string }>,
): void {
  lines.push(`### ${heading}`, "");
  if (statements.length === 0) {
    lines.push("None recorded.", "");
    return;
  }
  for (const statement of statements) {
    lines.push(`- ${markdownText(statement.text)}`);
  }
  lines.push("");
}

function renderCriteriaAnalysis(lines: string[], analysis: CriteriaAnalysis): void {
  const criteriaById = new Map(
    analysis.inputSnapshot.criteria.map((criterion) => [criterion.id, criterion]),
  );
  const synthesisByCriterion = new Map(
    analysis.synthesis.criteria.map((item) => [item.criterionId, item]),
  );
  const imageRoles = new Map(
    analysis.inputSnapshot.images.map(({ imageId, analysisRole }) => [
      imageId,
      analysisRole,
    ]),
  );

  lines.push("## Criteria Review", "", "### Overall summary", "");
  lines.push(markdownText(analysis.synthesis.overallSummary), "");

  analysis.results.forEach((result, index) => {
    const criterion = criteriaById.get(result.criterionId);
    if (!criterion) return;
    const decision = criterionDecision(criterion, result);
    const synthesis = synthesisByCriterion.get(result.criterionId);

    lines.push(`### Criterion ${index + 1}: ${markdownText(criterion.title)}`, "");
    lines.push(markdownText(criterion.statement), "");
    lines.push(`- Decision: ${markdownText(decision.label)}`);
    lines.push(`- Confidence: ${markdownText(humaniseIdentifier(result.confidence))}`);
    lines.push(
      `- Design relationship: ${markdownText(humaniseIdentifier(result.designRelationship))}`,
      "",
    );
    lines.push(`Rationale: ${markdownText(result.rationale)}`, "");
    renderCriterionEvidence(lines, "Supporting evidence", result.supportingEvidence, imageRoles);
    renderCriterionEvidence(lines, "Counter-evidence", result.counterEvidence, imageRoles);
    if (result.alternativeJudgement) {
      lines.push(
        `Material alternative: ${markdownText(result.alternativeJudgement)}`,
        "",
      );
    }
    if (synthesis) {
      lines.push(`Summary: ${markdownText(synthesis.summary)}`, "");
      if (synthesis.improvement) {
        lines.push(`Development direction: ${markdownText(synthesis.improvement)}`, "");
      }
    }
  });

  renderPlainList(
    lines,
    "Cross-criterion observations",
    analysis.synthesis.crossCriterionObservations,
  );
  if (analysis.synthesis.uncertainty) {
    lines.push("### Uncertainty", "", markdownText(analysis.synthesis.uncertainty), "");
  }
}

function renderCriterionEvidence(
  lines: string[],
  heading: string,
  evidence: CriterionResult["supportingEvidence"],
  imageRoles: Map<string, "final_work" | "concept_development">,
): void {
  lines.push(`#### ${heading}`, "");
  if (evidence.length === 0) {
    lines.push("None recorded.", "");
    return;
  }
  evidence.forEach((item) => {
    const region = item.regionDescription
      ? ` (${markdownText(item.regionDescription)})`
      : "";
    const role = imageRoles.get(item.imageId) === "concept_development"
      ? "Concept & development"
      : "Final work";
    lines.push(
      `- Image ${markdownText(item.imageId)} [${role}]${region}: ${markdownText(item.observation)}`,
    );
  });
  lines.push("");
}

function renderIntegratedReview(lines: string[], integrated: IntegratedReview): void {
  lines.push(
    "## Integrated Review",
    "",
    "This is a deterministic relationship view. It adds no new model judgement.",
    "",
  );
  for (const relationship of integrated.relationships) {
    lines.push(`### ${markdownText(relationship.criterionTitle)}`, "");
    lines.push(`- Criterion decision: ${markdownText(relationship.decision.label)}`);
    lines.push(
      `- Design relationship: ${markdownText(humaniseIdentifier(relationship.designRelationship))}`,
    );
    lines.push(`- Confidence: ${markdownText(humaniseIdentifier(relationship.confidence))}`, "");
    lines.push(`Rationale: ${markdownText(relationship.rationale)}`, "");
    lines.push("Linked adjudicated design findings:", "");
    if (relationship.linkedDesignFindings.length === 0) {
      lines.push("No explicit Design finding link was recorded.", "");
    } else {
      relationship.linkedDesignFindings.forEach((finding) => {
        lines.push(
          `- ${markdownText(finding.observation)} (${markdownText(finding.significance)}, ${markdownText(finding.confidence)} confidence)`,
        );
      });
      lines.push("");
    }
  }
}

function renderPlainList(lines: string[], heading: string, values: string[]): void {
  lines.push(`### ${heading}`, "");
  if (values.length === 0) {
    lines.push("None recorded.", "");
    return;
  }
  values.forEach((value) => lines.push(`- ${markdownText(value)}`));
  lines.push("");
}

/** Escapes persisted text so it remains text when an export is rendered as Markdown. */
export function markdownText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}\[\]()#+.!|~-])/g, "\\$1");
}

export function safeExportFilenameStem(title: string | null, reviewId: string): string {
  const titleToken = (title ?? "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  const idToken = reviewId.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12);
  const identity = idToken || "review";
  return `visual-design-review-${titleToken || "untitled"}-${identity}`;
}

function humaniseIdentifier(value: string): string {
  const humanised = value.replace(/_/g, " ").trim();
  return humanised ? `${humanised[0].toUpperCase()}${humanised.slice(1)}` : value;
}
