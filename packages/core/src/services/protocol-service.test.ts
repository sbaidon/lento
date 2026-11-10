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

    test("sponsored agents spend their sponsor's energy and cannot vouch or report", () => {
      const { service, close } = createService();
      try {
        const now = 1000;
        const sponsor = service.createUser({ handle: "sponsor", now });
        const author = service.createUser({ handle: "author", now });
        const post = service.createContent({ authorId: author.id, body: "hello", now });
        const agent = service.createSponsoredAgent({
          sponsorId: sponsor.id,
          handle: "helper",
          now
        });

        expect(agent.sponsorId).toBe(sponsor.id);
        expect(agent.identity).toEqual({ provider: "lento", id: agent.id, name: "helper" });
        expect(service.listSponsoredAgents(sponsor.id).map((item) => item.id)).toEqual([agent.id]);

        const interaction = service.createInteraction({
          actorId: agent.id,
          targetContentId: post.id,
          kind: "react",
          clientNonce: "n1",
          now
        });
        service.createContent({ authorId: agent.id, body: "agent post", now });

        const expected =
          sponsor.energy.current - interaction.appliedCost - DEFAULT_PROTOCOL_CONFIG.agentPostCost;
        expect(service.getUser(sponsor.id, now).energy.current).toBeCloseTo(expected, 6);
        // The agent's own budget is untouched: the human pays.
        expect(service.getAgent(agent.id, now).energy.current).toBe(agent.energy.current);

        expect(() => service.createVouch({ fromActorId: agent.id, toActorId: author.id })).toThrow(
          "Sponsored agents cannot vouch."
        );
        expect(() =>
          service.createAbuseReport({
            reporterActorId: agent.id,
            targetActorId: author.id,
            severity: 2
          })
        ).toThrow("Sponsored agents cannot file abuse reports.");
      } finally {
        close();
      }
    });

    test("sponsor shares liability, is capped, and can disable an agent", () => {
      const { service, close } = createService();
      try {
        const now = 1000;
        const sponsor = service.createUser({ handle: "sponsor", now });
        const other = service.createUser({ handle: "other", now });
        const agents = [1, 2, 3].map((index) =>
          service.createSponsoredAgent({ sponsorId: sponsor.id, handle: `bot_${index}`, now })
        );

        expect(() =>
          service.createSponsoredAgent({ sponsorId: sponsor.id, handle: "bot_4", now })
        ).toThrow("at most 3 active agents");
        expect(() =>
          service.createSponsoredAgent({ sponsorId: agents[0]!.id, handle: "nested", now })
        ).toThrow("Only human users can sponsor agents.");

        service.createAbuseReport({
          reporterActorId: other.id,
          targetActorId: agents[0]!.id,
          severity: 5,
          now
        });
        expect(service.getUser(sponsor.id, now).trustScore).toBeLessThan(sponsor.trustScore);

        expect(() => service.disableAgent({ sponsorId: other.id, agentId: agents[0]!.id })).toThrow(
          "Only the sponsor"
        );
        const disabled = service.disableAgent({
          sponsorId: sponsor.id,
          agentId: agents[0]!.id,
          now
        });
        expect(disabled.disabledAt).toBe(now);
        expect(service.getAgent(agents[0]!.id, now).disabledAt).toBe(now);
        expect(() =>
          service.createContent({ authorId: agents[0]!.id, body: "still here?", now })
        ).toThrow("has been disabled");

        // Disabling frees a slot, and does not wash away the sponsor's liability.
        const trustAfterDisable = service.getUser(sponsor.id, now).trustScore;
        service.createSponsoredAgent({ sponsorId: sponsor.id, handle: "bot_4", now });
        service.createVouch({ fromActorId: other.id, toActorId: sponsor.id, stake: 1, now });
        const clean = service.createUser({ handle: "clean", now });
        service.createVouch({ fromActorId: other.id, toActorId: clean.id, stake: 1, now });
        expect(trustAfterDisable).toBeLessThan(sponsor.trustScore);
        expect(service.getUser(sponsor.id, now).trustScore).toBeLessThan(
          service.getUser(clean.id, now).trustScore
        );
      } finally {
        close();
      }
    });

    test("a rejected operation leaves no trace in the store", () => {
      const store = harness.createStore();
      const service = new ProtocolService(DEFAULT_PROTOCOL_CONFIG, store);
      try {
        const alice = service.createUser({ handle: "alice", now: 1000 });
        const before = JSON.stringify(store.getUser(alice.id));

        // createContent refreshes and saves the author before validating the body.
        expect(() =>
          service.createContent({ authorId: alice.id, body: "   ", now: 9_000_000 })
        ).toThrow("Content body cannot be empty.");

        expect(JSON.stringify(store.getUser(alice.id))).toBe(before);
        expect(store.countContent()).toBe(0);
      } finally {
        store.close?.();
      }
    });

    test("reports count once per reporter and weigh by the reporter's trust", () => {
      const { service, close } = createService();
      try {
        const now = 1000;
        const target = service.createUser({ handle: "target", now });
        const twin = service.createUser({ handle: "twin", now });
        const reporter = service.createUser({ handle: "reporter", now });
        const voucher = service.createUser({ handle: "voucher", now });
        const lowly = service.createUser({ handle: "lowly", now });
        const flagger = service.createUser({ handle: "flagger", now });

        const first = service.createAbuseReport({
          reporterActorId: reporter.id,
          targetActorId: target.id,
          severity: 5,
          now
        });
        expect(first.trustScore).toBeLessThan(target.trustScore);

        expect(() =>
          service.createAbuseReport({
            reporterActorId: reporter.id,
            targetActorId: target.id,
            severity: 5,
            now
          })
        ).toThrow("already reported");
        expect(service.getUser(target.id, now).trustScore).toBe(first.trustScore);
        expect(service.getUser(target.id, now).stats.abuseReports).toBe(1);

        expect(() =>
          service.createAbuseReport({
            reporterActorId: reporter.id,
            targetActorId: reporter.id,
            severity: 1,
            now
          })
        ).toThrow("cannot report yourself");

        // Knock `lowly` down, then compare a report from them with one from an
        // account in good standing against two identical targets.
        service.createAbuseReport({
          reporterActorId: flagger.id,
          targetActorId: lowly.id,
          severity: 5,
          now
        });
        expect(service.getUser(lowly.id, now).trustScore).toBeLessThan(voucher.trustScore);

        const a = service.createUser({ handle: "target_a", now });
        const b = service.createUser({ handle: "target_b", now });
        const byTrusted = service.createAbuseReport({
          reporterActorId: twin.id,
          targetActorId: a.id,
          severity: 5,
          now
        });
        const byLowly = service.createAbuseReport({
          reporterActorId: lowly.id,
          targetActorId: b.id,
          severity: 5,
          now
        });
        expect(byLowly.trustScore).toBeGreaterThan(byTrusted.trustScore);
      } finally {
        close();
      }
    });

    test("a vouch is worth the voucher's credibility and never lowers trust", () => {
      const { service, close } = createService();
      try {
        const now = 1000;

        const fresh = service.createUser({ handle: "fresh", now });
        const seed = service.createUser({ handle: "seed", now });
        const bob = service.createUser({ handle: "bob", now });
        const carol = service.createUser({ handle: "carol", now });
        const dave = service.createUser({ handle: "dave", now });

        // A fresh account has no credibility yet: its vouch records, but moves nothing.
        const fromFresh = service.createVouch({
          fromActorId: fresh.id,
          toActorId: bob.id,
          stake: 5,
          now
        });
        expect(fromFresh.trustScore).toBe(bob.trustScore);
        expect(service.getUser(bob.id, now).stats.vouchesReceived).toBe(1);
        expect(service.getUser(fresh.id, now).stats.vouchesGiven).toBe(1);

        // A genesis account's vouch lifts the recipient.
        expect(service.grantGenesis(seed.id, now).trustScore).toBe(0.9);
        const fromSeed = service.createVouch({
          fromActorId: seed.id,
          toActorId: carol.id,
          stake: 5,
          now
        });
        expect(fromSeed.trustScore).toBeCloseTo(0.58, 6);

        // Trust attenuates with distance from the seed.
        const secondHand = service.createVouch({
          fromActorId: carol.id,
          toActorId: dave.id,
          stake: 5,
          now
        });
        expect(secondHand.trustScore).toBeGreaterThan(dave.trustScore);
        expect(secondHand.trustScore).toBeLessThan(fromSeed.trustScore);

        // A vouch given before the voucher had standing gains worth once they earn it.
        service.createVouch({ fromActorId: seed.id, toActorId: fresh.id, stake: 5, now });
        expect(service.getUser(bob.id, now).trustScore).toBeGreaterThan(bob.trustScore);

        expect(() => service.grantGenesis("usr_missing", now)).toThrow("does not exist");
      } finally {
        close();
      }
    });

    test("trust is derived: the same signals give the same score in any order", () => {
      const build = (order: "report-first" | "vouch-first") => {
        const { service, close } = createService();
        try {
          const now = 1000;
          const seed = service.createUser({ handle: "seed", now });
          const target = service.createUser({ handle: "target", now });
          const reporter = service.createUser({ handle: "reporter", now });
          service.grantGenesis(seed.id, now);
          const vouch = () =>
            service.createVouch({ fromActorId: seed.id, toActorId: target.id, stake: 3, now });
          const report = () =>
            service.createAbuseReport({
              reporterActorId: reporter.id,
              targetActorId: target.id,
              severity: 2,
              now
            });
          if (order === "report-first") {
            report();
            vouch();
          } else {
            vouch();
            report();
          }
          return service.getUser(target.id, now).trustScore;
        } finally {
          close();
        }
      };

      expect(build("report-first")).toBe(build("vouch-first"));
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
