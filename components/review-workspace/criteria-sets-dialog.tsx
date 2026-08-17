"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CriteriaEditor } from "./criteria-editor";
import styles from "./review-workspace.module.css";
import {
  criteriaToSetTemplate,
  instantiateCriteriaSet,
} from "./criteria-set-mapping";
import type {
  CriteriaSet,
  CriteriaSetSummary,
  Criterion,
} from "./types";
import {
  CloseIcon,
  DownloadIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
} from "./workspace-icons";

type ApplyMode = "replace" | "append";

type Props = {
  canApply: boolean;
  criteria: Criterion[];
  criteriaDirty: boolean;
  onApply: (criteria: Criterion[], mode: ApplyMode, setName: string) => void;
  onClose: () => void;
  onCriteriaChange?: (criteria: Criterion[]) => void;
  open: boolean;
};

type LocalNotice = { kind: "error" | "success"; message: string };

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export function CriteriaSetsDialog({
  canApply,
  criteria,
  criteriaDirty,
  onApply,
  onClose,
  onCriteriaChange,
  open,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [sets, setSets] = useState<CriteriaSetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<string | null>(null);
  const [notice, setNotice] = useState<LocalNotice | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const managesDraft = onCriteriaChange !== undefined;

  const loadSets = useCallback(async () => {
    setLoading(true);
    try {
      const body = await requestJson<{ criteriaSets?: CriteriaSetSummary[] }>(
        "/api/criteria-sets",
      );
      setSets(body.criteriaSets ?? []);
    } catch (error) {
      setNotice({ kind: "error", message: messageFrom(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setNotice(null);
      void loadSets();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [loadSets, open]);

  async function saveCurrentAsSet() {
    setOperation("create");
    setNotice(null);
    try {
      const validationError = criteriaInputError(criteria);
      if (validationError) throw new Error(validationError);
      await requestJson("/api/criteria-sets", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: description.trim() || null,
          criteria: criteriaToSetTemplate(criteria),
        }),
      });
      setName("");
      setDescription("");
      await loadSets();
      setNotice({ kind: "success", message: "Criteria set saved to the library." });
    } catch (error) {
      setNotice({ kind: "error", message: messageFrom(error) });
    } finally {
      setOperation(null);
    }
  }

  async function applySet(criteriaSetId: string, mode: ApplyMode) {
    if (!canApply) return;
    if (
      mode === "replace" &&
      (criteria.length > 0 || criteriaDirty) &&
      !window.confirm(
        managesDraft
          ? "Replace the criteria currently in this draft? Unsaved edits will be discarded."
          : "Replace the criteria currently in this editor? Unsaved edits will be discarded.",
      )
    ) {
      return;
    }
    setOperation(`apply-${criteriaSetId}`);
    setNotice(null);
    try {
      const body = await requestJson<{ criteriaSet?: CriteriaSet }>(
        `/api/criteria-sets/${encodeURIComponent(criteriaSetId)}`,
      );
      if (!body.criteriaSet) throw new Error("The criteria set could not be loaded.");
      const instantiated = instantiateCriteriaSet(body.criteriaSet.criteria);
      if (mode === "append" && criteria.length + instantiated.length > 50) {
        throw new Error("Appending this set would exceed the 50-criterion limit.");
      }
      onApply(instantiated, mode, body.criteriaSet.name);
      if (managesDraft) {
        setNotice({
          kind: "success",
          message: mode === "append"
            ? `Added “${body.criteriaSet.name}” to the editable draft.`
            : `Loaded “${body.criteriaSet.name}” into the editable draft.`,
        });
      } else {
        onClose();
      }
    } catch (error) {
      setNotice({ kind: "error", message: messageFrom(error) });
    } finally {
      setOperation(null);
    }
  }

  async function updateFromCurrent(criteriaSet: CriteriaSetSummary) {
    if (!window.confirm(`Replace “${criteriaSet.name}” with the criteria currently in this editor?`)) {
      return;
    }
    setOperation(`update-${criteriaSet.id}`);
    setNotice(null);
    try {
      const validationError = criteriaInputError(criteria);
      if (validationError) throw new Error(validationError);
      await requestJson(`/api/criteria-sets/${encodeURIComponent(criteriaSet.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          name: criteriaSet.name,
          description: criteriaSet.description,
          criteria: criteriaToSetTemplate(criteria),
        }),
      });
      await loadSets();
      setNotice({
        kind: "success",
        message: managesDraft
          ? "Criteria set updated from the editable draft."
          : "Criteria set updated from this review.",
      });
    } catch (error) {
      setNotice({ kind: "error", message: messageFrom(error) });
    } finally {
      setOperation(null);
    }
  }

  async function saveMetadata(criteriaSetId: string) {
    setOperation(`edit-${criteriaSetId}`);
    setNotice(null);
    try {
      const detail = await requestJson<{ criteriaSet?: CriteriaSet }>(
        `/api/criteria-sets/${encodeURIComponent(criteriaSetId)}`,
      );
      if (!detail.criteriaSet) throw new Error("The criteria set could not be loaded.");
      await requestJson(`/api/criteria-sets/${encodeURIComponent(criteriaSetId)}`, {
        method: "PUT",
        body: JSON.stringify({
          name: editingName,
          description: editingDescription.trim() || null,
          criteria: detail.criteriaSet.criteria,
        }),
      });
      setEditingId(null);
      await loadSets();
      setNotice({ kind: "success", message: "Criteria-set details updated." });
    } catch (error) {
      setNotice({ kind: "error", message: messageFrom(error) });
    } finally {
      setOperation(null);
    }
  }

  async function deleteSet(criteriaSet: CriteriaSetSummary) {
    if (!window.confirm(`Delete “${criteriaSet.name}”? Reviews that used it will not change.`)) {
      return;
    }
    setOperation(`delete-${criteriaSet.id}`);
    setNotice(null);
    try {
      await requestJson(`/api/criteria-sets/${encodeURIComponent(criteriaSet.id)}`, {
        method: "DELETE",
      });
      await loadSets();
      setNotice({ kind: "success", message: "Criteria set deleted." });
    } catch (error) {
      setNotice({ kind: "error", message: messageFrom(error) });
    } finally {
      setOperation(null);
    }
  }

  async function importFile(file: File) {
    setNotice(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setNotice({ kind: "error", message: "The criteria-set file is too large." });
      return;
    }
    setOperation("import");
    try {
      const source = await file.text();
      let document: unknown;
      try {
        document = JSON.parse(source) as unknown;
      } catch {
        throw new Error("The selected file is not valid JSON.");
      }
      const preview = importPreview(document);
      if (
        preview &&
        !window.confirm(
          `Import “${preview.name}” with ${preview.criteriaCount} ${preview.criteriaCount === 1 ? "criterion" : "criteria"} and ${preview.judgementCount} judgement statements?`,
        )
      ) {
        return;
      }
      const collision = preview
        ? sets.find((item) => normalisedName(item.name) === normalisedName(preview.name))
        : undefined;
      if (collision) {
        const replace = window.confirm(
          `A set named “${collision.name}” already exists. Select OK to replace it, or Cancel to import a renamed copy.`,
        );
        if (replace) {
          await requestJson(`/api/criteria-sets/${encodeURIComponent(collision.id)}/import`, {
            method: "PUT",
            body: JSON.stringify(document),
          });
        } else {
          const copyName = window.prompt("Name for the imported copy", `${preview!.name} copy`);
          if (!copyName?.trim()) return;
          await requestJson("/api/criteria-sets/import", {
            method: "POST",
            body: JSON.stringify({
              ...(document as Record<string, unknown>),
              name: copyName,
            }),
          });
        }
      } else {
        await requestJson("/api/criteria-sets/import", {
          method: "POST",
          body: JSON.stringify(document),
        });
      }
      await loadSets();
      setNotice({ kind: "success", message: "Criteria set imported." });
    } catch (error) {
      setNotice({ kind: "error", message: messageFrom(error) });
    } finally {
      setOperation(null);
      if (importRef.current) importRef.current.value = "";
    }
  }

  return (
    <dialog
      aria-labelledby="criteria-sets-title"
      className={styles.criteriaSetsDialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <div className={styles.criteriaSetsDialogHeader}>
        <div>
          <span>Reusable assessment resources</span>
          <h2 id="criteria-sets-title">Assessment criteria sets</h2>
          <p>
            {managesDraft
              ? "Create and refine reusable rubrics, or import and export them as portable JSON files."
              : "Save a rubric once, then load it into any review without linking their histories."}
          </p>
        </div>
        <button aria-label="Close criteria sets" onClick={onClose} type="button">
          <CloseIcon />
        </button>
      </div>

      {notice ? (
        <div
          className={`${styles.criteriaSetsNotice} ${notice.kind === "error" ? styles.criteriaSetsNoticeError : ""}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.message}
        </div>
      ) : null}

      {managesDraft ? (
        <section className={styles.criteriaSetDraft} aria-labelledby="criteria-set-draft-title">
          <div className={styles.criteriaSetDraftHeading}>
            <div>
              <h3 id="criteria-set-draft-title">Editable criteria draft</h3>
              <p>
                Build a set from scratch, or load a saved set below and change it here.
              </p>
            </div>
            <div>
              <span>
                {criteria.length} {criteria.length === 1 ? "criterion" : "criteria"}
              </span>
              <button
                disabled={criteria.length === 0 || operation !== null}
                onClick={() => {
                  if (window.confirm("Clear every criterion from this draft?")) {
                    onCriteriaChange([]);
                    setNotice(null);
                  }
                }}
                type="button"
              >
                Clear draft
              </button>
            </div>
          </div>
          <CriteriaEditor
            criteria={criteria}
            dirty={criteriaDirty}
            disabled={operation !== null}
            onChange={onCriteriaChange}
          />
        </section>
      ) : null}

      <div className={styles.criteriaSetsTools}>
        <section className={styles.criteriaSetCreate}>
          <h3>{managesDraft ? "Save draft as a new set" : "Save current criteria as a set"}</h3>
          <div className={styles.criteriaSetCreateFields}>
            <label>
              <span>Set name</span>
              <input
                disabled={operation !== null}
                maxLength={240}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Year 2 visual communication rubric"
                value={name}
              />
            </label>
            <label>
              <span>Description <em>Optional</em></span>
              <input
                disabled={operation !== null}
                maxLength={1_000}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="When or how this set is used"
                value={description}
              />
            </label>
          </div>
          <button
            className={styles.criteriaSetPrimary}
            disabled={operation !== null || criteria.length === 0 || !name.trim()}
            onClick={() => void saveCurrentAsSet()}
            type="button"
          >
            <PlusIcon /> {operation === "create" ? "Saving…" : "Save as new set"}
          </button>
        </section>

        <div className={styles.criteriaSetImport}>
          <input
            accept="application/json,.json"
            className={styles.visuallyHiddenInput}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
            }}
            ref={importRef}
            type="file"
          />
          <button
            disabled={operation !== null}
            onClick={() => importRef.current?.click()}
            type="button"
          >
            <UploadIcon /> {operation === "import" ? "Importing…" : "Import JSON set"}
          </button>
        </div>
      </div>

      <section className={styles.criteriaSetLibrary} aria-label="Saved criteria sets">
        <div className={styles.criteriaSetLibraryHeading}>
          <h3>Saved sets</h3>
          <span>{sets.length} {sets.length === 1 ? "set" : "sets"}</span>
        </div>
        {loading ? <p className={styles.criteriaSetEmpty}>Loading criteria sets…</p> : null}
        {!loading && sets.length === 0 ? (
          <p className={styles.criteriaSetEmpty}>No reusable criteria sets have been saved yet.</p>
        ) : null}
        {!loading ? sets.map((criteriaSet) => (
          <article className={styles.criteriaSetRow} key={criteriaSet.id}>
            {editingId === criteriaSet.id ? (
              <div className={styles.criteriaSetEditFields}>
                <label>
                  <span>Name</span>
                  <input
                    maxLength={240}
                    onChange={(event) => setEditingName(event.target.value)}
                    value={editingName}
                  />
                </label>
                <label>
                  <span>Description</span>
                  <input
                    maxLength={1_000}
                    onChange={(event) => setEditingDescription(event.target.value)}
                    value={editingDescription}
                  />
                </label>
                <div>
                  <button
                    disabled={operation !== null || !editingName.trim()}
                    onClick={() => void saveMetadata(criteriaSet.id)}
                    type="button"
                  >Save details</button>
                  <button onClick={() => setEditingId(null)} type="button">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.criteriaSetMeta}>
                  <strong>{criteriaSet.name}</strong>
                  {criteriaSet.description ? <p>{criteriaSet.description}</p> : null}
                  <span>
                    {criteriaSet.criterionCount} {criteriaSet.criterionCount === 1 ? "criterion" : "criteria"}
                    {" · "}{criteriaSet.judgementStatementCount} judgement statements
                    {" · Updated "}{formatDate(criteriaSet.updatedAt)}
                  </span>
                </div>
                <div className={styles.criteriaSetActions}>
                  <button
                    disabled={!canApply || operation !== null}
                    onClick={() => void applySet(criteriaSet.id, "replace")}
                    type="button"
                  >{managesDraft ? "Edit" : "Load"}</button>
                  <button
                    disabled={!canApply || operation !== null}
                    onClick={() => void applySet(criteriaSet.id, "append")}
                    type="button"
                  >Add</button>
                  <a
                    download
                    href={`/api/criteria-sets/${encodeURIComponent(criteriaSet.id)}/export`}
                  ><DownloadIcon /> Export</a>
                  <button
                    disabled={criteria.length === 0 || operation !== null}
                    onClick={() => void updateFromCurrent(criteriaSet)}
                    type="button"
                  >Update</button>
                  <button
                    disabled={operation !== null}
                    onClick={() => {
                      setEditingId(criteriaSet.id);
                      setEditingName(criteriaSet.name);
                      setEditingDescription(criteriaSet.description ?? "");
                    }}
                    type="button"
                  >Rename</button>
                  <button
                    aria-label={`Delete ${criteriaSet.name}`}
                    className={styles.criteriaSetDelete}
                    disabled={operation !== null}
                    onClick={() => void deleteSet(criteriaSet)}
                    type="button"
                  ><TrashIcon /></button>
                </div>
              </>
            )}
          </article>
        )) : null}
      </section>
    </dialog>
  );
}

async function requestJson<T = Record<string, unknown>>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET") headers.set("X-VDR-Request", "1");
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, cache: "no-store", headers });
  if (response.status === 204) return {} as T;
  const body = await response.json().catch(() => ({})) as T & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message ?? "The request could not be completed.");
  return body;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "The criteria-set operation failed.";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function criteriaInputError(criteria: Criterion[]): string | null {
  if (criteria.length === 0) return "Add at least one criterion before saving a set.";
  for (const [criterionIndex, criterion] of criteria.entries()) {
    if (!criterion.title.trim() || !criterion.statement.trim()) {
      return `Criterion ${criterionIndex + 1} needs a title and criterion statement.`;
    }
    for (const [statementIndex, statement] of criterion.judgementStatements.entries()) {
      if (!statement.label.trim() || !statement.description.trim()) {
        return `Judgement statement ${statementIndex + 1} in criterion ${criterionIndex + 1} needs a label and description.`;
      }
    }
  }
  return null;
}

function importPreview(input: unknown): {
  name: string;
  criteriaCount: number;
  judgementCount: number;
} | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (typeof record.name !== "string" || !Array.isArray(record.criteria)) return null;
  return {
    name: record.name,
    criteriaCount: record.criteria.length,
    judgementCount: record.criteria.reduce((total, criterion) => {
      if (criterion === null || typeof criterion !== "object" || Array.isArray(criterion)) {
        return total;
      }
      const statements = (criterion as Record<string, unknown>).judgementStatements;
      return total + (Array.isArray(statements) ? statements.length : 0);
    }, 0),
  };
}

function normalisedName(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}
