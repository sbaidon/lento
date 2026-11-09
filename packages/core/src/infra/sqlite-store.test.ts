import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { DEFAULT_PROTOCOL_CONFIG } from "../domain/config";
import { ProtocolService } from "../services/protocol-service";
import { SqliteStore } from "./sqlite-store";

describe("SqliteStore", () => {
  test("upgrades a pre-sponsorship database in place and persists sponsor fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "lento-sqlite-migrate-"));
    const path = join(dir, "lento.sqlite");

    try {
      // The actors table as it shipped before sponsor_id and disabled_at existed.
      const legacy = new Database(path, { create: true });
      legacy.exec(`
        create table actors (
          id text primary key,
          kind text not null check (kind in ('user', 'agent')),
          handle text not null unique,
          trust_score real not null,
          created_at integer not null,
          energy_current real not null,
          energy_max real not null,
          energy_regen_per_hour real not null,
          energy_updated_at integer not null,
          stats_interactions integer not null,
          stats_abuse_reports integer not null,
          stats_vouches_given integer not null,
          stats_vouches_received integer not null,
          verified_at integer
        );
        insert into actors values ('usr_old', 'user', 'old_timer', 0.5, 1, 100, 100, 5, 1, 0, 0, 0, 0, null);
      `);
      legacy.close();

      const store = new SqliteStore({ path });
      const service = new ProtocolService(DEFAULT_PROTOCOL_CONFIG, store);
      expect(service.getUser("usr_old").handle).toBe("old_timer");

      const agent = service.createSponsoredAgent({ sponsorId: "usr_old", handle: "helper" });
      service.disableAgent({ sponsorId: "usr_old", agentId: agent.id, now: 42 });
      store.close();

      const reopened = new SqliteStore({ path });
      const loaded = reopened.getAgent(agent.id);
      expect(loaded?.sponsorId).toBe("usr_old");
      expect(loaded?.disabledAt).toBe(42);
      expect(reopened.listAgents()[0]?.sponsorId).toBe("usr_old");
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
