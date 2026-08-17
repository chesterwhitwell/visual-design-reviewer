export type ReviewMode = "off" | "review" | "focus";
export type ImageAnalysisRole = "final_work" | "concept_development";

export type ReviewImage = {
  id: string;
  originalFilename?: string | null;
  displayName?: string | null;
  mimeType: string;
  width: number;
  height: number;
  order?: number;
  position?: number;
  analysisRole: ImageAnalysisRole;
  retainedLocally: boolean;
  previewUrl?: string | null;
  state?: "available" | "purge_pending" | "purged";
};

export type TaxonomyArea = {
  id: string;
  label: string;
  description?: string | null;
  categoryId?: string;
  order?: number;
};

export type TaxonomyCategory = {
  id: string;
  label: string;
  parentId?: string | null;
  order?: number;
  areas?: TaxonomyArea[];
  groups?: TaxonomyCategory[];
  categories?: TaxonomyCategory[];
};

export type Taxonomy = {
  id: string;
  version: string;
  label?: string;
  categories: TaxonomyCategory[];
  areas?: TaxonomyArea[];
};

export type ReviewAreaSelection = {
  areaId: string;
  mode: ReviewMode;
};

export type JudgementStatement = {
  id: string;
  label: string;
  description: string;
  order: number;
};

export type Criterion = {
  id: string;
  title: string;
  statement: string;
  assessorNote?: string | null;
  judgementStatements: JudgementStatement[];
  order: number;
};

export type CriteriaSetCriterion = {
  title: string;
  statement: string;
  assessorNote: string | null;
  judgementStatements: Array<{
    label: string;
    description: string;
  }>;
};

export type CriteriaSetSummary = {
  id: string;
  name: string;
  description: string | null;
  schemaVersion: "1.0.0";
  criterionCount: number;
  judgementStatementCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CriteriaSet = Omit<CriteriaSetSummary, "criterionCount" | "judgementStatementCount"> & {
  criteria: CriteriaSetCriterion[];
};

export type SynthesisStatement =
  | string
  | {
      text: string;
      sourceFindingIds?: string[];
    };

export type MajorReviewAreaAnalysis = {
  strengths: SynthesisStatement[];
  areasForImprovement: SynthesisStatement[];
};

export type ConceptDevelopmentAnalysis = {
  overallReading: SynthesisStatement;
  strengths: SynthesisStatement[];
  developmentPriorities: SynthesisStatement[];
  relationshipToFinalWork: SynthesisStatement[];
};

export type AnalysisImageSnapshot = {
  imageId: string;
  order: number;
  analysisRole?: ImageAnalysisRole;
};

export type EvidenceItem = {
  id: string;
  imageId: string;
  regionDescription?: string;
  reviewAreaId: string;
  observation: string;
  confidence: "low" | "medium" | "high";
  uncertainty?: string;
};

export type DesignFinding = {
  id: string;
  sourceFindingIds?: string[];
  reviewAreaIds: string[];
  observation: string;
  interpretation: string;
  likelyEffect?: string;
  supportingEvidenceIds: string[];
  contextAlignment?: string;
  alternativeInterpretation?: string;
  significance: "minor" | "moderate" | "major";
  confidence: "low" | "medium" | "high";
  focusRelated: boolean;
  adversarialStatus: string;
  adjudication: string;
};

export type PassProvenance = {
  passId?: string;
  passKey?: string;
  state: string;
  promptVersion?: string;
  schemaVersion?: string;
  durationMs?: number;
  modelConfiguration?: {
    provider?: string;
    model?: string;
    imageDetail?: string;
    reasoningEffort?: string;
  };
  usage?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
    outputTokens?: number;
    reasoningOutputTokens?: number;
    totalTokens?: number;
    estimatedCostMicroUsd?: number;
  };
};

export type DesignAnalysis = {
  id: string;
  version: number;
  createdAt: string;
  inputSnapshot?: {
    imageRevisionId?: string;
    context?: string | null;
    images?: AnalysisImageSnapshot[];
    reviewAreas?: Array<ReviewAreaSelection & { areaLabel?: string }>;
  };
  passProvenance?: PassProvenance[];
  schemaVersion?: string;
  promptSetVersion?: string;
  promptVersion?: string;
  evidence: EvidenceItem[];
  findings: DesignFinding[];
  synthesis: {
    overallReading: SynthesisStatement;
    strengths: SynthesisStatement[];
    developmentPriorities: SynthesisStatement[];
    majorReviewAreas?: {
      elementsOfDesign: MajorReviewAreaAnalysis;
      principlesOfDesign: MajorReviewAreaAnalysis;
      appliedVisualCommunication: MajorReviewAreaAnalysis;
    };
    conceptAndDevelopment?: ConceptDevelopmentAnalysis;
    focusAreaFeedback: SynthesisStatement[];
    contextAlignment?: SynthesisStatement;
    nextSteps: SynthesisStatement[];
    uncertainty?: string;
  };
};

export type CriterionEvidence = {
  id?: string;
  criterionId?: string;
  imageId: string;
  regionDescription?: string;
  observation: string;
  designFindingIds?: string[];
};

export type CriterionResult = {
  criterionId: string;
  supportingEvidence: CriterionEvidence[];
  counterEvidence: CriterionEvidence[];
  selectedJudgementStatementId?: string;
  fallbackStatus?: string;
  rationale: string;
  alternativeJudgement?: string;
  confidence: "low" | "medium" | "high";
  designRelationship?: string;
};

export type CriteriaAnalysis = {
  id: string;
  version: number;
  designAnalysisId: string;
  createdAt: string;
  inputSnapshot?: {
    imageRevisionId?: string;
    criteria?: Criterion[];
    context?: string | null;
    images?: AnalysisImageSnapshot[];
  };
  criteriaSnapshot?: Criterion[];
  passProvenance?: PassProvenance[];
  schemaVersion?: string;
  promptSetVersion?: string;
  promptVersion?: string;
  results: CriterionResult[];
  synthesis:
    | string
    | {
        overallSummary: string;
        criteria?: Array<{
          criterionId: string;
          summary: string;
          improvement?: string;
          sourceEvidenceIds?: string[];
        }>;
        crossCriterionObservations?: string[];
        uncertainty?: string;
      };
};

export type RunPass = {
  id?: string;
  passId?: string;
  passKey?: string;
  state: string;
  position?: number;
  safeErrorMessage?: string | null;
  error?: { message?: string; retryable?: boolean };
};

export type AnalysisRun = {
  id: string;
  kind: "design" | "criteria";
  state: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  finishedAt?: string | null;
  safeErrorMessage?: string | null;
  error?: { message?: string; retryable?: boolean };
  passes?: RunPass[];
};

export type Review = {
  id: string;
  title?: string | null;
  context?: string | null;
  lifecycle: "active" | "closed";
  updatedAt: string;
  imageRevisionId?: string | null;
  images: ReviewImage[];
  taxonomy: Taxonomy;
  reviewAreas: ReviewAreaSelection[];
  criteria: Criterion[];
  designAnalyses: DesignAnalysis[];
  criteriaAnalyses: CriteriaAnalysis[];
  runs: AnalysisRun[];
};

export type ResultTab = "design" | "criteria" | "integrated" | "detail";
