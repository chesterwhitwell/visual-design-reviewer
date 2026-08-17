"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppHeader } from "@/components/shared/app-header";
import { DeleteReviewDialog } from "@/components/shared/delete-review-dialog";

import { CriteriaEditor } from "./criteria-editor";
import { CriteriaSetsDialog } from "./criteria-sets-dialog";
import { ImageWorkspace, imageName } from "./image-workspace";
import { ResultsWorkspace } from "./results-workspace";
import styles from "./review-workspace.module.css";
import { allTaxonomyAreas, TaxonomyEditor } from "./taxonomy-editor";
import type {
  AnalysisRun,
  Criterion,
  ImageAnalysisRole,
  ResultTab,
  Review,
  ReviewAreaSelection,
  ReviewImage,
  ReviewMode,
} from "./types";
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckIcon,
  SparklesIcon,
} from "./workspace-icons";

type Notice = { kind: "error" | "success"; message: string };

const activeStates = new Set<AnalysisRun["state"]>(["queued", "running"]);

export function ReviewWorkspace({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState("Checking API");
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [criteriaDirty, setCriteriaDirty] = useState(false);
  const [criteriaSetsOpen, setCriteriaSetsOpen] = useState(false);
  const [deleteReviewOpen, setDeleteReviewOpen] = useState(false);
  const [deleteReviewError, setDeleteReviewError] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedDesignId, setSelectedDesignId] = useState<string | null>(null);
  const [selectedCriteriaId, setSelectedCriteriaId] = useState<string | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>("design");
  const metadataDirtyRef = useRef(false);
  const criteriaDirtyRef = useRef(false);

  useEffect(() => {
    metadataDirtyRef.current = metadataDirty;
  }, [metadataDirty]);

  useEffect(() => {
    criteriaDirtyRef.current = criteriaDirty;
  }, [criteriaDirty]);

  const loadReview = useCallback(async (silent = false) => {
    await Promise.resolve();
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}`, {
        cache: "no-store",
      });
      const body = await readJson<{ review?: Review; error?: { message?: string } }>(response);
      if (!response.ok || !body.review) {
        throw new Error(body.error?.message ?? "The review could not be loaded.");
      }
      const nextReview = normaliseReview(body.review);
      setReview(nextReview);
      setLoadError(null);
      const newestDesign = [...nextReview.designAnalyses].sort((a, b) => b.version - a.version)[0];
      const newestCriteria = [...nextReview.criteriaAnalyses].sort((a, b) => b.version - a.version)[0];
      setSelectedDesignId((current) => (
        current && nextReview.designAnalyses.some((item) => item.id === current)
          ? current
          : (newestDesign?.id ?? null)
      ));
      setSelectedCriteriaId((current) => (
        current && nextReview.criteriaAnalyses.some((item) => item.id === current)
          ? current
          : (newestCriteria?.id ?? null)
      ));
      if (!metadataDirtyRef.current) {
        setTitle(nextReview.title ?? "");
        setContext(nextReview.context ?? "");
      }
      if (!criteriaDirtyRef.current) setCriteria(nextReview.criteria);
    } catch (error) {
      if (!silent) setLoadError(messageFrom(error, "The review could not be loaded."));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [reviewId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadReview(), 0);
    void fetch("/api/settings/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const status = await readJson<{ ready?: boolean; label?: string }>(response);
        setApiStatus(status.ready ? "API ready" : (status.label ?? "Configuration needed"));
      })
      .catch(() => setApiStatus("Configuration needed"));
    return () => window.clearTimeout(initialLoad);
  }, [loadReview]);

  const activeRuns = useMemo(
    () => (review?.runs ?? []).filter((run) => activeStates.has(run.state)),
    [review?.runs],
  );
  const activeRunKey = activeRuns.map((run) => run.id).sort().join(",");

  useEffect(() => {
    if (!activeRunKey) return;
    const runIds = activeRunKey.split(",");
    let cancelled = false;

    async function poll() {
      const results = await Promise.all(runIds.map(async (runId) => {
        try {
          const response = await fetch(`/api/analysis-runs/${encodeURIComponent(runId)}`, {
            cache: "no-store",
          });
          const body = await readJson<{
            run?: AnalysisRun;
            analysisRun?: AnalysisRun;
          }>(response);
          return response.ok ? (body.run ?? body.analysisRun ?? null) : null;
        } catch {
          return null;
        }
      }));
      if (cancelled) return;
      const updatedRuns = results.filter((run): run is AnalysisRun => run !== null);
      if (!updatedRuns.length) return;
      setReview((current) => current ? {
        ...current,
        runs: mergeRuns(current.runs, updatedRuns),
      } : current);
      if (updatedRuns.some((run) => !activeStates.has(run.state))) {
        await loadReview(true);
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), 1_600);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeRunKey, loadReview]);

  async function saveMetadata() {
    setOperation("metadata");
    setNotice(null);
    try {
      await mutation(`/api/reviews/${encodeURIComponent(reviewId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim() || null,
          context: context.trim() || null,
        }),
      });
      metadataDirtyRef.current = false;
      setMetadataDirty(false);
      await loadReview(true);
      setNotice({ kind: "success", message: "Review details saved." });
    } catch (error) {
      setNotice({ kind: "error", message: messageFrom(error, "Review details could not be saved.") });
    } finally {
      setOperation(null);
    }
  }

  async function uploadImages(files: File[]) {
    setOperation("images");
    setNotice(null);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("images", file));
      await mutation(`/api/reviews/${encodeURIComponent(reviewId)}/images`, {
        method: "POST",
        body: formData,
      });
      await loadReview(true);
      setNotice({
        kind: "success",
        message: `${files.length} ${files.length === 1 ? "image" : "images"} added and sanitised.`,
      });
    } catch (error) {
      setNotice({ kind: "error", message: messageFrom(error, "The images could not be added.") });
    } finally {
      setOperation(null);
    }
  }

  async function moveImage(imageId: string, direction: -1 | 1) {
    if (!review) return;
    const images = orderedImages(review.images);
    const index = images.findIndex((image) => image.id === imageId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    const reordered = next.map((image, order) => ({ ...image, order }));
    setReview({ ...review, images: reordered });
    setOperation("images");
    setNotice(null);
    try {
      await mutation(`/api/reviews/${encodeURIComponent(reviewId)}/images`, {
        method: "PATCH",
        body: JSON.stringify({
          images: reordered.map((image) => ({
            imageId: image.id,
            analysisRole: image.analysisRole,
          })),
        }),
      });
      await loadReview(true);
    } catch (error) {
      setReview(review);
      setNotice({ kind: "error", message: messageFrom(error, "The image order could not be saved.") });
    } finally {
      setOperation(null);
    }
  }

  async function changeImageRole(imageId: string, analysisRole: ImageAnalysisRole) {
    if (!review) return;
    if (review.images.find((image) => image.id === imageId)?.analysisRole === analysisRole) {
      return;
    }
    const previous = review;
    const images = orderedImages(review.images).map((image) => (
      image.id === imageId ? { ...image, analysisRole } : image
    ));
    setReview({ ...review, images });
    setOperation("images");
    setNotice(null);
    try {
      await mutation(`/api/reviews/${encodeURIComponent(reviewId)}/images`, {
        method: "PATCH",
        body: JSON.stringify({
          images: images.map((image) => ({
            imageId: image.id,
            analysisRole: image.analysisRole,
          })),
        }),
      });
      await loadReview(true);
      setNotice({
        kind: "success",
        message: analysisRole === "concept_development"
          ? "Image tagged as Concept & development."
          : "Image tagged as Final work.",
      });
    } catch (error) {
      setReview(previous);
      setNotice({ kind: "error", message: messageFrom(error, "The image purpose could not be saved.") });
    } finally {
      setOperation(null);
    }
  }

  async function removeImage(image: ReviewImage) {
    const confirmed = window.confirm(
      `Remove “${imageName(image)}” from the current review input? Existing completed analyses will be preserved.`,
    );
    if (!confirmed) return;
    setOperation("images");
    setNotice(null);
    try {
      await mutation(
        `/api/reviews/${encodeURIComponent(reviewId)}/images/${encodeURIComponent(image.id)}`,
        { method: "DELETE" },
      );
      if (selectedImageId === image.id) setSelectedImageId(null);
      await loadReview(true);
      setNotice({ kind: "success", message: "Image removed from the current input revision." });
    } catch (error) {
      setNotice({ kind: "error", message: messageFrom(error, "The image could not be removed.") });
    } finally {
      setOperation(null);
    }
  }

  async function purgeImages() {
    const confirmed = window.confirm(
      "Purge every retained source image for this review? Completed textual analyses remain, but new image-based runs will require re-uploading the work. This cannot be undone.",
    );
    if (!confirmed) return;
    setOperation("images");
    setNotice(null);
    try {
      await mutation(`/api/reviews/${encodeURIComponent(reviewId)}/purge`, { method: "POST" });
      await loadReview(true);
      setNotice({ kind: "success", message: "Source-image purge requested." });
    } catch (error) {
      setNotice({ kind: "error", message: messageFrom(error, "Source images could not be purged.") });
    } finally {
      setOperation(null);
    }
  }

  async function changeAreas(areaIds: string[], mode: ReviewMode) {
    if (!review) return;
    const changedIds = new Set(areaIds);
    const current = new Map(review.reviewAreas.map((selection) => [selection.areaId, selection.mode]));
    const reviewAreas: ReviewAreaSelection[] = allTaxonomyAreas(review.taxonomy).map((area) => ({
      areaId: area.id,
      mode: changedIds.has(area.id) ? mode : (current.get(area.id) ?? "off"),
    }));
    const previous = review.reviewAreas;
    setReview({ ...review, reviewAreas });
    setOperation("areas");
    setNotice(null);
    try {
      await mutation(`/api/reviews/${encodeURIComponent(reviewId)}/areas`, {
        method: "PUT",
        body: JSON.stringify({ reviewAreas }),
      });
      await loadReview(true);
    } catch (error) {
      setReview((currentReview) => currentReview ? { ...currentReview, reviewAreas: previous } : currentReview);
      setNotice({ kind: "error", message: messageFrom(error, "Review-area choices could not be saved.") });
    } finally {
      setOperation(null);
    }
  }

  async function saveCriteria() {
    const validationError = validateCriteria(criteria);
    if (validationError) {
      setNotice({ kind: "error", message: validationError });
      return;
    }
    setOperation("criteria");
    setNotice(null);
    const payload = criteria.map((criterion, order) => ({
      id: criterion.id,
      title: criterion.title.trim(),
      statement: criterion.statement.trim(),
      assessorNote: criterion.assessorNote?.trim() || null,
      order,
      judgementStatements: criterion.judgementStatements.map((statement, statementOrder) => ({
        id: statement.id,
        label: statement.label.trim(),
        description: statement.description.trim(),
        order: statementOrder,
      })),
    }));
    try {
      await mutation(`/api/reviews/${encodeURIComponent(reviewId)}/criteria`, {
        method: "PUT",
        body: JSON.stringify({ criteria: payload }),
      });
      criteriaDirtyRef.current = false;
      setCriteriaDirty(false);
      await loadReview(true);
      setNotice({ kind: "success", message: "Criteria and statement order saved." });
    } catch (error) {
      setNotice({ kind: "error", message: messageFrom(error, "The criteria could not be saved.") });
    } finally {
      setOperation(null);
    }
  }

  async function startAnalysis(kind: "design" | "criteria") {
    setOperation(`run-${kind}`);
    setNotice(null);
    try {
      const endpoint = `/api/reviews/${encodeURIComponent(reviewId)}/${kind === "design" ? "design-analyses" : "criteria-analyses"}`;
      const body = await mutation<{ run?: AnalysisRun }>(endpoint, {
        method: "POST",
        body: JSON.stringify(kind === "criteria" ? { designAnalysisId: selectedDesignId } : {}),
      });
      if (!body.run) throw new Error("The server did not return an analysis run.");
      setReview((current) => current ? { ...current, runs: mergeRuns(current.runs, [body.run as AnalysisRun]) } : current);
      setNotice({
        kind: "success",
        message: `${kind === "design" ? "Design" : "Criteria"} Analysis queued. You can leave this page; progress is durable.`,
      });
    } catch (error) {
      setNotice({ kind: "error", message: messageFrom(error, `The ${kind} analysis could not be started.`) });
    } finally {
      setOperation(null);
    }
  }

  async function permanentlyDeleteReview() {
    if (activeRuns.length > 0) return;
    setOperation("delete-review");
    setNotice(null);
    setDeleteReviewError(null);
    try {
      await mutation(`/api/reviews/${encodeURIComponent(reviewId)}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmation: "DELETE" }),
      });
      router.replace("/");
      router.refresh();
    } catch (error) {
      const message = messageFrom(error, "The review could not be fully deleted.");
      setDeleteReviewError(message);
      setNotice({
        kind: "error",
        message,
      });
      await loadReview(true);
      setOperation(null);
    }
  }

  if (loading) return <WorkspaceLoading status={apiStatus} />;

  if (loadError || !review) {
    return (
      <div className="app-shell">
        <AppHeader status={apiStatus} />
        <main className={styles.fatalState}>
          <AlertIcon />
          <p className="eyebrow">Review unavailable</p>
          <h1>We couldn’t open this workspace.</h1>
          <p>{loadError ?? "The review was not found."}</p>
          <div>
            <button className="button button-primary" onClick={() => void loadReview()} type="button">Try again</button>
            <Link className="button button-secondary" href="/">Back to reviews</Link>
          </div>
        </main>
      </div>
    );
  }

  const retainedImages = review.images.filter((image) => image.retainedLocally && image.state !== "purged");
  const retainedFinalImages = retainedImages.filter((image) => image.analysisRole === "final_work");
  const retainedDevelopmentImages = retainedImages.filter((image) => image.analysisRole === "concept_development");
  const selectedAreas = review.reviewAreas.filter((selection) => selection.mode !== "off");
  const designRunning = activeRuns.some((run) => run.kind === "design");
  const criteriaRunning = activeRuns.some((run) => run.kind === "criteria");
  const selectedDesign = review.designAnalyses.find(({ id }) => id === selectedDesignId);
  const selectedDesignUsesEarlierImages = Boolean(
    selectedDesign?.inputSnapshot?.imageRevisionId &&
    review.imageRevisionId &&
    selectedDesign.inputSnapshot.imageRevisionId !== review.imageRevisionId,
  );
  const latestRun = [...review.runs].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )[0];
  const latestProblemRun = latestRun && ["failed", "interrupted"].includes(latestRun.state)
    ? latestRun
    : undefined;
  const canRunDesign =
    review.lifecycle === "active" &&
    retainedImages.length > 0 &&
    retainedFinalImages.length > 0 &&
    selectedAreas.length > 0 &&
    !metadataDirty &&
    !designRunning;
  const canRunCriteria =
    review.lifecycle === "active" &&
    retainedImages.length > 0 &&
    criteria.length > 0 &&
    !!selectedDesignId &&
    !criteriaDirty &&
    !metadataDirty &&
    !criteriaRunning;

  return (
    <div className="app-shell">
      <AppHeader status={apiStatus} />
      <CriteriaSetsDialog
        canApply={review.lifecycle === "active" && operation !== "criteria"}
        criteria={criteria}
        criteriaDirty={criteriaDirty}
        onApply={(setCriteriaValues, mode, setName) => {
          const next = mode === "append"
            ? reorderCriteria([...criteria, ...setCriteriaValues])
            : reorderCriteria(setCriteriaValues);
          setCriteria(next);
          criteriaDirtyRef.current = true;
          setCriteriaDirty(true);
          setNotice({
            kind: "success",
            message: `${setName} ${mode === "append" ? "added to" : "loaded into"} the editor. Save criteria to apply the change.`,
          });
        }}
        onClose={() => setCriteriaSetsOpen(false)}
        open={criteriaSetsOpen}
      />
      <DeleteReviewDialog
        activeAnalysis={activeRuns.length > 0}
        busy={operation === "delete-review"}
        error={deleteReviewError}
        onCancel={() => {
          setDeleteReviewOpen(false);
          setDeleteReviewError(null);
        }}
        onConfirm={() => void permanentlyDeleteReview()}
        open={deleteReviewOpen}
        reviewTitle={review.title}
      />
      <main className={styles.workspace}>
        <header className={styles.workspaceHeader}>
          <Link className={styles.backLink} href="/"><ArrowLeftIcon /> All reviews</Link>
          <div className={styles.workspaceTitleRow}>
            <div>
              <p className="eyebrow">Active review workspace</p>
              <h1>{review.title || "Untitled review"}</h1>
              <p>Updated {formatUpdated(review.updatedAt)} · {review.images.length} {review.images.length === 1 ? "image" : "images"} · {review.designAnalyses.length + review.criteriaAnalyses.length} completed analyses</p>
            </div>
            <div className={styles.workspaceHeaderActions}>
              <span className={`${styles.lifecycleBadge} ${review.lifecycle === "closed" ? styles.lifecycleClosed : ""}`}>
                <i /> {review.lifecycle === "active" ? "Active · images retained by policy" : "Closed review"}
              </span>
              <button
                className={styles.deleteReviewButton}
                disabled={operation !== null || activeRuns.length > 0}
                onClick={() => {
                  setDeleteReviewError(null);
                  setDeleteReviewOpen(true);
                }}
                title={activeRuns.length > 0 ? "Wait for or cancel the active analysis first" : undefined}
                type="button"
              >
                Delete review
              </button>
            </div>
          </div>
        </header>

        <div className={styles.workspaceGrid}>
          <aside className={styles.setupColumn} aria-label="Review setup">
            <div className={styles.setupHeading}>
              <div><span>Setup</span><strong>Review inputs</strong></div>
              <span className={styles.savedState}>{metadataDirty || criteriaDirty ? "Unsaved edits" : "Saved locally"}</span>
            </div>

            <details className={styles.setupSection} open>
              <summary><span><i>01</i> Review details</span><em>{metadataDirty ? "Edited" : "Ready"}</em></summary>
              <div className={styles.setupSectionBody}>
                <label className={styles.setupField}>
                  <span>Review title <em>Optional</em></span>
                  <input
                    disabled={operation === "metadata" || review.lifecycle === "closed"}
                    maxLength={240}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      metadataDirtyRef.current = true;
                      setMetadataDirty(true);
                    }}
                    placeholder="Untitled review"
                    value={title}
                  />
                </label>
                <label className={styles.setupField}>
                  <span>Intention and context <em>Optional</em></span>
                  <textarea
                    disabled={operation === "metadata" || review.lifecycle === "closed"}
                    maxLength={20_000}
                    onChange={(event) => {
                      setContext(event.target.value);
                      metadataDirtyRef.current = true;
                      setMetadataDirty(true);
                    }}
                    placeholder="Audience, purpose, tone, constraints, or rationale…"
                    rows={5}
                    value={context}
                  />
                </label>
                <p className={styles.fieldHelp}>Context is treated as a supplied claim, not as visible fact. Avoid personal identifiers.</p>
                <button className={styles.saveSetupButton} disabled={!metadataDirty || operation !== null} onClick={() => void saveMetadata()} type="button">
                  {operation === "metadata" ? "Saving…" : metadataDirty ? "Save details" : "Details saved"}
                </button>
              </div>
            </details>

            <details className={styles.setupSection} open>
              <summary><span><i>02</i> Review areas</span><em>{selectedAreas.length} selected</em></summary>
              <div className={`${styles.setupSectionBody} ${styles.taxonomySectionBody}`}>
                <p className={styles.sectionIntro}>Choose deliberate coverage. Focus increases attention without hiding serious issues elsewhere.</p>
                <TaxonomyEditor
                  disabled={operation === "areas" || review.lifecycle === "closed"}
                  onChange={(ids, mode) => void changeAreas(ids, mode)}
                  selections={review.reviewAreas}
                  taxonomy={review.taxonomy}
                />
              </div>
            </details>

            <details className={styles.setupSection} open={criteria.length > 0 ? true : undefined}>
              <summary><span><i>03</i> Assessment criteria</span><em>{criteria.length || "Optional"}</em></summary>
              <div className={`${styles.setupSectionBody} ${styles.criteriaSectionBody}`}>
                <p className={styles.sectionIntro}>Criteria remain separate from the Design Review. Custom judgement wording and order are preserved.</p>
                <CriteriaEditor
                  criteria={criteria}
                  dirty={criteriaDirty}
                  disabled={operation === "criteria" || review.lifecycle === "closed"}
                  onChange={(next) => {
                    setCriteria(next);
                    criteriaDirtyRef.current = true;
                    setCriteriaDirty(true);
                  }}
                  onOpenCriteriaSets={() => setCriteriaSetsOpen(true)}
                  onSave={() => void saveCriteria()}
                />
              </div>
            </details>
          </aside>

          <div className={styles.reviewColumn}>
            {notice ? (
              <div className={`${styles.workspaceNotice} ${notice.kind === "error" ? styles.workspaceNoticeError : ""}`} role={notice.kind === "error" ? "alert" : "status"}>
                {notice.kind === "error" ? <AlertIcon /> : <CheckIcon />}
                <span>{notice.message}</span>
                <button aria-label="Dismiss message" onClick={() => setNotice(null)} type="button">×</button>
              </div>
            ) : null}

            <ImageWorkspace
              busy={operation === "images" || review.lifecycle === "closed"}
              images={review.images}
              onFiles={(files) => void uploadImages(files)}
              onMove={(id, direction) => void moveImage(id, direction)}
              onPurge={() => void purgeImages()}
              onRemove={(image) => void removeImage(image)}
              onRoleChange={(id, role) => void changeImageRole(id, role)}
              onSelect={setSelectedImageId}
              reviewId={reviewId}
              selectedId={selectedImageId}
            />

            <ResultsWorkspace
              criteriaAnalyses={review.criteriaAnalyses}
              currentCriteria={criteria}
              designAnalyses={review.designAnalyses}
              onCriteriaSelect={setSelectedCriteriaId}
              onDesignSelect={setSelectedDesignId}
              onTabChange={setResultTab}
              reviewId={review.id}
              reviewTitle={review.title ?? "Untitled review"}
              selectedCriteriaId={selectedCriteriaId}
              selectedDesignId={selectedDesignId}
              tab={resultTab}
            />
          </div>
        </div>
      </main>

      <div className={styles.actionDock}>
        <div className={styles.actionDockInner}>
          <div className={styles.runStatusArea}>
            {activeRuns.length ? activeRuns.map((run) => <RunProgress key={run.id} run={run} />) : (
              latestProblemRun ? <RunFailure run={latestProblemRun} /> : (
                <div className={styles.readyPrompt}>
                  <SparklesIcon />
                  <div><strong>Ready for analysis</strong><span>{runReadinessText(retainedFinalImages.length, retainedDevelopmentImages.length, selectedAreas.length, metadataDirty)}</span></div>
                </div>
              )
            )}
          </div>
          <div className={styles.runActions}>
            <label>
              <span>Criteria source</span>
              <select disabled={!review.designAnalyses.length || criteriaRunning} onChange={(event) => setSelectedDesignId(event.target.value)} value={selectedDesignId ?? ""}>
                {!review.designAnalyses.length ? <option value="">No Design Analysis</option> : null}
                {[...review.designAnalyses].sort((a, b) => b.version - a.version).map((analysis) => <option key={analysis.id} value={analysis.id}>Design v{analysis.version} · {analysisImageSummary(analysis.inputSnapshot?.images)}</option>)}
              </select>
              {selectedDesignUsesEarlierImages ? (
                <em className={styles.snapshotWarning}>Uses the image purposes captured by this earlier Design Analysis.</em>
              ) : null}
            </label>
            <button
              className={styles.runSecondary}
              disabled={!canRunCriteria || operation !== null}
              onClick={() => void startAnalysis("criteria")}
              title={criteriaRunDisabledReason({ review, retainedImages, criteria, selectedDesignId, criteriaDirty, metadataDirty, criteriaRunning })}
              type="button"
            >
              <SparklesIcon /> {operation === "run-criteria" ? "Queueing…" : "Run Criteria Analysis"}
            </button>
            <button
              className={styles.runPrimary}
              disabled={!canRunDesign || operation !== null}
              onClick={() => void startAnalysis("design")}
              title={designRunDisabledReason({ review, retainedImages, selectedAreas, metadataDirty, designRunning })}
              type="button"
            >
              <SparklesIcon /> {operation === "run-design" ? "Queueing…" : "Run Design Analysis"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RunProgress({ run }: { run: AnalysisRun }) {
  const passes = [...(run.passes ?? [])].sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  const completed = passes.filter((pass) => ["completed", "skipped"].includes(pass.state)).length;
  const runningPass = passes.find((pass) => pass.state === "running");
  const percent = passes.length ? Math.round((completed / passes.length) * 100) : (run.state === "running" ? 8 : 2);
  const passKey = runningPass?.passKey ?? runningPass?.passId;
  return (
    <div className={styles.runProgress} aria-live="polite">
      <div className={styles.runProgressTop}>
        <div><span className={styles.runPulse} /><strong>{run.kind === "design" ? "Design Analysis" : "Criteria Analysis"}</strong><span>{run.state === "queued" ? "Waiting for worker" : passLabel(passKey)}</span></div>
        <span>{passes.length ? `${completed}/${passes.length} passes` : "Starting"}</span>
      </div>
      <div className={styles.progressTrack}><span style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function RunFailure({ run }: { run: AnalysisRun }) {
  const failedPass = run.passes?.find((pass) => ["failed", "interrupted"].includes(pass.state));
  return (
    <div className={styles.runFailure} role="status">
      <AlertIcon />
      <div>
        <strong>{run.kind === "design" ? "Design" : "Criteria"} Analysis {run.state}</strong>
        <span>{run.error?.message || failedPass?.error?.message || "The run stopped before it could produce a completed result. Review the inputs and run it again when ready."}</span>
      </div>
    </div>
  );
}

function WorkspaceLoading({ status }: { status: string }) {
  return (
    <div className="app-shell">
      <AppHeader status={status} />
      <main className={styles.loadingWorkspace} aria-label="Loading review">
        <div className={styles.loadingSidebar}>
          <div className={styles.localSkeleton} style={{ height: 58 }} />
          <div className={styles.localSkeleton} style={{ height: 230 }} />
          <div className={styles.localSkeleton} style={{ height: 310 }} />
        </div>
        <div className={styles.loadingContent}>
          <div className={styles.localSkeleton} style={{ height: 520 }} />
          <div className={styles.localSkeleton} style={{ height: 360 }} />
        </div>
      </main>
    </div>
  );
}

async function mutation<T = Record<string, unknown>>(url: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-VDR-Request", "1");
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const body = await readJson<T & { error?: { message?: string } }>(response);
  if (!response.ok) throw new Error(body.error?.message ?? "The request could not be completed.");
  return body;
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    return {} as T;
  }
}

function normaliseReview(review: Review): Review {
  return {
    ...review,
    images: orderedImages(review.images ?? []).map((image, order) => ({
      ...image,
      order,
      analysisRole: image.analysisRole ?? "final_work",
    })),
    reviewAreas: review.reviewAreas ?? [],
    criteria: (review.criteria ?? []).map((criterion, order) => ({
      ...criterion,
      order: criterion.order ?? order,
      judgementStatements: (criterion.judgementStatements ?? []).map((statement, statementOrder) => ({
        ...statement,
        order: statement.order ?? statementOrder,
      })).sort((a, b) => a.order - b.order),
    })).sort((a, b) => a.order - b.order),
    designAnalyses: (review.designAnalyses ?? []).map((analysis) => ({
      ...analysis,
      evidence: analysis.evidence ?? [],
      findings: analysis.findings ?? [],
    })),
    criteriaAnalyses: review.criteriaAnalyses ?? [],
    runs: review.runs ?? [],
  };
}

function orderedImages(images: ReviewImage[]) {
  return [...images].sort(
    (left, right) => (left.order ?? left.position ?? 0) - (right.order ?? right.position ?? 0),
  );
}

function reorderCriteria(criteria: Criterion[]): Criterion[] {
  return criteria.map((criterion, order) => ({
    ...criterion,
    order,
    judgementStatements: criterion.judgementStatements.map((statement, statementOrder) => ({
      ...statement,
      order: statementOrder,
    })),
  }));
}

function mergeRuns(current: AnalysisRun[], updates: AnalysisRun[]) {
  const updateMap = new Map(updates.map((run) => [run.id, run]));
  const merged = current.map((run) => updateMap.get(run.id) ?? run);
  for (const run of updates) {
    if (!current.some((item) => item.id === run.id)) merged.push(run);
  }
  return merged;
}

function validateCriteria(criteria: Criterion[]): string | null {
  for (let index = 0; index < criteria.length; index += 1) {
    const criterion = criteria[index];
    if (!criterion.title.trim()) return `Criterion ${index + 1} needs a title.`;
    if (!criterion.statement.trim()) return `Criterion ${index + 1} needs a criterion statement.`;
    for (let statementIndex = 0; statementIndex < criterion.judgementStatements.length; statementIndex += 1) {
      const statement = criterion.judgementStatements[statementIndex];
      if (!statement.label.trim() || !statement.description.trim()) {
        return `Judgement statement ${statementIndex + 1} in criterion ${index + 1} needs both a label and description.`;
      }
    }
  }
  return null;
}

function passLabel(passId?: string) {
  const labels: Record<string, string> = {
    D1: "Extracting visual evidence",
    D2: "Interpreting design evidence",
    D3: "Checking context alignment",
    D4: "Challenging findings",
    D5: "Adjudicating findings",
    D6: "Synthesising feedback",
    C1: "Searching criterion evidence",
    C2: "Comparing statements",
    C3: "Challenging criterion decisions",
    C4: "Adjudicating criteria",
    C5: "Synthesising criterion feedback",
  };
  return passId ? (labels[passId] ?? passId) : "Preparing next pass";
}

function runReadinessText(finalCount: number, developmentCount: number, areaCount: number, metadataDirty: boolean) {
  if (!finalCount && !developmentCount) return "Add at least one retained image to begin.";
  if (!finalCount) return "Tag at least one retained image as Final work.";
  if (!areaCount) return "Set at least one review area to Review or Focus.";
  if (metadataDirty) return "Save the edited review details before running.";
  const development = developmentCount ? ` · ${developmentCount} development` : "";
  return `${finalCount} final${development} · ${areaCount} areas selected`;
}

function analysisImageSummary(images?: Array<{ analysisRole?: ImageAnalysisRole }>) {
  const finalCount = (images ?? []).filter(({ analysisRole }) => (analysisRole ?? "final_work") === "final_work").length;
  const developmentCount = (images?.length ?? 0) - finalCount;
  return developmentCount ? `${finalCount} final, ${developmentCount} development` : `${finalCount} final`;
}

function designRunDisabledReason({
  review,
  retainedImages,
  selectedAreas,
  metadataDirty,
  designRunning,
}: {
  review: Review;
  retainedImages: ReviewImage[];
  selectedAreas: ReviewAreaSelection[];
  metadataDirty: boolean;
  designRunning: boolean;
}) {
  if (review.lifecycle === "closed") return "Closed reviews cannot start new analyses.";
  if (!retainedImages.length) return "Add or re-upload at least one source image.";
  if (!retainedImages.some((image) => image.analysisRole === "final_work")) {
    return "Tag at least one retained image as Final work.";
  }
  if (!selectedAreas.length) return "Set at least one review area to Review or Focus.";
  if (metadataDirty) return "Save review details first so the context snapshot is explicit.";
  if (designRunning) return "A Design Analysis is already active.";
  return "Create a new immutable Design Analysis version.";
}

function criteriaRunDisabledReason({
  review,
  retainedImages,
  criteria,
  selectedDesignId,
  criteriaDirty,
  metadataDirty,
  criteriaRunning,
}: {
  review: Review;
  retainedImages: ReviewImage[];
  criteria: Criterion[];
  selectedDesignId: string | null;
  criteriaDirty: boolean;
  metadataDirty: boolean;
  criteriaRunning: boolean;
}) {
  if (review.lifecycle === "closed") return "Closed reviews cannot start new analyses.";
  if (!retainedImages.length) return "Source images are required for Criteria Analysis.";
  if (!criteria.length) return "Add and save at least one criterion.";
  if (!selectedDesignId) return "Run or select a Design Analysis first.";
  if (criteriaDirty) return "Save the criteria before running.";
  if (metadataDirty) return "Save review details before running.";
  if (criteriaRunning) return "A Criteria Analysis is already active.";
  return "Run Criteria Analysis against the selected Design Analysis version.";
}

function formatUpdated(value: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
