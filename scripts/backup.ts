/**
 * Writes a consistent copy of the Lento SQLite database and prunes old copies.
 *
 *   bun run scripts/backup.ts [--keep 14]
 *
 * Reads LENTO_DATABASE_PATH. Copies go to LENTO_BACKUP_DIR, or a `backups`
 * folder next to the database. Safe to run while the server is up: `VACUUM
 * INTO` takes a read transaction and produces a complete, compacted file.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const BACKUP_PATTERN = /^lento-\d{8}T\d{6}Z\.sqlite$/;

export function backupDatabase(options: {
  databasePath: string;
  backupDir: string;
  keep: number;
  now?: Date;
}): { path: string; removed: string[] } {
  if (!existsSync(options.databasePath)) {
    throw new Error(`Database not found at '${options.databasePath}'.`);
  }
  if (!Number.isInteger(options.keep) || options.keep < 1) {
    throw new Error("--keep must be a positive integer.");
  }

  mkdirSync(options.backupDir, { recursive: true });
  const stamp = (options.now ?? new Date())
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const path = join(options.backupDir, `lento-${stamp}.sqlite`);

  const db = new Database(options.databasePath, { readonly: true });
  try {
    db.query("vacuum into ?1").run(path);
  } finally {
    db.close();
  }

  // Verify the copy opens and passes SQLite's own integrity check before trusting it.
  const copy = new Database(path, { readonly: true });
  try {
    const result = copy.query<{ integrity_check: string }, []>("pragma integrity_check").get();
    if (result?.integrity_check !== "ok") {
      throw new Error(`Backup failed integrity check: ${result?.integrity_check ?? "no result"}`);
    }
  } finally {
    copy.close();
  }

  const backups = readdirSync(options.backupDir)
    .filter((name) => BACKUP_PATTERN.test(name))
    .sort();
  const removed = backups.slice(0, Math.max(0, backups.length - options.keep));
  for (const name of removed) {
    rmSync(join(options.backupDir, name));
  }

  return { path, removed };
}

if (import.meta.main) {
  const databasePath = Bun.env.LENTO_DATABASE_PATH;
  if (!databasePath) {
    console.error("LENTO_DATABASE_PATH is not set.");
    process.exit(1);
  }

  const keepFlag = Bun.argv.indexOf("--keep");
  const keep = keepFlag >= 0 ? Number(Bun.argv[keepFlag + 1]) : 14;

  try {
    const result = backupDatabase({
      databasePath,
      backupDir: Bun.env.LENTO_BACKUP_DIR ?? join(dirname(databasePath), "backups"),
      keep
    });
    console.log(
      JSON.stringify({ level: "info", msg: "backup", path: result.path, removed: result.removed })
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
