import styles from "./review-workspace.module.css";
import type { Criterion, JudgementStatement } from "./types";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  TrashIcon,
} from "./workspace-icons";

type Props = {
  criteria: Criterion[];
  dirty: boolean;
  disabled?: boolean;
  onChange: (criteria: Criterion[]) => void;
  onOpenCriteriaSets?: () => void;
  onSave?: () => void;
};

export function CriteriaEditor({
  criteria,
  dirty,
  disabled,
  onChange,
  onOpenCriteriaSets,
  onSave,
}: Props) {
  function updateCriterion(index: number, patch: Partial<Criterion>) {
    onChange(criteria.map((criterion, itemIndex) => (
      itemIndex === index ? { ...criterion, ...patch } : criterion
    )));
  }

  function addCriterion() {
    onChange([
      ...criteria,
      {
        id: localId("criterion"),
        title: "",
        statement: "",
        assessorNote: "",
        judgementStatements: [],
        order: criteria.length,
      },
    ]);
  }

  function removeCriterion(index: number) {
    onChange(reorder(criteria.filter((_, itemIndex) => itemIndex !== index)));
  }

  function moveCriterion(index: number, direction: -1 | 1) {
    onChange(move(criteria, index, direction));
  }

  return (
    <div>
      {criteria.length === 0 ? (
        <div className={styles.criteriaEmpty}>
          <p>No assessment criteria yet.</p>
          <span>Add these after—or before—running the independent design review.</span>
        </div>
      ) : (
        <div className={styles.criteriaList}>
          {criteria.map((criterion, index) => (
            <article className={styles.criterionCard} key={criterion.id}>
              <div className={styles.criterionHeader}>
                <div>
                  <span className={styles.ordinal}>Criterion {index + 1}</span>
                  <strong>{criterion.title.trim() || "Untitled criterion"}</strong>
                </div>
                <div className={styles.orderActions}>
                  <button
                    aria-label={`Move criterion ${index + 1} up`}
                    disabled={disabled || index === 0}
                    onClick={() => moveCriterion(index, -1)}
                    title="Move up"
                    type="button"
                  >
                    <ChevronUpIcon />
                  </button>
                  <button
                    aria-label={`Move criterion ${index + 1} down`}
                    disabled={disabled || index === criteria.length - 1}
                    onClick={() => moveCriterion(index, 1)}
                    title="Move down"
                    type="button"
                  >
                    <ChevronDownIcon />
                  </button>
                  <button
                    aria-label={`Delete criterion ${index + 1}`}
                    className={styles.deleteIconButton}
                    disabled={disabled}
                    onClick={() => removeCriterion(index)}
                    title="Delete criterion"
                    type="button"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>

              <label className={styles.compactField}>
                <span>Title</span>
                <input
                  disabled={disabled}
                  maxLength={240}
                  onChange={(event) => updateCriterion(index, { title: event.target.value })}
                  placeholder="e.g. Typographic hierarchy"
                  value={criterion.title}
                />
              </label>
              <label className={styles.compactField}>
                <span>Criterion statement</span>
                <textarea
                  disabled={disabled}
                  maxLength={4_000}
                  onChange={(event) => updateCriterion(index, { statement: event.target.value })}
                  placeholder="What should the work demonstrate?"
                  rows={3}
                  value={criterion.statement}
                />
              </label>

              <div className={styles.judgementHeading}>
                <div>
                  <strong>Judgement statements</strong>
                  <span>Optional · order is preserved, not scored</span>
                </div>
                <button
                  className={styles.textButton}
                  disabled={disabled || criterion.judgementStatements.length >= 20}
                  onClick={() => updateCriterion(index, {
                    judgementStatements: [
                      ...criterion.judgementStatements,
                      {
                        id: localId("statement"),
                        label: "",
                        description: "",
                        order: criterion.judgementStatements.length,
                      },
                    ],
                  })}
                  type="button"
                >
                  <PlusIcon /> Add statement
                </button>
              </div>

              {criterion.judgementStatements.length > 0 ? (
                <div className={styles.judgements}>
                  {criterion.judgementStatements.map((statement, statementIndex) => (
                    <JudgementRow
                      disabled={disabled}
                      index={statementIndex}
                      key={statement.id}
                      onChange={(patch) => {
                        const next = criterion.judgementStatements.map((item, itemIndex) => (
                          itemIndex === statementIndex ? { ...item, ...patch } : item
                        ));
                        updateCriterion(index, { judgementStatements: next });
                      }}
                      onMove={(direction) => updateCriterion(index, {
                        judgementStatements: move(
                          criterion.judgementStatements,
                          statementIndex,
                          direction,
                        ),
                      })}
                      onRemove={() => updateCriterion(index, {
                        judgementStatements: reorder(
                          criterion.judgementStatements.filter(
                            (_, itemIndex) => itemIndex !== statementIndex,
                          ),
                        ),
                      })}
                      statement={statement}
                      total={criterion.judgementStatements.length}
                    />
                  ))}
                </div>
              ) : null}

              <label className={styles.compactField}>
                <span>Assessor note <em>Optional</em></span>
                <textarea
                  disabled={disabled}
                  maxLength={4_000}
                  onChange={(event) => updateCriterion(index, { assessorNote: event.target.value })}
                  placeholder="Private framing or constraints for this criterion"
                  rows={2}
                  value={criterion.assessorNote ?? ""}
                />
              </label>
            </article>
          ))}
        </div>
      )}

      <div className={styles.criteriaFooter}>
        {onOpenCriteriaSets ? (
          <button
            className={styles.criteriaSetsButton}
            onClick={onOpenCriteriaSets}
            type="button"
          >
            Criteria sets
          </button>
        ) : null}
        <button className={styles.addButton} disabled={disabled || criteria.length >= 50} onClick={addCriterion} type="button">
          <PlusIcon /> Add criterion
        </button>
        {onSave ? (
          <button
            className={styles.saveSmallButton}
            disabled={disabled || !dirty}
            onClick={onSave}
            type="button"
          >
            {disabled ? "Saving…" : dirty ? "Save criteria" : "Saved"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function JudgementRow({
  disabled,
  index,
  onChange,
  onMove,
  onRemove,
  statement,
  total,
}: {
  disabled?: boolean;
  index: number;
  onChange: (patch: Partial<JudgementStatement>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  statement: JudgementStatement;
  total: number;
}) {
  return (
    <div className={styles.judgementRow}>
      <span className={styles.judgementNumber}>{index + 1}</span>
      <div className={styles.judgementFields}>
        <input
          aria-label={`Judgement statement ${index + 1} label`}
          disabled={disabled}
          maxLength={240}
          onChange={(event) => onChange({ label: event.target.value })}
          placeholder="Label, in your wording"
          value={statement.label}
        />
        <textarea
          aria-label={`Judgement statement ${index + 1} description`}
          disabled={disabled}
          maxLength={4_000}
          onChange={(event) => onChange({ description: event.target.value })}
          placeholder="Describe the visible standard"
          rows={2}
          value={statement.description}
        />
      </div>
      <div className={styles.judgementActions}>
        <button aria-label={`Move statement ${index + 1} up`} disabled={disabled || index === 0} onClick={() => onMove(-1)} type="button"><ChevronUpIcon /></button>
        <button aria-label={`Move statement ${index + 1} down`} disabled={disabled || index === total - 1} onClick={() => onMove(1)} type="button"><ChevronDownIcon /></button>
        <button aria-label={`Delete statement ${index + 1}`} disabled={disabled} onClick={onRemove} type="button"><TrashIcon /></button>
      </div>
    </div>
  );
}

function move<T extends { order: number }>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return reorder(next);
}

function reorder<T extends { order: number }>(items: T[]): T[] {
  return items.map((item, order) => ({ ...item, order }));
}

function localId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}
