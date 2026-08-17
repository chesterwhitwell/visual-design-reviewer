import "server-only";

import { z } from "zod";

import {
  ApplicationIdSchema,
  CRITERIA_SET_FORMAT,
  CRITERIA_SET_SCHEMA_VERSION,
  CriteriaSetCriteriaSchema,
  CriteriaSetDocumentV1Schema,
  CriteriaSetSchema,
  CriteriaSetSummarySchema,
  type CriteriaSet,
  type CriteriaSetDocumentV1,
  type CriteriaSetSummary,
} from "@/lib/domain";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { createRepositories, type CriteriaSetRecord } from "@/lib/db";
import { AppError } from "@/lib/http/errors";

const criteriaSetMutationSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(1_000).nullable(),
    criteria: CriteriaSetCriteriaSchema,
  })
  .strict();

export function listCriteriaSets(): CriteriaSetSummary[] {
  return createRepositories().criteriaSets.list().map(toSummary);
}

export function getCriteriaSet(criteriaSetIdInput: string): CriteriaSet {
  const criteriaSetId = ApplicationIdSchema.parse(criteriaSetIdInput);
  const row = createRepositories().criteriaSets.getById(criteriaSetId);
  if (!row) throw new AppError("not_found", "The criteria set was not found.");
  return toCriteriaSet(row);
}

export function createCriteriaSet(input: unknown): CriteriaSet {
  const values = parseMutation(input);
  const row = createRepositories().criteriaSets.create({
    name: values.name,
    description: values.description,
    schemaVersion: CRITERIA_SET_SCHEMA_VERSION,
    criteria: values.criteria,
  });
  return toCriteriaSet(row);
}

export function updateCriteriaSet(criteriaSetIdInput: string, input: unknown): CriteriaSet {
  const criteriaSetId = ApplicationIdSchema.parse(criteriaSetIdInput);
  const values = parseMutation(input);
  return toCriteriaSet(
    createRepositories().criteriaSets.update(criteriaSetId, {
      name: values.name,
      description: values.description,
      schemaVersion: CRITERIA_SET_SCHEMA_VERSION,
      criteria: values.criteria,
    }),
  );
}

export function deleteCriteriaSet(criteriaSetIdInput: string): void {
  const criteriaSetId = ApplicationIdSchema.parse(criteriaSetIdInput);
  if (!createRepositories().criteriaSets.delete(criteriaSetId)) {
    throw new AppError("not_found", "The criteria set was not found.");
  }
}

export function importCriteriaSet(input: unknown): CriteriaSet {
  assertSupportedDocument(input);
  const document = CriteriaSetDocumentV1Schema.parse(input);
  return createCriteriaSet({
    name: document.name,
    description: document.description,
    criteria: document.criteria,
  });
}

export function replaceCriteriaSetFromImport(
  criteriaSetId: string,
  input: unknown,
): CriteriaSet {
  assertSupportedDocument(input);
  const document = CriteriaSetDocumentV1Schema.parse(input);
  return updateCriteriaSet(criteriaSetId, {
    name: document.name,
    description: document.description,
    criteria: document.criteria,
  });
}

export function prepareCriteriaSetExport(criteriaSetId: string): {
  document: CriteriaSetDocumentV1;
  filename: string;
} {
  const criteriaSet = getCriteriaSet(criteriaSetId);
  const document = CriteriaSetDocumentV1Schema.parse({
    format: CRITERIA_SET_FORMAT,
    schemaVersion: CRITERIA_SET_SCHEMA_VERSION,
    name: criteriaSet.name,
    description: criteriaSet.description,
    criteria: criteriaSet.criteria,
  });
  return {
    document,
    filename: `${safeFilenameStem(criteriaSet.name)}.criteria-set.json`,
  };
}

function parseMutation(input: unknown) {
  const values = criteriaSetMutationSchema.parse(input);
  const { limits } = getRuntimeConfig();
  if (values.criteria.length > limits.criteriaCount) {
    throw new AppError(
      "bad_request",
      `A criteria set can contain at most ${limits.criteriaCount} criteria.`,
    );
  }
  for (const criterion of values.criteria) {
    if (criterion.judgementStatements.length > limits.judgementsPerCriterion) {
      throw new AppError(
        "bad_request",
        `A criterion can contain at most ${limits.judgementsPerCriterion} judgement statements.`,
      );
    }
  }
  return values;
}

function assertSupportedDocument(input: unknown): void {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError("bad_request", "The imported criteria set must be a JSON object.");
  }
  const record = input as Record<string, unknown>;
  if (record.format !== CRITERIA_SET_FORMAT) {
    throw new AppError("bad_request", "This is not a Visual Design Reviewer criteria-set file.");
  }
  if (record.schemaVersion !== CRITERIA_SET_SCHEMA_VERSION) {
    throw new AppError(
      "bad_request",
      `Unsupported criteria-set schema version. Expected ${CRITERIA_SET_SCHEMA_VERSION}.`,
    );
  }
}

function toCriteriaSet(row: CriteriaSetRecord): CriteriaSet {
  return CriteriaSetSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    schemaVersion: row.schemaVersion,
    criteria: row.criteria,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toSummary(row: CriteriaSetRecord): CriteriaSetSummary {
  const criteriaSet = toCriteriaSet(row);
  return CriteriaSetSummarySchema.parse({
    id: criteriaSet.id,
    name: criteriaSet.name,
    description: criteriaSet.description,
    schemaVersion: criteriaSet.schemaVersion,
    criterionCount: criteriaSet.criteria.length,
    judgementStatementCount: criteriaSet.criteria.reduce(
      (total, criterion) => total + criterion.judgementStatements.length,
      0,
    ),
    createdAt: criteriaSet.createdAt,
    updatedAt: criteriaSet.updatedAt,
  });
}

function safeFilenameStem(value: string): string {
  const stem = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
  return stem || "assessment-criteria";
}
