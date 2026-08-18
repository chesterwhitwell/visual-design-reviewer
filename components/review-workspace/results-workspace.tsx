import styles from "./review-workspace.module.css";
import type {
  CriteriaAnalysis,
  Criterion,
  CriterionEvidence,
  CriterionResult,
  DesignAnalysis,
  DesignFinding,
  PassProvenance,
  ResultTab,
  SynthesisStatement,
} from "./types";
import { DownloadIcon, SparklesIcon } from "./workspace-icons";

type Props = {
  reviewId: string;
  reviewTitle: string;
  designAnalyses: DesignAnalysis[];
  criteriaAnalyses: CriteriaAnalysis[];
  currentCriteria: Criterion[];
  selectedDesignId: string | null;
  selectedCriteriaId: string | null;
  tab: ResultTab;
  onDesignSelect: (id: string) => void;
  onCriteriaSelect: (id: string) => void;
  onTabChange: (tab: ResultTab) => void;
};

const tabs: Array<{ id: ResultTab; label: string }> = [
  { id: "design", label: "Design Review" },
  { id: "criteria", label: "Criteria Review" },
  { id: "integrated", label: "Integrated" },
  { id: "detail", label: "Analysis Detail" },
];

export function ResultsWorkspace({
  reviewId,
  reviewTitle,
  designAnalyses,
  criteriaAnalyses,
  currentCriteria,
  selectedDesignId,
  selectedCriteriaId,
  tab,
  onDesignSelect,
  onCriteriaSelect,
  onTabChange,
}: Props) {
  const orderedDesign = [...designAnalyses].sort((a, b) => b.version - a.version);
  const orderedCriteria = [...criteriaAnalyses].sort((a, b) => b.version - a.version);
  const design = orderedDesign.find((analysis) => analysis.id === selectedDesignId) ?? orderedDesign[0];
  const criteria = orderedCriteria.find((analysis) => analysis.id === selectedCriteriaId) ?? orderedCriteria[0];
  const criteriaSnapshot = criteria?.criteriaSnapshot ?? criteria?.inputSnapshot?.criteria ?? currentCriteria;
  const exportQuery = new URLSearchParams();
  if (design) exportQuery.set("designAnalysisId", design.id);
  if (criteria) exportQuery.set("criteriaAnalysisId", criteria.id);
  const exportSuffix = exportQuery.size ? `?${exportQuery.toString()}` : "";

  return (
    <section className={styles.resultsPanel} aria-labelledby="results-title">
      <div className={styles.resultsHeading}>
        <div>
          <span className={styles.panelKicker}>Evidence-grounded output</span>
          <h2 id="results-title">Review results</h2>
        </div>
        <div className={styles.exportActions}>
          <a href={`/api/reviews/${encodeURIComponent(reviewId)}/exports/markdown${exportSuffix}`}>
            <DownloadIcon /> Markdown
          </a>
          <a href={`/api/reviews/${encodeURIComponent(reviewId)}/exports/json${exportSuffix}`}>
            <DownloadIcon /> JSON
          </a>
        </div>
      </div>

      <div className={styles.versionBar}>
        <label>
          <span>Design version</span>
          <select disabled={orderedDesign.length === 0} onChange={(event) => onDesignSelect(event.target.value)} value={design?.id ?? ""}>
            {orderedDesign.length === 0 ? <option value="">Not run</option> : null}
            {orderedDesign.map((analysis) => (
              <option key={analysis.id} value={analysis.id}>Version {analysis.version} · {resultImageSummary(analysis.inputSnapshot?.images)} · {formatDate(analysis.createdAt)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Criteria version</span>
          <select disabled={orderedCriteria.length === 0} onChange={(event) => onCriteriaSelect(event.target.value)} value={criteria?.id ?? ""}>
            {orderedCriteria.length === 0 ? <option value="">Not run</option> : null}
            {orderedCriteria.map((analysis) => (
              <option key={analysis.id} value={analysis.id}>Version {analysis.version} · Design v{designVersionFor(analysis, designAnalyses)}</option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Review result views">
        {tabs.map((item) => (
          <button
            aria-controls={`result-panel-${item.id}`}
            aria-selected={tab === item.id}
            className={tab === item.id ? styles.activeTab : ""}
            id={`result-tab-${item.id}`}
            key={item.id}
            onClick={() => onTabChange(item.id)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`result-tab-${tab}`}
        className={styles.resultBody}
        id={`result-panel-${tab}`}
        role="tabpanel"
        tabIndex={0}
      >
        {tab === "design" ? <DesignReview analysis={design} /> : null}
        {tab === "criteria" ? <CriteriaReview analysis={criteria} criteria={criteriaSnapshot} /> : null}
        {tab === "integrated" ? (
          <IntegratedReview
            criteria={criteriaSnapshot}
            criteriaAnalysis={criteria}
            designAnalysis={design}
          />
        ) : null}
        {tab === "detail" ? (
          <AnalysisDetail criteriaAnalysis={criteria} designAnalysis={design} reviewTitle={reviewTitle} />
        ) : null}
      </div>
    </section>
  );
}

function DesignReview({ analysis }: { analysis?: DesignAnalysis }) {
  if (!analysis) {
    return <ResultEmpty icon="design" title="No Design Review yet" text="Run Design Analysis when images and at least one review area are ready. Criteria are not required." />;
  }

  const synthesis = analysis.synthesis;
  return (
    <div className={styles.designReview}>
      <section className={styles.overallReading}>
        <span className={styles.analysisVersion}>Design Analysis · Version {analysis.version} · {resultImageSummary(analysis.inputSnapshot?.images)}</span>
        <h3>Overall reading</h3>
        <p>{statementText(synthesis.overallReading)}</p>
        {synthesis.uncertainty ? <div className={styles.uncertainty}><strong>Uncertainty</strong>{synthesis.uncertainty}</div> : null}
      </section>
      <div className={styles.synthesisGrid}>
        <SynthesisSection className={styles.strengthSection} title="Strongest aspects" items={synthesis.strengths} />
        <SynthesisSection className={styles.prioritySection} title="Development priorities" items={synthesis.developmentPriorities} ordered />
      </div>
      <MajorReviewAreas areas={synthesis.majorReviewAreas} />
      <ConceptDevelopmentReview
        analysis={synthesis.conceptAndDevelopment}
        hasDevelopmentImages={(analysis.inputSnapshot?.images ?? []).some(
          ({ analysisRole }) => analysisRole === "concept_development",
        )}
      />
      {synthesis.focusAreaFeedback.length > 0 ? <SynthesisSection title="Focus-area discussion" items={synthesis.focusAreaFeedback} /> : null}
      {synthesis.contextAlignment ? (
        <section className={styles.proseSection}>
          <h3>Intention and context alignment</h3>
          <p>{statementText(synthesis.contextAlignment)}</p>
        </section>
      ) : null}
      <SynthesisSection title="Suggested next steps" items={synthesis.nextSteps} ordered />
    </div>
  );
}

function ConceptDevelopmentReview({
  analysis,
  hasDevelopmentImages,
}: {
  analysis?: DesignAnalysis["synthesis"]["conceptAndDevelopment"];
  hasDevelopmentImages: boolean;
}) {
  if (!hasDevelopmentImages && !analysis) return null;
  return (
    <section aria-labelledby="concept-development-heading" className={styles.conceptDevelopmentReview}>
      <div className={styles.majorReviewAreasHeading}>
        <span className={styles.sectionEyebrow}>Process evidence</span>
        <h3 id="concept-development-heading">Concept and development</h3>
        <p>Visible exploration and refinement, considered in relation to the submitted final work.</p>
      </div>
      {analysis ? (
        <>
          <section className={styles.processOverall}>
            <h4>Process overview</h4>
            <p>{statementText(analysis.overallReading)}</p>
          </section>
          <div className={styles.processGrid}>
            <SynthesisSection title="Process strengths" items={analysis.strengths} />
            <SynthesisSection title="Development priorities" items={analysis.developmentPriorities} ordered />
          </div>
          <SynthesisSection
            title="Relationship to the final work"
            items={analysis.relationshipToFinalWork}
          />
        </>
      ) : (
        <p className={styles.legacyCategoryNotice}>Run a new Design Analysis to add process-aware feedback to this earlier result.</p>
      )}
    </section>
  );
}

function MajorReviewAreas({
  areas,
}: {
  areas?: DesignAnalysis["synthesis"]["majorReviewAreas"];
}) {
  const definitions = [
    ["elementsOfDesign", "Elements of design"],
    ["principlesOfDesign", "Principles of design"],
    ["appliedVisualCommunication", "Applied visual communication"],
  ] as const;

  return (
    <section aria-labelledby="major-review-areas-heading" className={styles.majorReviewAreas}>
      <div className={styles.majorReviewAreasHeading}>
        <span className={styles.sectionEyebrow}>Category analysis</span>
        <h3 id="major-review-areas-heading">Major review areas</h3>
        <p>Strengths and areas for improvement, grouped by the foundations and application of the visual communication.</p>
      </div>
      {areas ? (
        <div className={styles.majorReviewAreaGrid}>
          {definitions.map(([key, label]) => (
            <article className={styles.majorReviewAreaCard} key={key}>
              <h4>{label}</h4>
              <div className={styles.majorReviewAreaColumns}>
                <CategoryStatementList items={areas[key].strengths} title="Strengths" />
                <CategoryStatementList
                  improvement
                  items={areas[key].areasForImprovement}
                  title="Areas for improvement"
                />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className={styles.legacyCategoryNotice}>Run a new Design Analysis to add category-level feedback to this earlier result.</p>
      )}
    </section>
  );
}

function CategoryStatementList({
  improvement = false,
  items,
  title,
}: {
  improvement?: boolean;
  items: SynthesisStatement[];
  title: string;
}) {
  return (
    <div className={improvement ? styles.categoryImprovement : styles.categoryStrength}>
      <h5>{title}</h5>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${statementText(item)}-${index}`}>{statementText(item)}</li>
          ))}
        </ul>
      ) : (
        <p>No grounded {improvement ? "improvement area" : "strength"} was recorded.</p>
      )}
    </div>
  );
}

function SynthesisSection({
  className = "",
  items,
  ordered,
  title,
}: {
  className?: string;
  items: SynthesisStatement[];
  ordered?: boolean;
  title: string;
}) {
  const List = ordered ? "ol" : "ul";
  return (
    <section className={`${styles.synthesisSection} ${className}`}>
      <h3>{title}</h3>
      {items.length ? (
        <List>{items.map((item, index) => <li key={`${statementText(item)}-${index}`}>{statementText(item)}</li>)}</List>
      ) : <p className={styles.mutedResult}>No material findings were recorded in this section.</p>}
    </section>
  );
}

function CriteriaReview({ analysis, criteria }: { analysis?: CriteriaAnalysis; criteria: Criterion[] }) {
  if (!analysis) {
    return <ResultEmpty icon="criteria" title="No Criteria Review yet" text="Save at least one criterion, select a Design Analysis version, then run Criteria Analysis." />;
  }

  const synthesis = typeof analysis.synthesis === "string" ? analysis.synthesis : analysis.synthesis.overallSummary;
  const criterionSynthesis = typeof analysis.synthesis === "string" ? [] : (analysis.synthesis.criteria ?? []);
  const imageRoles = imageRoleMap(analysis.inputSnapshot?.images);

  return (
    <div>
      <section className={styles.criteriaOverall}>
        <span className={styles.analysisVersion}>Criteria Analysis · Version {analysis.version} · {resultImageSummary(analysis.inputSnapshot?.images)}</span>
        <h3>Criterion-referenced summary</h3>
        <p>{synthesis}</p>
      </section>
      <div className={styles.criterionResults}>
        {analysis.results.map((result, index) => {
          const criterion = criteria.find((item) => item.id === result.criterionId);
          const localSynthesis = criterionSynthesis.find((item) => item.criterionId === result.criterionId);
          return (
            <CriterionResultCard criterion={criterion} imageRoles={imageRoles} index={index} key={result.criterionId} result={result} synthesis={localSynthesis} />
          );
        })}
      </div>
      {typeof analysis.synthesis !== "string" && (analysis.synthesis.crossCriterionObservations?.length ?? 0) > 0 ? (
        <SynthesisSection title="Across the criteria" items={analysis.synthesis.crossCriterionObservations ?? []} />
      ) : null}
    </div>
  );
}

function CriterionResultCard({
  criterion,
  imageRoles,
  index,
  result,
  synthesis,
}: {
  criterion?: Criterion;
  imageRoles: Map<string, "final_work" | "concept_development">;
  index: number;
  result: CriterionResult;
  synthesis?: { summary: string; improvement?: string };
}) {
  const judgement = selectedJudgement(criterion, result);
  return (
    <article className={styles.criterionResultCard}>
      <div className={styles.criterionResultHeader}>
        <div>
          <span>Criterion {index + 1}</span>
          <h3>{criterion?.title || "Criterion"}</h3>
        </div>
        <Confidence value={result.confidence} />
      </div>
      {criterion?.statement ? <p className={styles.criterionStatement}>{criterion.statement}</p> : null}
      <div className={styles.judgementDecision}>
        <span>Best-fit judgement</span>
        <strong>{judgement.label}</strong>
        {judgement.description ? <p>{judgement.description}</p> : null}
      </div>
      <p className={styles.rationale}>{synthesis?.summary || result.rationale}</p>
      <div className={styles.evidenceColumns}>
        <EvidenceList title="Supporting evidence" evidence={result.supportingEvidence} imageRoles={imageRoles} tone="support" />
        <EvidenceList title="Counter-evidence" evidence={result.counterEvidence} imageRoles={imageRoles} tone="counter" />
      </div>
      {result.alternativeJudgement ? (
        <div className={styles.alternative}><strong>Material alternative</strong><p>{result.alternativeJudgement}</p></div>
      ) : null}
      {synthesis?.improvement ? (
        <div className={styles.improvement}><strong>Development direction</strong><p>{synthesis.improvement}</p></div>
      ) : null}
    </article>
  );
}

function EvidenceList({ title, evidence, imageRoles, tone }: { title: string; evidence: CriterionEvidence[]; imageRoles: Map<string, "final_work" | "concept_development">; tone: "support" | "counter" }) {
  return (
    <section className={`${styles.evidenceList} ${styles[`evidence_${tone}`]}`}>
      <h4>{title}</h4>
      {evidence.length ? (
        <ul>{evidence.map((item, index) => (
          <li key={item.id ?? `${item.imageId}-${index}`}>
            <p>{item.observation}</p>
            <span>
              {item.regionDescription ? `${item.regionDescription} · ` : ""}{item.imageId}
              {" · "}<ImageRoleLabel role={imageRoles.get(item.imageId) ?? "final_work"} />
            </span>
          </li>
        ))}</ul>
      ) : <p className={styles.noEvidence}>None recorded.</p>}
    </section>
  );
}

function IntegratedReview({
  criteria,
  criteriaAnalysis,
  designAnalysis,
}: {
  criteria: Criterion[];
  criteriaAnalysis?: CriteriaAnalysis;
  designAnalysis?: DesignAnalysis;
}) {
  if (!designAnalysis || !criteriaAnalysis) {
    return <ResultEmpty icon="integrated" title="Two perspectives, one view" text="Integrated Review becomes available when both a Design Review and a Criteria Review exist." />;
  }

  const sourceDesignMismatch = criteriaAnalysis.designAnalysisId !== designAnalysis.id;
  return (
    <div className={styles.integratedReview}>
      <section className={styles.integratedIntro}>
        <span className={styles.analysisVersion}>Deterministic relationship view</span>
        <h3>Intrinsic design quality and criterion performance</h3>
        <p>This view connects adjudicated visual findings with the explicit relationship recorded for each criterion. It adds no new model judgement.</p>
        {sourceDesignMismatch ? <div className={styles.versionWarning}>This Criteria Review was run against a different Design Analysis version. Select its source version for a like-for-like view.</div> : null}
      </section>
      <div className={styles.relationshipList}>
        {criteriaAnalysis.results.map((result, index) => {
          const criterion = criteria.find((item) => item.id === result.criterionId);
          const relatedIds = new Set([
            ...result.supportingEvidence.flatMap((item) => item.designFindingIds ?? []),
            ...result.counterEvidence.flatMap((item) => item.designFindingIds ?? []),
          ]);
          const findings = designAnalysis.findings.filter((finding) => relatedIds.has(finding.id));
          return (
            <article className={styles.relationshipCard} key={result.criterionId}>
              <div className={styles.relationshipTop}>
                <span className={`${styles.relationshipBadge} ${styles[`relationship_${result.designRelationship ?? "unclear"}`]}`}>
                  {relationshipLabel(result.designRelationship)}
                </span>
                <span>Criterion {index + 1}</span>
              </div>
              <h3>{criterion?.title || "Criterion"}</h3>
              <p className={styles.relationshipSummary}>{relationshipDescription(result.designRelationship)}</p>
              <div className={styles.integratedDecision}>
                <span>Criterion decision</span>
                <strong>{selectedJudgement(criterion, result).label}</strong>
              </div>
              {findings.length ? (
                <div className={styles.relatedFindings}>
                  <strong>Linked adjudicated design findings</strong>
                  {findings.map((finding) => <FindingSummary finding={finding} key={finding.id} />)}
                </div>
              ) : (
                <p className={styles.noLinkedFinding}>No explicit Design finding link was recorded; the relationship comes from the criterion adjudication.</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function AnalysisDetail({
  criteriaAnalysis,
  designAnalysis,
  reviewTitle,
}: {
  criteriaAnalysis?: CriteriaAnalysis;
  designAnalysis?: DesignAnalysis;
  reviewTitle: string;
}) {
  if (!designAnalysis && !criteriaAnalysis) {
    return <ResultEmpty icon="detail" title="No analysis detail yet" text="Completed passes, evidence, challenge outcomes, and provenance will appear here." />;
  }
  const designImageRoles = imageRoleMap(designAnalysis?.inputSnapshot?.images);

  return (
    <div className={styles.analysisDetail}>
      <section className={styles.detailIntro}>
        <span className={styles.analysisVersion}>Audit view</span>
        <h3>{reviewTitle || "Untitled review"}</h3>
        <p>Only structured evidence, concise challenge outcomes, adjudicated findings, and run provenance are shown. Hidden model reasoning is never exposed.</p>
      </section>

      {designAnalysis ? (
        <details className={styles.detailGroup} open>
          <summary>Design Analysis v{designAnalysis.version} <span>{designAnalysis.evidence.length} evidence · {designAnalysis.findings.length} findings</span></summary>
          <div className={styles.detailGroupBody}>
            <ProvenanceList items={designAnalysis.passProvenance ?? []} schemaVersion={designAnalysis.schemaVersion} promptVersion={designAnalysis.promptSetVersion ?? designAnalysis.promptVersion} />
            <h4>Visual evidence</h4>
            <div className={styles.detailEvidence}>
              {designAnalysis.evidence.map((item) => (
                <article key={item.id}>
                  <div><Confidence value={item.confidence} /><span>{item.reviewAreaId}</span></div>
                  <p>{item.observation}</p>
                  <small>
                    {item.regionDescription || "Region not specified"} · {item.imageId}{" · "}
                    <ImageRoleLabel role={designImageRoles.get(item.imageId) ?? "final_work"} />
                  </small>
                  {item.uncertainty ? <em>{item.uncertainty}</em> : null}
                </article>
              ))}
            </div>
            <h4>Adjudicated findings</h4>
            <div className={styles.detailFindings}>{designAnalysis.findings.map((finding) => <FindingSummary detailed finding={finding} key={finding.id} />)}</div>
          </div>
        </details>
      ) : null}

      {criteriaAnalysis ? (
        <details className={styles.detailGroup} open={!designAnalysis}>
          <summary>Criteria Analysis v{criteriaAnalysis.version} <span>{criteriaAnalysis.results.length} decisions</span></summary>
          <div className={styles.detailGroupBody}>
            <ProvenanceList items={criteriaAnalysis.passProvenance ?? []} schemaVersion={criteriaAnalysis.schemaVersion} promptVersion={criteriaAnalysis.promptSetVersion ?? criteriaAnalysis.promptVersion} />
            <h4>Adjudicated criterion decisions</h4>
            <div className={styles.detailFindings}>
              {criteriaAnalysis.results.map((result) => (
                <article className={styles.findingSummary} key={result.criterionId}>
                  <div><Confidence value={result.confidence} /><span>{humanise(result.designRelationship ?? "unclear")}</span></div>
                  <strong>{result.criterionId}</strong>
                  <p>{result.rationale}</p>
                  {result.alternativeJudgement ? <small>Alternative: {result.alternativeJudgement}</small> : null}
                </article>
              ))}
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ProvenanceList({ items, schemaVersion, promptVersion }: { items: NonNullable<DesignAnalysis["passProvenance"]>; schemaVersion?: string; promptVersion?: string }) {
  return (
    <div className={styles.provenance}>
      <div className={styles.provenanceHeader}><span>Prompt set {promptVersion ?? "recorded per pass"}</span><span>Schema {schemaVersion ?? "recorded per pass"}</span></div>
      {items.length ? items.map((item, index) => (
        <div className={styles.provenanceRow} key={`${item.passId ?? item.passKey}-${index}`}>
          <strong>{item.passId ?? item.passKey ?? `Pass ${index + 1}`}</strong>
          <span className={styles.passComplete}>{humanise(item.state)}</span>
          <span>{item.modelConfiguration?.model ?? "No model (skipped)"}</span>
          <span title={usageTitle(item.usage)}>
            {item.durationMs !== undefined ? formatDuration(item.durationMs) : "—"}
            {item.usage?.totalTokens !== undefined ? ` · ${formatTokens(item.usage.totalTokens)}` : ""}
            {item.usage?.estimatedCostMicroUsd !== undefined
              ? ` · ${formatEstimatedCost(item.usage.estimatedCostMicroUsd)}`
              : ""}
          </span>
        </div>
      )) : <p className={styles.mutedResult}>Per-pass provenance was not included in this response.</p>}
    </div>
  );
}

function FindingSummary({ finding, detailed }: { finding: DesignFinding; detailed?: boolean }) {
  return (
    <article className={styles.findingSummary}>
      <div>
        <span className={`${styles.significance} ${styles[`significance_${finding.significance}`]}`}>{finding.significance}</span>
        <Confidence value={finding.confidence} />
        {finding.focusRelated ? <span className={styles.focusFinding}>◉ Focus</span> : null}
      </div>
      <strong>{finding.observation}</strong>
      <p>{finding.interpretation}</p>
      {detailed && finding.likelyEffect ? <small>Likely effect: {finding.likelyEffect}</small> : null}
      {detailed ? <small>Challenge: {humanise(finding.adversarialStatus)} · Adjudication: {humanise(finding.adjudication)}</small> : null}
      {detailed && finding.alternativeInterpretation ? <em>Alternative: {finding.alternativeInterpretation}</em> : null}
    </article>
  );
}

function Confidence({ value }: { value: "low" | "medium" | "high" }) {
  return <span className={`${styles.confidence} ${styles[`confidence_${value}`]}`}>{value} confidence</span>;
}

function ResultEmpty({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className={styles.resultEmpty}>
      <span><SparklesIcon /></span>
      <small>{icon}</small>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function selectedJudgement(criterion: Criterion | undefined, result: CriterionResult) {
  const selected = criterion?.judgementStatements.find((item) => item.id === result.selectedJudgementStatementId);
  if (selected) return { label: selected.label, description: selected.description };
  return { label: humanise(result.fallbackStatus ?? "insufficient_evidence"), description: "" };
}

function statementText(statement: SynthesisStatement) {
  return typeof statement === "string" ? statement : statement.text;
}

function imageRoleMap(images?: Array<{ imageId: string; analysisRole?: "final_work" | "concept_development" }>) {
  return new Map(
    (images ?? []).map(({ imageId, analysisRole }) => [
      imageId,
      analysisRole ?? "final_work",
    ] as const),
  );
}

function ImageRoleLabel({ role }: { role: "final_work" | "concept_development" }) {
  return <em className={`${styles.evidenceRole} ${role === "concept_development" ? styles.evidenceRoleDevelopment : ""}`}>{roleLabel(role)}</em>;
}

function roleLabel(role: "final_work" | "concept_development") {
  return role === "concept_development" ? "Concept & development" : "Final work";
}

function resultImageSummary(images?: Array<{ analysisRole?: "final_work" | "concept_development" }>) {
  const finalCount = (images ?? []).filter(
    ({ analysisRole }) => (analysisRole ?? "final_work") === "final_work",
  ).length;
  const developmentCount = (images?.length ?? 0) - finalCount;
  return developmentCount
    ? `${finalCount} final, ${developmentCount} development`
    : `${finalCount} final`;
}

function relationshipLabel(value?: string) {
  const labels: Record<string, string> = {
    aligned: "Design and criterion aligned",
    criterion_conflicts_with_design_strength: "Criterion conflicts with a design strength",
    criterion_met_but_design_weak: "Criterion addressed; execution remains weak",
    unrelated: "No material design relationship",
    unclear: "Relationship unclear",
  };
  return labels[value ?? "unclear"] ?? humanise(value ?? "unclear");
}

function relationshipDescription(value?: string) {
  const descriptions: Record<string, string> = {
    aligned: "The criterion decision and the intrinsic design reading reinforce one another.",
    criterion_conflicts_with_design_strength: "A visually effective choice appears to work against the supplied criterion, so compliance and design quality should be judged separately.",
    criterion_met_but_design_weak: "The work appears to address the criterion technically, while the independent design review identifies limitations in its execution.",
    unrelated: "The selected criterion does not materially intersect with the adjudicated design findings.",
    unclear: "The available evidence does not support a confident relationship between the two views.",
  };
  return descriptions[value ?? "unclear"] ?? descriptions.unclear;
}

function designVersionFor(criteria: CriteriaAnalysis, designAnalyses: DesignAnalysis[]) {
  return designAnalyses.find((analysis) => analysis.id === criteria.designAnalysisId)?.version ?? "—";
}

function humanise(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}

function formatTokens(tokens: number) {
  return `${new Intl.NumberFormat("en-NZ", { notation: "compact", maximumFractionDigits: 1 }).format(tokens)} tok`;
}

function formatEstimatedCost(microUsd: number) {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(microUsd / 1_000_000);
}

function usageTitle(usage: PassProvenance["usage"]) {
  if (!usage) return "No usage metadata was recorded.";
  const parts = [
    usage.inputTokens !== undefined ? `${usage.inputTokens} input tokens` : null,
    usage.cachedInputTokens ? `${usage.cachedInputTokens} cached` : null,
    usage.cacheWriteInputTokens ? `${usage.cacheWriteInputTokens} cache-write` : null,
    usage.outputTokens !== undefined ? `${usage.outputTokens} output tokens` : null,
    usage.reasoningOutputTokens ? `${usage.reasoningOutputTokens} reasoning` : null,
    usage.estimatedCostMicroUsd !== undefined
      ? `${formatEstimatedCost(usage.estimatedCostMicroUsd)} estimated`
      : "unpriced",
  ];
  return parts.filter(Boolean).join(" · ");
}
