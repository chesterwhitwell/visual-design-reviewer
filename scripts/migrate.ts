import { openDatabase } from "../lib/db/client";
import { migrateDatabase } from "../lib/db/migrate";

const handle = openDatabase();

try {
  migrateDatabase(handle);
  process.stdout.write(`Database migrations applied to ${handle.path}\n`);
} finally {
  handle.close();
}
