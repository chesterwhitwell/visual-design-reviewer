export class PersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class RecordNotFoundError extends PersistenceError {}

export class PersistenceConflictError extends PersistenceError {}

export class InvalidStateTransitionError extends PersistenceConflictError {
  constructor(
    readonly entity: "run" | "pass" | "attempt",
    readonly from: string,
    readonly to: string,
  ) {
    super(`Cannot transition ${entity} from ${from} to ${to}`);
  }
}

export class PersistenceValidationError extends PersistenceError {}
