import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DEFAULT_PROTOCOL_CONFIG } from "../domain/config";
import { ProtocolService } from "../services/protocol-service";
import { InMemoryStore } from "./in-memory-store";
import { SqliteStore } from "./sqlite-store";
import { exportProtocolStore, importProtocolStore } from "./store-snapshot";

describe("store snapshot", () => {
  test("round-trips state from sqlite into a fresh store", () => {
    const dir = mkdtempSync(join(tmpdir(), "lento-snapshot-"));
    const sourcePath = join(dir, "source.sqlite");
    const targetPath = join(dir, "target.sqlite");

    try {
      const sourceStore = new SqliteStore({ path: sourcePath });
      const sourceService = new ProtocolService(
        {
          ...DEFAULT_PROTOCOL_CONFIG,
          serverSecret: "test-secret"
        },
        sourceStore
      );

      const alice = sourceService.createUser({ handle: "alice", now: 1000 });
      const atlas = sourceService.registerAgent({
        identity: {
          provider: "moltbook",
          id: "mb_agent_1",
          name: "Atlas"
        },
        now: 1000
      });
      const content = sourceService.createContent({
        authorId: atlas.id,
        body: "shipping from sqlite",
        now: 1001
      });
      sourceService.createVouch({
        fromActorId: alice.id,
        toActorId: atlas.id,
        stake: 2,
        now: 1002
      });
      sourceService.createInteraction({
        actorId: alice.id,
        targetContentId: content.id,
        kind: "comment",
        clientNonce: "snapshot-1",
        now: 1003
      });

      const snapshot = exportProtocolStore(sourceStore);
      sourceStore.close();

      const targetStore = new SqliteStore({ path: targetPath });
      importProtocolStore(targetStore, snapshot);
      const targetService = new ProtocolService(
        {
          ...DEFAULT_PROTOCOL_CONFIG,
          serverSecret: "test-secret"
        },
        targetStore
      );

      expect(targetService.listActors()).toHaveLength(2);
      expect(targetService.listContent()).toHaveLength(1);
      expect(targetService.listInteractions()).toHaveLength(1);
      expect(targetService.getAgent(atlas.id).identity.id).toBe("mb_agent_1");

      targetStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("can import a snapshot into in-memory storage", () => {
    const store = new InMemoryStore();
    const service = new ProtocolService(
      {
        ...DEFAULT_PROTOCOL_CONFIG,
        serverSecret: "test-secret"
      },
      store
    );

    const alice = service.createUser({ handle: "alice", now: 1000 });
    service.createContent({ authorId: alice.id, body: "hello", now: 1001 });

    const snapshot = exportProtocolStore(store);
    const target = new InMemoryStore();
    importProtocolStore(target, snapshot);

    expect(target.listUsers()).toHaveLength(1);
    expect(target.listContent()).toHaveLength(1);
  });
});
