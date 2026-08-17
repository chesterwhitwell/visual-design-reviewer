import { asc, eq } from "drizzle-orm";

import type { AppDatabase } from "../client";
import { criteriaSets, type JsonSnapshot } from "../schema";
import { PersistenceConflictError, RecordNotFoundError } from "./errors";
import {
  type Clock,
  type IdFactory,
  type RepositoryDependencies,
  systemClock,
  systemIdFactory,
} from "./shared";

export interface CriteriaSetInput {
  id?: string;
  name: string;
  description: string | null;
  schemaVersion: string;
  criteria: JsonSnapshot;
}

export type CriteriaSetRecord = typeof criteriaSets.$inferSelect;

export class CriteriaSetRepository {
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;

  constructor(
    private readonly db: AppDatabase,
    dependencies: RepositoryDependencies = {},
  ) {
    this.clock = dependencies.clock ?? systemClock;
    this.idFactory = dependencies.idFactory ?? systemIdFactory;
  }

  create(input: CriteriaSetInput): CriteriaSetRecord {
    const normalizedName = normaliseName(input.name);
    this.assertNameAvailable(normalizedName);
    const timestamp = this.clock();
    try {
      return this.db
        .insert(criteriaSets)
        .values({
          id: input.id ?? this.idFactory(),
          name: input.name,
          normalizedName,
          description: input.description,
          schemaVersion: input.schemaVersion,
          criteria: input.criteria,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning()
        .get();
    } catch (error) {
      rethrowNameConflict(error);
    }
  }

  getById(id: string): CriteriaSetRecord | null {
    return this.db.select().from(criteriaSets).where(eq(criteriaSets.id, id)).get() ?? null;
  }

  list(): CriteriaSetRecord[] {
    return this.db.select().from(criteriaSets).orderBy(asc(criteriaSets.name)).all();
  }

  update(id: string, input: Omit<CriteriaSetInput, "id">): CriteriaSetRecord {
    const existing = this.getById(id);
    if (!existing) throw new RecordNotFoundError(`Criteria set ${id} was not found`);
    const normalizedName = normaliseName(input.name);
    this.assertNameAvailable(normalizedName, id);
    let updated: CriteriaSetRecord | undefined;
    try {
      updated = this.db
        .update(criteriaSets)
        .set({
          name: input.name,
          normalizedName,
          description: input.description,
          schemaVersion: input.schemaVersion,
          criteria: input.criteria,
          updatedAt: this.clock(),
        })
        .where(eq(criteriaSets.id, id))
        .returning()
        .get();
    } catch (error) {
      rethrowNameConflict(error);
    }
    if (!updated) throw new RecordNotFoundError(`Criteria set ${id} was not found`);
    return updated;
  }

  delete(id: string): boolean {
    return this.db.delete(criteriaSets).where(eq(criteriaSets.id, id)).run().changes > 0;
  }

  private assertNameAvailable(normalizedName: string, excludedId?: string): void {
    const existing = this.db
      .select({ id: criteriaSets.id })
      .from(criteriaSets)
      .where(eq(criteriaSets.normalizedName, normalizedName))
      .get();
    if (existing && existing.id !== excludedId) {
      throw new PersistenceConflictError("A criteria set with this name already exists.");
    }
  }
}

function normaliseName(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function rethrowNameConflict(error: unknown): never {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    String(error.code).startsWith("SQLITE_CONSTRAINT")
  ) {
    throw new PersistenceConflictError("A criteria set with this name already exists.", {
      cause: error,
    });
  }
  throw error;
}
