import Image from "next/image";
import { ChangeEvent, useEffect, useRef } from "react";

import styles from "./review-workspace.module.css";
import type { ImageAnalysisRole, ReviewImage } from "./types";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ImageIcon,
  TrashIcon,
  UploadIcon,
} from "./workspace-icons";

type Props = {
  reviewId: string;
  images: ReviewImage[];
  selectedId: string | null;
  busy?: boolean;
  onSelect: (imageId: string) => void;
  onFiles: (files: File[]) => void;
  onMove: (imageId: string, direction: -1 | 1) => void;
  onRemove: (image: ReviewImage) => void;
  onPurge: () => void;
  onRoleChange: (imageId: string, role: ImageAnalysisRole) => void;
};

export function ImageWorkspace({
  reviewId,
  images,
  selectedId,
  busy,
  onSelect,
  onFiles,
  onMove,
  onRemove,
  onPurge,
  onRoleChange,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const orderedImages = [...images].sort(
    (left, right) => (left.order ?? left.position ?? 0) - (right.order ?? right.position ?? 0),
  );
  const selected = orderedImages.find((image) => image.id === selectedId) ?? orderedImages[0];
  const finalCount = orderedImages.filter((image) => image.analysisRole === "final_work").length;
  const developmentCount = orderedImages.length - finalCount;

  useEffect(() => {
    if (selected && selected.id !== selectedId) onSelect(selected.id);
  }, [onSelect, selected, selectedId]);

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length) onFiles(files);
    event.target.value = "";
  }

  return (
    <section className={styles.imagePanel} aria-labelledby="image-workspace-title">
      <div className={styles.panelHeading}>
        <div>
          <span className={styles.panelKicker}>
            Source work{orderedImages.length ? ` · ${finalCount} final · ${developmentCount} development` : ""}
          </span>
          <h2 id="image-workspace-title">Image workspace</h2>
        </div>
        <div className={styles.imagePanelActions}>
          <input
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            hidden
            multiple
            onChange={chooseFiles}
            ref={fileInput}
            type="file"
          />
          <button
            className={styles.smallButton}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            type="button"
          >
            <UploadIcon /> {busy ? "Working…" : "Add images"}
          </button>
          {orderedImages.some((image) => image.retainedLocally) ? (
            <button className={styles.purgeButton} disabled={busy} onClick={onPurge} type="button">
              Purge source files
            </button>
          ) : null}
        </div>
      </div>

      {!selected ? (
        <button
          className={styles.imageEmpty}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          type="button"
        >
          <span><ImageIcon /></span>
          <strong>Add the design work</strong>
          <p>Choose JPEG, PNG, or WebP files. Multiple images remain in the order shown below.</p>
          <em><UploadIcon /> Select images</em>
        </button>
      ) : (
        <>
          <div className={styles.previewStage}>
            {selected.retainedLocally && selected.state !== "purged" ? (
              <Image
                alt={`Preview of ${imageName(selected)}`}
                className={styles.previewImage}
                height={Math.max(selected.height, 1)}
                priority
                src={previewUrl(reviewId, selected)}
                unoptimized
                width={Math.max(selected.width, 1)}
              />
            ) : (
              <div className={styles.purgedPreview}>
                <TrashIcon />
                <strong>Source image purged</strong>
                <p>The textual analysis remains available. Re-upload is required for another image-based run.</p>
              </div>
            )}
          </div>
          <div className={styles.previewMeta}>
            <div>
              <strong>{imageName(selected)}</strong>
              <span>{selected.width} × {selected.height} px · {mimeLabel(selected.mimeType)}</span>
            </div>
            <div className={styles.imagePurposeControl}>
              <span id={`image-purpose-${selected.id}`}>Image purpose</span>
              <div aria-labelledby={`image-purpose-${selected.id}`} role="group">
                <button
                  aria-pressed={selected.analysisRole === "final_work"}
                  className={selected.analysisRole === "final_work" ? styles.imagePurposeSelected : ""}
                  disabled={busy}
                  onClick={() => onRoleChange(selected.id, "final_work")}
                  type="button"
                >
                  Final work
                </button>
                <button
                  aria-pressed={selected.analysisRole === "concept_development"}
                  className={selected.analysisRole === "concept_development" ? styles.imagePurposeSelected : ""}
                  disabled={busy}
                  onClick={() => onRoleChange(selected.id, "concept_development")}
                  type="button"
                >
                  Concept &amp; development
                </button>
              </div>
            </div>
            <span className={`${styles.retentionBadge} ${selected.retainedLocally ? styles.retained : styles.purged}`}>
              {selected.retainedLocally ? "Encrypted locally" : "Source purged"}
            </span>
          </div>
        </>
      )}

      {orderedImages.length > 0 ? (
        <div className={styles.thumbnailStrip} aria-label="Uploaded image order">
          {orderedImages.map((image, index) => (
            <div className={`${styles.thumbnailItem} ${selected?.id === image.id ? styles.thumbnailSelected : ""}`} key={image.id}>
              <button
                aria-label={`Preview ${imageName(image)}`}
                className={styles.thumbnailPreview}
                onClick={() => onSelect(image.id)}
                type="button"
              >
                <span className={styles.thumbnailNumber}>{index + 1}</span>
                <span className={`${styles.thumbnailRole} ${image.analysisRole === "concept_development" ? styles.thumbnailRoleDevelopment : ""}`}>
                  {image.analysisRole === "concept_development" ? "Development" : "Final"}
                </span>
                {image.retainedLocally && image.state !== "purged" ? (
                  <Image
                    alt=""
                    height={70}
                    src={previewUrl(reviewId, image)}
                    unoptimized
                    width={92}
                  />
                ) : (
                  <span className={styles.thumbnailMissing}><ImageIcon /></span>
                )}
                <span className={styles.thumbnailName}>{imageName(image)}</span>
              </button>
              <div className={styles.thumbnailActions}>
                <button aria-label={`Move ${imageName(image)} up`} disabled={busy || index === 0} onClick={() => onMove(image.id, -1)} title="Move earlier" type="button"><ChevronUpIcon /></button>
                <button aria-label={`Move ${imageName(image)} down`} disabled={busy || index === orderedImages.length - 1} onClick={() => onMove(image.id, 1)} title="Move later" type="button"><ChevronDownIcon /></button>
                <button aria-label={`Remove ${imageName(image)}`} className={styles.removeImageButton} disabled={busy} onClick={() => onRemove(image)} title="Remove" type="button"><TrashIcon /></button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function imageName(image: ReviewImage) {
  return image.originalFilename || image.displayName || "Untitled image";
}

function previewUrl(reviewId: string, image: ReviewImage) {
  return image.previewUrl || `/api/reviews/${encodeURIComponent(reviewId)}/images/${encodeURIComponent(image.id)}/preview`;
}

function mimeLabel(mimeType: string) {
  return mimeType.replace("image/", "").toUpperCase();
}
