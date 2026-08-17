import styles from "./review-workspace.module.css";
import type {
  ReviewAreaSelection,
  ReviewMode,
  Taxonomy,
  TaxonomyArea,
  TaxonomyCategory,
} from "./types";

type Props = {
  taxonomy: Taxonomy;
  selections: ReviewAreaSelection[];
  disabled?: boolean;
  onChange: (areaIds: string[], mode: ReviewMode) => void;
};

export function TaxonomyEditor({ taxonomy, selections, disabled, onChange }: Props) {
  const tree = buildTaxonomyTree(taxonomy);
  const selectionMap = new Map(selections.map((selection) => [selection.areaId, selection.mode]));
  const allAreas = tree.flatMap(collectAreas);
  const counts = countModes(allAreas.map((area) => selectionMap.get(area.id) ?? "off"));

  return (
    <div>
      <div className={styles.taxonomySummary} aria-label="Review area selection summary">
        <span><i className={styles.reviewDot} />{counts.review} Review</span>
        <span><i className={styles.focusDot} />{counts.focus} Focus</span>
        <span>{counts.off} Off</span>
      </div>
      <div className={styles.taxonomyTree}>
        {tree.map((category) => (
          <CategoryGroup
            category={category}
            depth={0}
            disabled={disabled}
            key={category.id}
            onChange={onChange}
            selectionMap={selectionMap}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryGroup({
  category,
  depth,
  disabled,
  onChange,
  selectionMap,
}: {
  category: TaxonomyCategory;
  depth: number;
  disabled?: boolean;
  onChange: (areaIds: string[], mode: ReviewMode) => void;
  selectionMap: Map<string, ReviewMode>;
}) {
  const areas = category.areas ?? [];
  const children = [...(category.groups ?? []), ...(category.categories ?? [])];
  const descendantAreaIds = collectAreas(category).map((area) => area.id);
  const modes = descendantAreaIds.map((id) => selectionMap.get(id) ?? "off");
  const summary = summariseModes(modes);

  return (
    <details className={styles.taxonomyGroup} open={depth === 0 ? true : undefined}>
      <summary>
        <span className={styles.taxonomyGroupTitle}>{category.label}</span>
        <span className={`${styles.groupState} ${styles[`groupState_${summary}`]}`}>
          {summary === "mixed" ? "Mixed" : capitalise(summary)}
        </span>
      </summary>
      <div className={styles.taxonomyGroupBody}>
        <div className={styles.bulkRow} role="group" aria-label={`Set all ${category.label} areas`}>
          <span>Set all</span>
          {(["off", "review", "focus"] as const).map((mode) => (
            <button
              className={`${styles.bulkButton} ${summary === mode ? styles.bulkButtonActive : ""}`}
              disabled={disabled || descendantAreaIds.length === 0}
              key={mode}
              onClick={() => onChange(descendantAreaIds, mode)}
              type="button"
            >
              {mode === "focus" ? "◉ Focus" : capitalise(mode)}
            </button>
          ))}
        </div>
        {areas.map((area) => (
          <AreaControl
            area={area}
            disabled={disabled}
            key={area.id}
            mode={selectionMap.get(area.id) ?? "off"}
            onChange={(mode) => onChange([area.id], mode)}
          />
        ))}
        {children.map((child) => (
          <CategoryGroup
            category={child}
            depth={depth + 1}
            disabled={disabled}
            key={child.id}
            onChange={onChange}
            selectionMap={selectionMap}
          />
        ))}
      </div>
    </details>
  );
}

function AreaControl({
  area,
  disabled,
  mode,
  onChange,
}: {
  area: TaxonomyArea;
  disabled?: boolean;
  mode: ReviewMode;
  onChange: (mode: ReviewMode) => void;
}) {
  return (
    <div className={styles.areaRow}>
      <div className={styles.areaLabel} title={area.description ?? undefined}>{area.label}</div>
      <div className={styles.modeControl} role="group" aria-label={`${area.label} review mode`}>
        {(["off", "review", "focus"] as const).map((choice) => (
          <button
            aria-pressed={mode === choice}
            className={`${styles.modeButton} ${mode === choice ? styles[`mode_${choice}`] : ""}`}
            disabled={disabled}
            key={choice}
            onClick={() => onChange(choice)}
            title={`Set ${area.label} to ${choice}`}
            type="button"
          >
            {choice === "focus" ? "◉ " : ""}{capitalise(choice)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function buildTaxonomyTree(taxonomy: Taxonomy): TaxonomyCategory[] {
  const hasNestedData = taxonomy.categories.some(
    (category) =>
      (category.areas?.length ?? 0) > 0 ||
      (category.groups?.length ?? 0) > 0 ||
      (category.categories?.length ?? 0) > 0,
  );

  if (hasNestedData) return [...taxonomy.categories].sort(byOrder);

  const allCategories = [...taxonomy.categories].sort(byOrder);
  const areasByCategory = new Map<string, TaxonomyArea[]>();
  for (const area of taxonomy.areas ?? []) {
    const ownerId = area.categoryId ?? "";
    areasByCategory.set(ownerId, [...(areasByCategory.get(ownerId) ?? []), area]);
  }

  function build(category: TaxonomyCategory): TaxonomyCategory {
    return {
      ...category,
      areas: [...(areasByCategory.get(category.id) ?? [])].sort(byOrder),
      groups: allCategories
        .filter((candidate) => candidate.parentId === category.id)
        .map(build),
    };
  }

  return allCategories.filter((category) => !category.parentId).map(build);
}

export function collectAreas(category: TaxonomyCategory): TaxonomyArea[] {
  return [
    ...(category.areas ?? []),
    ...(category.groups ?? []).flatMap(collectAreas),
    ...(category.categories ?? []).flatMap(collectAreas),
  ];
}

export function allTaxonomyAreas(taxonomy: Taxonomy): TaxonomyArea[] {
  return buildTaxonomyTree(taxonomy).flatMap(collectAreas);
}

function byOrder(left: { order?: number }, right: { order?: number }) {
  return (left.order ?? 0) - (right.order ?? 0);
}

function countModes(modes: ReviewMode[]) {
  return modes.reduce(
    (counts, mode) => ({ ...counts, [mode]: counts[mode] + 1 }),
    { off: 0, review: 0, focus: 0 },
  );
}

function summariseModes(modes: ReviewMode[]): ReviewMode | "mixed" {
  if (!modes.length) return "off";
  return modes.every((mode) => mode === modes[0]) ? modes[0] : "mixed";
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
