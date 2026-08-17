import { resolve } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type { AppDatabase, DatabaseHandle } from "./client";

export const DEFAULT_MIGRATIONS_FOLDER = resolve(process.cwd(), "lib/db/migrations");

export function migrateDatabase(
  database: AppDatabase | DatabaseHandle,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
): void {
  const db = "db" in database ? database.db : database;
  migrate(db, { migrationsFolder });
}
