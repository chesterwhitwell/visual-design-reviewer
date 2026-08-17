"use client";

type DeleteReviewDialogProps = {
  activeAnalysis?: boolean;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  reviewTitle?: string | null;
};

export function DeleteReviewDialog({
  activeAnalysis = false,
  busy,
  error,
  onCancel,
  onConfirm,
  open,
  reviewTitle,
}: DeleteReviewDialogProps) {
  if (!open) return null;
  const displayTitle = reviewTitle?.trim() || "Untitled review";

  return (
    <div
      className="modal-backdrop"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onCancel();
      }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onCancel();
      }}
      role="presentation"
    >
      <section
        aria-describedby="delete-review-description"
        aria-labelledby="delete-review-title"
        aria-modal="true"
        className="modal"
        role="dialog"
      >
        <div className="modal-header">
          <div>
            <h2 id="delete-review-title">Delete “{displayTitle}”?</h2>
            <p id="delete-review-description">Are you sure? This action cannot be undone.</p>
          </div>
        </div>
        <p className="notice error-notice">
          This permanently removes the review, all associated encrypted image files and
          previews, criteria, analysis runs, results, and version history. Downloaded exports
          and external backups are not affected.
        </p>
        {activeAnalysis ? (
          <p className="notice">
            Wait for or cancel the active analysis before deleting this review.
          </p>
        ) : null}
        {error ? <p className="notice error-notice">{error}</p> : null}
        <div className="modal-actions">
          <button
            autoFocus
            className="button button-secondary"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button-danger"
            disabled={busy || activeAnalysis}
            onClick={onConfirm}
            type="button"
          >
            {busy ? "Deleting review…" : "Yes, delete review"}
          </button>
        </div>
      </section>
    </div>
  );
}
