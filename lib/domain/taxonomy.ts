import { z } from "zod";

import {
  ApplicationIdSchema,
  NonNegativeOrderSchema,
  ShortTextSchema,
  addContiguousOrderIssues,
  addDuplicateIssues,
} from "./common";

export const ReviewModeSchema = z.enum(["off", "review", "focus"]);
export const SelectedReviewModeSchema = z.enum(["review", "focus"]);

export const TaxonomyCategorySchema = z
  .object({
    id: ApplicationIdSchema,
    label: ShortTextSchema,
    parentId: ApplicationIdSchema.nullable(),
    order: NonNegativeOrderSchema,
  })
  .strict();

export const TaxonomyAreaSchema = z
  .object({
    id: ApplicationIdSchema,
    categoryId: ApplicationIdSchema,
    label: ShortTextSchema,
    description: z.string().trim().min(1).max(1_000).nullable(),
    order: NonNegativeOrderSchema,
  })
  .strict();

export const TaxonomyConfigSchema = z
  .object({
    id: ApplicationIdSchema,
    version: z.string().trim().min(1).max(64),
    label: ShortTextSchema,
    categories: z.array(TaxonomyCategorySchema).min(1).max(64),
    areas: z.array(TaxonomyAreaSchema).min(1).max(256),
  })
  .strict()
  .superRefine((taxonomy, context) => {
    addDuplicateIssues(
      taxonomy.categories.map(({ id }) => id),
      context,
      ["categories"],
      "category IDs",
    );
    addDuplicateIssues(
      taxonomy.areas.map(({ id }) => id),
      context,
      ["areas"],
      "area IDs",
    );

    const categoryIds = new Set(taxonomy.categories.map(({ id }) => id));
    const categoriesById = new Map(
      taxonomy.categories.map((category) => [category.id, category]),
    );

    taxonomy.categories.forEach((category, index) => {
      if (category.parentId === category.id) {
        context.addIssue({
          code: "custom",
          message: "a category cannot be its own parent",
          path: ["categories", index, "parentId"],
        });
        return;
      }

      if (category.parentId !== null && !categoryIds.has(category.parentId)) {
        context.addIssue({
          code: "custom",
          message: "parentId must reference a category in this taxonomy",
          path: ["categories", index, "parentId"],
        });
      }

      const seen = new Set<string>([category.id]);
      let parentId = category.parentId;
      while (parentId !== null) {
        if (seen.has(parentId)) {
          context.addIssue({
            code: "custom",
            message: "taxonomy categories cannot contain a parent cycle",
            path: ["categories", index, "parentId"],
          });
          break;
        }
        seen.add(parentId);
        parentId = categoriesById.get(parentId)?.parentId ?? null;
      }
    });

    const siblingGroups = new Map<string, number[]>();
    taxonomy.categories.forEach(({ parentId, order }) => {
      const key = parentId ?? "__root__";
      siblingGroups.set(key, [...(siblingGroups.get(key) ?? []), order]);
    });
    siblingGroups.forEach((orders, parentId) => {
      addDuplicateIssues(orders, context, ["categories"], `category order under ${parentId}`);
      addContiguousOrderIssues(
        orders,
        context,
        ["categories"],
        `category order under ${parentId}`,
      );
    });

    const areaOrderByCategory = new Map<string, number[]>();
    taxonomy.areas.forEach((area, index) => {
      if (!categoryIds.has(area.categoryId)) {
        context.addIssue({
          code: "custom",
          message: "categoryId must reference a category in this taxonomy",
          path: ["areas", index, "categoryId"],
        });
      }
      areaOrderByCategory.set(area.categoryId, [
        ...(areaOrderByCategory.get(area.categoryId) ?? []),
        area.order,
      ]);
    });
    areaOrderByCategory.forEach((orders, categoryId) => {
      addDuplicateIssues(orders, context, ["areas"], `area order in ${categoryId}`);
      addContiguousOrderIssues(
        orders,
        context,
        ["areas"],
        `area order in ${categoryId}`,
      );
    });
  });

export const ReviewAreaSelectionSchema = z
  .object({
    areaId: ApplicationIdSchema,
    mode: ReviewModeSchema,
  })
  .strict();

export const ReviewAreaSelectionsSchema = z
  .array(ReviewAreaSelectionSchema)
  .max(256)
  .superRefine((selections, context) => {
    addDuplicateIssues(
      selections.map(({ areaId }) => areaId),
      context,
      [],
      "review-area selections",
    );
  });

export const ReviewAreaSnapshotSchema = z
  .object({
    taxonomyId: ApplicationIdSchema,
    taxonomyVersion: z.string().trim().min(1).max(64),
    areaId: ApplicationIdSchema,
    areaLabel: ShortTextSchema,
    mode: SelectedReviewModeSchema,
  })
  .strict();

export function validateSelectionsAgainstTaxonomy(
  taxonomyInput: unknown,
  selectionsInput: unknown,
): z.infer<typeof ReviewAreaSelectionSchema>[] {
  const taxonomy = TaxonomyConfigSchema.parse(taxonomyInput);
  const selections = ReviewAreaSelectionsSchema.parse(selectionsInput);
  const configuredIds = new Set(taxonomy.areas.map(({ id }) => id));
  const selectedIds = new Set(selections.map(({ areaId }) => areaId));

  for (const selection of selections) {
    if (!configuredIds.has(selection.areaId)) {
      throw new Error(`Unknown taxonomy area: ${selection.areaId}`);
    }
  }

  for (const areaId of configuredIds) {
    if (!selectedIds.has(areaId)) {
      throw new Error(`Missing review-area selection: ${areaId}`);
    }
  }

  return selections;
}

export function applyCategoryMode(
  taxonomyInput: unknown,
  selectionsInput: unknown,
  categoryId: string,
  mode: z.infer<typeof ReviewModeSchema>,
): z.infer<typeof ReviewAreaSelectionSchema>[] {
  const taxonomy = TaxonomyConfigSchema.parse(taxonomyInput);
  const selections = validateSelectionsAgainstTaxonomy(taxonomy, selectionsInput);
  const categoryIds = new Set<string>([categoryId]);

  let changed = true;
  while (changed) {
    changed = false;
    for (const category of taxonomy.categories) {
      if (category.parentId !== null && categoryIds.has(category.parentId)) {
        if (!categoryIds.has(category.id)) {
          categoryIds.add(category.id);
          changed = true;
        }
      }
    }
  }

  if (!taxonomy.categories.some(({ id }) => id === categoryId)) {
    throw new Error(`Unknown taxonomy category: ${categoryId}`);
  }

  const affectedAreaIds = new Set(
    taxonomy.areas
      .filter(({ categoryId: ownerId }) => categoryIds.has(ownerId))
      .map(({ id }) => id),
  );

  return selections.map((selection) =>
    affectedAreaIds.has(selection.areaId) ? { ...selection, mode } : selection,
  );
}

export type ReviewMode = z.infer<typeof ReviewModeSchema>;
export type TaxonomyCategory = z.infer<typeof TaxonomyCategorySchema>;
export type TaxonomyArea = z.infer<typeof TaxonomyAreaSchema>;
export type TaxonomyConfig = z.infer<typeof TaxonomyConfigSchema>;
export type ReviewAreaSelection = z.infer<typeof ReviewAreaSelectionSchema>;
export type ReviewAreaSnapshot = z.infer<typeof ReviewAreaSnapshotSchema>;
