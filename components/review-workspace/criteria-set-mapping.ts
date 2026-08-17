import type { CriteriaSetCriterion, Criterion } from "./types";

export function criteriaToSetTemplate(criteria: Criterion[]): CriteriaSetCriterion[] {
  return criteria.map((criterion) => ({
    title: criterion.title.trim(),
    statement: criterion.statement.trim(),
    assessorNote: criterion.assessorNote?.trim() || null,
    judgementStatements: criterion.judgementStatements.map((statement) => ({
      label: statement.label.trim(),
      description: statement.description.trim(),
    })),
  }));
}

export function instantiateCriteriaSet(criteria: CriteriaSetCriterion[]): Criterion[] {
  return criteria.map((criterion, order) => ({
    id: `criterion-${crypto.randomUUID()}`,
    title: criterion.title,
    statement: criterion.statement,
    assessorNote: criterion.assessorNote ?? "",
    order,
    judgementStatements: criterion.judgementStatements.map((statement, statementOrder) => ({
      id: `statement-${crypto.randomUUID()}`,
      label: statement.label,
      description: statement.description,
      order: statementOrder,
    })),
  }));
}
