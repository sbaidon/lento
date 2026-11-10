import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { backupDatabase } from "./backup";

describe("backupDatabase", () => {
  test("writes a readable copy and keeps only the newest N", () => {
    const dir = mkdtempSync(join(tmpdir(), "lento-backup-"));
    const databasePath = join(dir, "lento.sqlite");
    const backupDir = join(dir, "backups");

    try {
      const db = new Database(databasePath, { create: true });
      db.exec("create table notes (body text); insert into notes values ('slow');");
      db.close();

      const run = (iso: string) =>
        backupDatabase({ databasePath, backupDir, keep: 2, now: new Date(iso) });
      run("2026-11-01T00:00:00Z");
      run("2026-11-02T00:00:00Z");
      const third = run("2026-11-03T00:00:00Z");

      expect(third.removed).toEqual(["lento-20261101T000000Z.sqlite"]);
      expect(readdirSync(backupDir).sort()).toEqual([
        "lento-20261102T000000Z.sqlite",
        "lento-20261103T000000Z.sqlite"
      ]);

      const copy = new Database(third.path, { readonly: true });
      expect(copy.query<{ body: string }, []>("select body from notes").get()?.body).toBe("slow");
      copy.close();

      expect(() =>
        backupDatabase({ databasePath: join(dir, "missing.sqlite"), backupDir, keep: 2 })
      ).toThrow("Database not found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
