import { z } from "zod";

import {
  ApplicationIdSchema,
  IsoDateTimeSchema,
  NonNegativeOrderSchema,
  NonEmptyTextSchema,
  ShortTextSchema,
  addContiguousOrderIssues,
  addDuplicateIssues,
} from "./common";

export const JudgementStatementSchema = z
  .object({
    id: ApplicationIdSchema,
    label: ShortTextSchema,
    description: z.string().trim().min(1).max(4_000),
    order: NonNegativeOrderSchema,
  })
  .strict();

export const CriterionSchema = z
  .object({
    id: ApplicationIdSchema,
    title: ShortTextSchema,
    statement: z.string().trim().min(1).max(4_000),
    assessorNote: z.string().trim().min(1).max(4_000).optional(),
    judgementStatements: z.array(JudgementStatementSchema).max(20),
    order: NonNegativeOrderSchema,
  })
  .strict()
  .superRefine((criterion, context) => {
    addDuplicateIssues(
      criterion.judgementStatements.map(({ id }) => id),
      context,
      ["judgementStatements"],
      "judgement statement IDs",
    );
    addDuplicateIssues(
      criterion.judgementStatements.map(({ order }) => order),
      context,
      ["judgementStatements"],
      "judgement statement order",
    );
    addContiguousOrderIssues(
      criterion.judgementStatements.map(({ order }) => order),
      context,
      ["judgementStatements"],
      "judgement statement order",
    );
  });

export const CriteriaSnapshotSchema = z
  .array(CriterionSchema)
  .min(1)
  .max(50)
  .superRefine((criteria, context) => {
    addDuplicateIssues(
      criteria.map(({ id }) => id),
      context,
      [],
      "criterion IDs",
    );
    addDuplicateIssues(
      criteria.map(({ order }) => order),
      context,
      [],
      "criterion order",
    );
    addContiguousOrderIssues(
      criteria.map(({ order }) => order),
      context,
      [],
      "criterion order",
    );
  });

export const EditableCriterionSchema = z
  .object({
    title: ShortTextSchema,
    statement: NonEmptyTextSchema.max(4_000),
    assessorNote: z.string().trim().max(4_000).optional(),
    judgementStatements: z
      .array(
        z
          .object({
            label: ShortTextSchema,
            description: NonEmptyTextSchema.max(4_000),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

export const CRITERIA_SET_FORMAT = "visual-design-reviewer.criteria-set" as const;
export const CRITERIA_SET_SCHEMA_VERSION = "1.0.0" as const;

export const CriteriaSetJudgementStatementSchema = z
  .object({
    label: ShortTextSchema,
    description: NonEmptyTextSchema.max(4_000),
  })
  .strict();

export const CriteriaSetCriterionSchema = z
  .object({
    title: ShortTextSchema,
    statement: NonEmptyTextSchema.max(4_000),
    assessorNote: z.string().trim().min(1).max(4_000).nullable(),
    judgementStatements: z.array(CriteriaSetJudgementStatementSchema).max(20),
  })
  .strict();

export const CriteriaSetCriteriaSchema = z
  .array(CriteriaSetCriterionSchema)
  .min(1)
  .max(50);

export const CriteriaSetDocumentV1Schema = z
  .object({
    format: z.literal(CRITERIA_SET_FORMAT),
    schemaVersion: z.literal(CRITERIA_SET_SCHEMA_VERSION),
    name: ShortTextSchema,
    description: z.string().trim().min(1).max(1_000).nullable(),
    criteria: CriteriaSetCriteriaSchema,
  })
  .strict();

export const CriteriaSetSchema = z
  .object({
    id: ApplicationIdSchema,
    name: ShortTextSchema,
    description: z.string().trim().min(1).max(1_000).nullable(),
    schemaVersion: z.literal(CRITERIA_SET_SCHEMA_VERSION),
    criteria: CriteriaSetCriteriaSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const CriteriaSetSummarySchema = CriteriaSetSchema.omit({ criteria: true }).extend({
  criterionCount: z.number().int().positive().max(50),
  judgementStatementCount: z.number().int().nonnegative().max(1_000),
});

export type JudgementStatement = z.infer<typeof JudgementStatementSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;
export type CriteriaSnapshot = z.infer<typeof CriteriaSnapshotSchema>;
export type CriteriaSetCriterion = z.infer<typeof CriteriaSetCriterionSchema>;
export type CriteriaSetDocumentV1 = z.infer<typeof CriteriaSetDocumentV1Schema>;
export type CriteriaSet = z.infer<typeof CriteriaSetSchema>;
export type CriteriaSetSummary = z.infer<typeof CriteriaSetSummarySchema>;
