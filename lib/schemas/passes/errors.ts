export interface ReferenceIssue {
  path: string;
  message: string;
  reference?: string;
}

export class ReferenceValidationError extends Error {
  readonly issues: readonly ReferenceIssue[];

  constructor(issues: readonly ReferenceIssue[]) {
    super(issues.map(({ path, message }) => `${path}: ${message}`).join("; "));
    this.name = "ReferenceValidationError";
    this.issues = issues;
  }
}
