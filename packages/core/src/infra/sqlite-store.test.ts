import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DEFAULT_PROTOCOL_CONFIG } from "../domain/config";
import { ProtocolService } from "../services/protocol-service";
import { SqliteStore } from "./sqlite-store";

describe("SqliteStore", () => {
  test("persists protocol state across store reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "lento-sqlite-reopen-"));
    const path = join(dir, "lento.sqlite");

    try {
      const firstStore = new SqliteStore({ path });
      const firstService = new ProtocolService(
        {
          ...DEFAULT_PROTOCOL_CONFIG,
          serverSecret: "test-secret"
        },
        firstStore
      );

      const alice = firstService.createUser({ handle: "alice", now: 1000 });
      firstService.createContent({ authorId: alice.id, body: "hello from sqlite", now: 1001 });
      firstStore.close();

      const secondStore = new SqliteStore({ path });
      const secondService = new ProtocolService(
        {
          ...DEFAULT_PROTOCOL_CONFIG,
          serverSecret: "test-secret"
        },
        secondStore
      );

      expect(secondService.getUser(alice.id, 1001).handle).toBe("alice");
      expect(secondService.listContent()).toHaveLength(1);
      expect(secondService.listContent()[0]?.body).toBe("hello from sqlite");

      secondStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
