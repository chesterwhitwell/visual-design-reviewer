import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { migrateDatabase } from "./migrate";
import * as schema from "./schema";

export interface OpenDatabaseOptions {
  path?: string;
  readonly?: boolean;
  fileMustExist?: boolean;
  timeoutMs?: number;
}

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  readonly db: AppDatabase;
  readonly sqlite: BetterSqlite3.Database;
  readonly path: string;
  close(): void;
}

const DEFAULT_DATABASE_PATH = "data/visual-design-reviewer.sqlite";

function resolveDatabasePath(path: string): string {
  if (path === ":memory:" || path.startsWith("file:")) {
    return path;
  }

  return resolve(path);
}

export function openDatabase(options: OpenDatabaseOptions = {}): DatabaseHandle {
  const databasePath = resolveDatabasePath(
    options.path ?? process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH,
  );

  if (!options.readonly && databasePath !== ":memory:" && !databasePath.startsWith("file:")) {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  }

  const sqlite = new BetterSqlite3(databasePath, {
    readonly: options.readonly ?? false,
    fileMustExist: options.fileMustExist ?? false,
    timeout: options.timeoutMs ?? 5_000,
  });

  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  if (!options.readonly) {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = NORMAL");
  }

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    path: databasePath,
    close: () => sqlite.close(),
  };
}

let singleton: DatabaseHandle | undefined;

export function getDatabaseHandle(): DatabaseHandle {
  if (!singleton) {
    const handle = openDatabase();
    try {
      migrateDatabase(handle);
      singleton = handle;
    } catch (error) {
      handle.close();
      throw error;
    }
  }
  return singleton;
}

export function getDatabase(): AppDatabase {
  return getDatabaseHandle().db;
}

export function closeDatabase(): void {
  singleton?.close();
  singleton = undefined;
}
