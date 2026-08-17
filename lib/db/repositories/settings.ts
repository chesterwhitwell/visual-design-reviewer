import { asc, eq } from "drizzle-orm";

import type { AppDatabase } from "../client";
import { appSettings, taxonomyPresets, type JsonSnapshot } from "../schema";
import { RecordNotFoundError } from "./errors";
import {
  type Clock,
  type IdFactory,
  type RepositoryDependencies,
  systemClock,
  systemIdFactory,
} from "./shared";

export interface TaxonomyPresetInput {
  id?: string;
  name: string;
  taxonomyVersion: string;
  selections: JsonSnapshot;
}

export type TaxonomyPresetRow = typeof taxonomyPresets.$inferSelect;
export type AppSettingRow = typeof appSettings.$inferSelect;

export class SettingsRepository {
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;

  constructor(
    private readonly db: AppDatabase,
    dependencies: RepositoryDependencies = {},
  ) {
    this.clock = dependencies.clock ?? systemClock;
    this.idFactory = dependencies.idFactory ?? systemIdFactory;
  }

  get<T = unknown>(key: string): T | null {
    const row = this.db.select().from(appSettings).where(eq(appSettings.key, key)).get();
    return row ? (row.value as T) : null;
  }

  list(): AppSettingRow[] {
    return this.db.select().from(appSettings).orderBy(asc(appSettings.key)).all();
  }

  set<T>(key: string, value: T): T {
    this.db
      .insert(appSettings)
      .values({ key, value, updatedAt: this.clock() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: this.clock() },
      })
      .run();
    return value;
  }

  delete(key: string): boolean {
    return this.db.delete(appSettings).where(eq(appSettings.key, key)).run().changes > 0;
  }

  createPreset(input: TaxonomyPresetInput): TaxonomyPresetRow {
    const timestamp = this.clock();
    return this.db
      .insert(taxonomyPresets)
      .values({
        id: input.id ?? this.idFactory(),
        name: input.name,
        taxonomyVersion: input.taxonomyVersion,
        selections: input.selections,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()
      .get();
  }

  getPreset(presetId: string): TaxonomyPresetRow | null {
    return (
      this.db.select().from(taxonomyPresets).where(eq(taxonomyPresets.id, presetId)).get() ??
      null
    );
  }

  listPresets(): TaxonomyPresetRow[] {
    return this.db.select().from(taxonomyPresets).orderBy(asc(taxonomyPresets.name)).all();
  }

  updatePreset(presetId: string, input: Omit<TaxonomyPresetInput, "id">): TaxonomyPresetRow {
    const updated = this.db
      .update(taxonomyPresets)
      .set({
        name: input.name,
        taxonomyVersion: input.taxonomyVersion,
        selections: input.selections,
        updatedAt: this.clock(),
      })
      .where(eq(taxonomyPresets.id, presetId))
      .returning()
      .get();
    if (!updated) throw new RecordNotFoundError(`Taxonomy preset ${presetId} was not found`);
    return updated;
  }

  deletePreset(presetId: string): boolean {
    return this.db.delete(taxonomyPresets).where(eq(taxonomyPresets.id, presetId)).run()
      .changes > 0;
  }
}
