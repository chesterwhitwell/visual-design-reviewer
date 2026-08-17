"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

import { CriteriaSetsDialog } from "@/components/review-workspace/criteria-sets-dialog";
import type { Criterion } from "@/components/review-workspace/types";
import { AppHeader } from "@/components/shared/app-header";
import { DeleteReviewDialog } from "@/components/shared/delete-review-dialog";
import { ReviewUsage, type ReviewUsageSummary } from "@/components/shared/review-usage";
import {
  ArrowRightIcon,
  CloseIcon,
  CriteriaIcon,
  ImageIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/shared/icons";

type ReviewListItem = {
  id: string;
  title: string | null;
  contextPreview: string | null;
  imageCount: number;
  designAnalysisCount: number;
  criteriaAnalysisCount: number;
  analysisUsage: ReviewUsageSummary;
  updatedAt: string;
};

type ApiStatus = {
  ready: boolean;
  label: string;
};

export function HomePage() {
  const router = useRouter();
  const [reviews, setReviews] = useState<ReviewListItem[] | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus>({
    ready: false,
    label: "Checking API",
  });
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [criteriaSetsOpen, setCriteriaSetsOpen] = useState(false);
  const [criteriaDraft, setCriteriaDraft] = useState<Criterion[]>([]);
  const [criteriaDraftDirty, setCriteriaDraftDirty] = useState(false);
  const [reviewToDelete, setReviewToDelete] = useState<ReviewListItem | null>(null);
  const [deletingReviewId, setDeletingReviewId] = useState<string | null>(null);
  const [deleteReviewError, setDeleteReviewError] = useState<string | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Promise.all([
      fetch("/api/reviews", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Reviews could not be loaded.");
          const body = (await response.json()) as { reviews: ReviewListItem[] };
          setReviews(body.reviews);
        })
        .catch((loadError: unknown) => {
          setReviews([]);
          setError(loadError instanceof Error ? loadError.message : "Reviews could not be loaded.");
        }),
      fetch("/api/settings/status", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          setApiStatus((await response.json()) as ApiStatus);
        })
        .catch(() => undefined),
    ]);
  }, []);

  useEffect(() => {
    if (showCreate) titleInput.current?.focus();
  }, [showCreate]);

  async function createReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-VDR-Request": "1",
        },
        body: JSON.stringify({
          title: title.trim() || null,
          context: context.trim() || null,
        }),
      });
      const body = (await response.json()) as {
        review?: { id: string };
        error?: { message?: string };
      };
      if (!response.ok || !body.review) {
        throw new Error(body.error?.message ?? "The review could not be created.");
      }
      router.push(`/reviews/${body.review.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "The review could not be created.");
      setSubmitting(false);
    }
  }

  async function deleteSelectedReview() {
    if (!reviewToDelete) return;
    setDeletingReviewId(reviewToDelete.id);
    setDeleteReviewError(null);

    try {
      const response = await fetch(`/api/reviews/${encodeURIComponent(reviewToDelete.id)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-VDR-Request": "1",
        },
        body: JSON.stringify({ confirmation: "DELETE" }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "The review could not be deleted.");
      }
      setReviews((current) => current?.filter(({ id }) => id !== reviewToDelete.id) ?? []);
      setReviewToDelete(null);
    } catch (deleteError) {
      setDeleteReviewError(
        deleteError instanceof Error ? deleteError.message : "The review could not be deleted.",
      );
    } finally {
      setDeletingReviewId(null);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader status={apiStatus.ready ? "API ready" : apiStatus.label} />
      <main className="home-main">
        <section className="home-hero">
          <div>
            <p className="eyebrow">Professional review workspace</p>
            <h1>See the design more clearly.</h1>
            <p className="home-intro">
              Evidence-grounded visual analysis that challenges its own conclusions and keeps
              design quality separate from rubric compliance.
            </p>
          </div>
          <button className="button button-primary" onClick={() => setShowCreate(true)}>
            <PlusIcon /> New review
          </button>
        </section>

        {error ? <div className="notice error-notice">{error}</div> : null}

        <section className="criteria-library-callout" aria-labelledby="criteria-library-heading">
          <div className="criteria-library-callout-icon">
            <CriteriaIcon />
          </div>
          <div className="criteria-library-callout-copy">
            <p className="eyebrow">Reusable assessment resources</p>
            <h2 id="criteria-library-heading">Build your criteria library</h2>
            <p>
              Create and manage assessment criteria sets independently, then reuse them across
              reviews. Import and export portable JSON sets when you need to share or archive them.
            </p>
          </div>
          <button
            className="button button-secondary"
            onClick={() => setCriteriaSetsOpen(true)}
            type="button"
          >
            Manage criteria sets <ArrowRightIcon />
          </button>
        </section>

        {reviews === null ? (
          <LoadingCards />
        ) : reviews.length === 0 ? (
          <section className="empty-state">
            <div className="empty-icon">
              <ImageIcon style={{ width: 26, height: 26 }} />
            </div>
            <h2>Begin with a piece of work</h2>
            <p>
              Add one or more design images, choose what deserves attention, and run an
              independent design analysis before introducing assessment criteria.
            </p>
            <button className="button button-primary" onClick={() => setShowCreate(true)}>
              <PlusIcon /> Create the first review
            </button>
          </section>
        ) : (
          <section aria-labelledby="recent-reviews-heading">
            <div className="section-heading">
              <h2 id="recent-reviews-heading">Recent reviews</h2>
              <span className="muted" style={{ fontSize: 12 }}>
                {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
              </span>
            </div>
            <div className="reviews-grid">
              {reviews.map((review) => (
                <article className="review-card" key={review.id}>
                  <Link className="review-card-link" href={`/reviews/${review.id}`}>
                    <div className="review-card-top">
                      <span className="mini-badge">
                        {review.imageCount} {review.imageCount === 1 ? "image" : "images"}
                      </span>
                      <ArrowRightIcon />
                    </div>
                    <h3>{review.title || "Untitled review"}</h3>
                    <p>{review.contextPreview || "No context has been supplied yet."}</p>
                    <div className="review-card-meta">
                      <span>{formatRelativeDate(review.updatedAt)}</span>
                      <span>·</span>
                      <span>{review.designAnalysisCount + review.criteriaAnalysisCount} analyses</span>
                    </div>
                    <ReviewUsage usage={review.analysisUsage} />
                  </Link>
                  <button
                    aria-label={`Delete ${review.title || "Untitled review"}`}
                    className="review-card-delete"
                    onClick={() => {
                      setDeleteReviewError(null);
                      setReviewToDelete(review);
                    }}
                    title="Delete review"
                    type="button"
                  >
                    <TrashIcon />
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      {showCreate ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !submitting) setShowCreate(false);
          }}
        >
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-review-title">
            <div className="modal-header">
              <div>
                <h2 id="new-review-title">Create a review</h2>
                <p>You can change these details at any time before analysis.</p>
              </div>
              <button
                className="button button-ghost"
                aria-label="Close"
                disabled={submitting}
                onClick={() => setShowCreate(false)}
              >
                <CloseIcon />
              </button>
            </div>
            <form onSubmit={createReview}>
              <div className="field">
                <label htmlFor="review-title">
                  Review title <span className="field-hint">Optional</span>
                </label>
                <input
                  className="input"
                  id="review-title"
                  maxLength={160}
                  placeholder="e.g. Campaign poster exploration"
                  ref={titleInput}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="review-context">
                  Intention and context <span className="field-hint">Optional</span>
                </label>
                <textarea
                  className="textarea"
                  id="review-context"
                  maxLength={20_000}
                  placeholder="Audience, purpose, intended tone, constraints, or relevant rationale…"
                  value={context}
                  onChange={(event) => setContext(event.target.value)}
                />
                <span className="field-hint">
                  Avoid learner names or identifying information. Context is treated as a claim,
                  not as visible fact.
                </span>
              </div>
              <div className="modal-actions">
                <button
                  className="button button-secondary"
                  disabled={submitting}
                  onClick={() => setShowCreate(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button className="button button-primary" disabled={submitting} type="submit">
                  {submitting ? "Creating…" : "Create review"} <ArrowRightIcon />
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <DeleteReviewDialog
        busy={deletingReviewId === reviewToDelete?.id}
        error={deleteReviewError}
        onCancel={() => {
          setReviewToDelete(null);
          setDeleteReviewError(null);
        }}
        onConfirm={() => void deleteSelectedReview()}
        open={reviewToDelete !== null}
        reviewTitle={reviewToDelete?.title}
      />

      <CriteriaSetsDialog
        canApply
        criteria={criteriaDraft}
        criteriaDirty={criteriaDraftDirty}
        onApply={(incoming, mode) => {
          setCriteriaDraft((current) => reorderCriteria(
            mode === "append" ? [...current, ...incoming] : incoming,
          ));
          setCriteriaDraftDirty(mode === "append");
        }}
        onClose={() => setCriteriaSetsOpen(false)}
        onCriteriaChange={(next) => {
          setCriteriaDraft(next);
          setCriteriaDraftDirty(true);
        }}
        open={criteriaSetsOpen}
      />
    </div>
  );
}

function reorderCriteria(criteria: Criterion[]): Criterion[] {
  return criteria.map((criterion, order) => ({ ...criterion, order }));
}

function LoadingCards() {
  return (
    <div className="reviews-grid" aria-label="Loading reviews">
      {[0, 1, 2].map((item) => (
        <div className="review-card" key={item}>
          <div className="skeleton" style={{ height: 25, width: 70, marginBottom: 35 }} />
          <div className="skeleton" style={{ height: 22, width: "62%", marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 14, width: "90%", marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 14, width: "74%" }} />
        </div>
      ))}
    </div>
  );
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  const deltaDays = Math.round((date.getTime() - Date.now()) / 86_400_000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(deltaDays) < 7) return formatter.format(deltaDays, "day");
  return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
