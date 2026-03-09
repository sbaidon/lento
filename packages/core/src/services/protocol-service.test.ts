import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DEFAULT_PROTOCOL_CONFIG } from "../domain/config";
import { ProtocolError } from "../domain/errors";
import { InMemoryStore } from "../infra/in-memory-store";
import { SqliteStore } from "../infra/sqlite-store";
import type { ProtocolStore } from "../infra/protocol-store";
import { ProtocolService } from "./protocol-service";

interface StoreHarness {
  name: string;
  createStore(): ProtocolStore;
}

const harnesses: StoreHarness[] = [
  {
    name: "in-memory",
    createStore: () => new InMemoryStore()
  },
  {
    name: "sqlite",
    createStore: () => {
      const dir = mkdtempSync(join(tmpdir(), "lento-sqlite-"));
      const path = join(dir, "lento.sqlite");
      const store = new SqliteStore({ path });
      const originalClose = store.close.bind(store);
      store.close = () => {
        originalClose();
        rmSync(dir, { recursive: true, force: true });
      };
      return store;
    }
  }
];

for (const harness of harnesses) {
  describe(`ProtocolService (${harness.name})`, () => {
    function createService(): { service: ProtocolService; close(): void } {
      const store = harness.createStore();
      return {
        service: new ProtocolService(
          {
            ...DEFAULT_PROTOCOL_CONFIG,
            serverSecret: "test-secret",
            pulseWindowMs: 60_000
          },
          store
        ),
        close: () => store.close?.()
      };
    }

    test("vouching updates recipient trust and records vouch stats", () => {
      const { service, close } = createService();
      try {
        const now = 1000;

        const alice = service.createUser({ handle: "alice", now });
        const bob = service.createUser({ handle: "bob", now });

        const trustBefore = service.getUser(bob.id, now).trustScore;
        const result = service.createVouch({
          fromActorId: alice.id,
          toActorId: bob.id,
          stake: 3,
          now
        });
        const trustAfter = service.getUser(bob.id, now).trustScore;

        expect(result.trustScore).toBe(trustAfter);
        expect(trustAfter).not.toBe(trustBefore);
        expect(service.getUser(bob.id, now).stats.vouchesReceived).toBe(1);
        expect(service.getUser(alice.id, now).stats.vouchesGiven).toBe(1);
      } finally {
        close();
      }
    });

    test("interaction consumes energy", () => {
      const { service, close } = createService();
      try {
        const now = 1000;

        const alice = service.createUser({ handle: "alice", now });
        const bob = service.createUser({ handle: "bob", now });
        const content = service.createContent({ authorId: bob.id, body: "hello world", now });

        const before = service.getUser(alice.id, now).energy.current;
        const interaction = service.createInteraction({
          actorId: alice.id,
          targetContentId: content.id,
          kind: "comment",
          clientNonce: "nonce-1",
          now
        });
        const after = service.getUser(alice.id, now).energy.current;

        expect(after).toBe(before - interaction.appliedCost);
      } finally {
        close();
      }
    });

    test("insufficient energy blocks interactions", () => {
      const { service, close } = createService();
      try {
        const now = 1000;

        const alice = service.createUser({ handle: "alice", now });
        const bob = service.createUser({ handle: "bob", now });
        const content = service.createContent({ authorId: bob.id, body: "hello world", now });

        let thrown: unknown;
        for (let i = 0; i < 200; i += 1) {
          try {
            service.createInteraction({
              actorId: alice.id,
              targetContentId: content.id,
              kind: "share",
              clientNonce: `nonce-${i}`,
              now
            });
          } catch (error) {
            thrown = error;
            break;
          }
        }

        expect(thrown).toBeInstanceOf(ProtocolError);
        expect((thrown as ProtocolError).code).toBe("insufficient_energy");
      } finally {
        close();
      }
    });

    test("duplicate vouch is rejected", () => {
      const { service, close } = createService();
      try {
        const now = 1000;

        const alice = service.createUser({ handle: "alice", now });
        const bob = service.createUser({ handle: "bob", now });

        service.createVouch({ fromActorId: alice.id, toActorId: bob.id, stake: 1, now });

        expect(() => {
          service.createVouch({ fromActorId: alice.id, toActorId: bob.id, stake: 2, now });
        }).toThrow("Vouch already exists");
      } finally {
        close();
      }
    });

    test("registers and resolves a first-class agent actor", () => {
      const { service, close } = createService();
      try {
        const now = 1000;

        const agent = service.registerAgent({
          identity: {
            provider: "moltbook",
            id: "mb_agent_1",
            name: "Atlas Builder"
          },
          now
        });

        expect(agent.kind).toBe("agent");
        expect(agent.handle).toContain("atlas_builder");
        expect(service.getAgent(agent.id, now).identity.id).toBe("mb_agent_1");
        expect(
          service.findAgentByIdentity({
            provider: "moltbook",
            id: "mb_agent_1",
            name: "Atlas Builder"
          })
        ).toMatchObject({ id: agent.id });
      } finally {
        close();
      }
    });
  });
}
