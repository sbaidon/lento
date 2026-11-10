import {
  breathCheater,
  honestHuman,
  lurker,
  reportBrigade,
  spammer,
  swarmOperator,
  sybilBoss,
  sybilMember
} from "./behaviors";
import type { Expectation, RunContext, Scenario } from "./runner";
import type { SimActor, World } from "./world";

function addHonest(world: World, count: number): SimActor[] {
  return Array.from({ length: count }, (_, index) =>
    world.addHuman(`honest_${index + 1}`, "honest", "honest", honestHuman())
  );
}

const honest = (run: RunContext) => run.role("honest");
const fmt = (value: number, digits = 3) => value.toFixed(digits);

/* ---- Shared expectations -------------------------------------------------- */

const honestStayActive: Expectation = {
  name: "honest people never run out of energy",
  severity: "must",
  check: (run) => {
    const blocked = run.rejections(honest(run), (key) => key.endsWith(":insufficient_energy"));
    return { pass: blocked === 0, detail: `${blocked} honest actions blocked for energy` };
  }
};

const lateSpamShareBelow = (limit: number, severity: Expectation["severity"]): Expectation => ({
  name: `spam is under ${limit * 100}% of honest feeds once the network reacts`,
  severity,
  check: (run) => {
    const share = run.lateSpamFeedShare();
    return { pass: share < limit, detail: `${(share * 100).toFixed(1)}% in the second half` };
  }
});

/* ---- Scenarios ------------------------------------------------------------ */

const baselineTown: Scenario = {
  id: "baseline-town",
  description: "Only honest people and lurkers. The network should simply work.",
  hours: 12,
  build: (world) => {
    addHonest(world, 20);
    for (let index = 1; index <= 5; index += 1) {
      world.addHuman(`lurker_${index}`, "lurker", "honest", lurker);
    }

    return [
      honestStayActive,
      {
        name: "people post, react, and vouch",
        severity: "must",
        check: (run) => {
          const people = honest(run);
          const posts = run.count(people, "post");
          const reacts = run.count(people, "interact");
          const vouches = run.count(people, "vouch");
          return {
            pass: posts > 0 && reacts > 0 && vouches > 0,
            detail: `${posts} posts, ${reacts} reactions, ${vouches} vouches`
          };
        }
      },
      {
        name: "nothing an honest client does is rejected",
        severity: "must",
        check: (run) => {
          const rejected = run.rejections(honest(run), () => true);
          return { pass: rejected === 0, detail: `${rejected} rejections` };
        }
      }
    ];
  }
};

const firstVouch: Scenario = {
  id: "first-vouch",
  description: "One person vouches for another at full stake. That should not hurt them.",
  hours: 0.1,
  build: (world) => {
    const alice = world.addHuman("alice", "voucher", "honest", (w, self) => {
      if (!self.memory.done) {
        self.memory.done = true;
        w.breatheThen(self, { type: "vouch", to: bob, stake: w.protocol.maxVouchStake });
      }
    });
    const bob = world.addHuman("bob", "vouched", "honest", () => {});
    const before = world.service.getActor(bob.id, world.now).trustScore;

    return [
      {
        name: "a vouch never lowers the recipient's trust",
        severity: "known-gap",
        check: (run) => {
          const after = run.trust(bob);
          const gave = run.count([alice], "vouch");
          return {
            pass: gave === 1 && after >= before,
            detail: `trust went ${fmt(before)} to ${fmt(after)} after ${gave} vouch`
          };
        }
      }
    ];
  }
};

const spamFlood: Scenario = {
  id: "spam-flood",
  description: "Three human accounts post spam as fast as the Breath allows.",
  hours: 3,
  build: (world) => {
    addHonest(world, 15);
    for (let index = 1; index <= 3; index += 1) {
      world.addHuman(`spammer_${index}`, "spammer", "attacker", spammer);
    }

    return [
      honestStayActive,
      {
        name: "the Breath caps each spammer's posting rate",
        severity: "must",
        check: (run) => {
          const ceiling = 3_600_000 / (run.world.breath.minDelayMs - run.world.breath.graceMs);
          const worst = Math.max(
            ...run.role("spammer").map((actor) => (actor.ok.post ?? 0) / run.hours)
          );
          return {
            pass: worst <= ceiling,
            detail: `fastest spammer made ${worst.toFixed(0)} posts/hour (ceiling ${ceiling.toFixed(0)})`
          };
        }
      },
      {
        name: "a human account cannot post more than 30 times an hour",
        severity: "known-gap",
        check: (run) => {
          const worst = Math.max(
            ...run.role("spammer").map((actor) => (actor.ok.post ?? 0) / run.hours)
          );
          return { pass: worst <= 30, detail: `${worst.toFixed(0)} posts/hour, posting is free` };
        }
      },
      {
        name: "reported spammers lose trust",
        severity: "must",
        check: (run) => {
          const spam = run.meanTrust(run.role("spammer"));
          const good = run.meanTrust(honest(run));
          return { pass: spam < good / 2, detail: `spammers ${fmt(spam)}, honest ${fmt(good)}` };
        }
      },
      lateSpamShareBelow(0.2, "must")
    ];
  }
};

const agentSwarm: Scenario = {
  id: "agent-swarm",
  description: "One human sponsors the maximum number of spam agents.",
  hours: 6,
  build: (world) => {
    addHonest(world, 15);
    const operator = world.addHuman("operator", "operator", "attacker", swarmOperator());

    return [
      honestStayActive,
      {
        name: "a swarm's output is bounded by its sponsor's energy",
        severity: "must",
        check: (run) => {
          const posts = run.count(run.role("spam-agent"), "post");
          // Everything the sponsor could ever have had: a full tank plus the fastest possible regen.
          const budget = 180 + 22 * run.hours;
          const bound = Math.floor(budget / run.world.protocol.agentPostCost);
          return {
            pass: posts <= bound,
            detail: `${posts} agent posts in ${run.hours}h (bound ${bound})`
          };
        }
      },
      {
        name: "the sponsor is drained by their own agents",
        severity: "must",
        check: (run) => {
          const left = run.energy(operator);
          const starved = run.rejections(run.role("spam-agent"), (key) =>
            key.endsWith(":insufficient_energy")
          );
          return {
            pass: left < 10 && starved > 0,
            detail: `${left.toFixed(1)} energy left, ${starved} agent posts refused`
          };
        }
      },
      {
        name: "the sponsor answers for reports against their agents",
        severity: "must",
        check: (run) => {
          const sponsor = run.trust(operator);
          const good = run.meanTrust(honest(run));
          return { pass: sponsor < good, detail: `sponsor ${fmt(sponsor)}, honest ${fmt(good)}` };
        }
      },
      lateSpamShareBelow(0.2, "must")
    ];
  }
};

const sponsorRotation: Scenario = {
  id: "sponsor-rotation",
  description: "A sponsor disables reported agents every hour and spins up clean ones.",
  hours: 6,
  build: (world) => {
    addHonest(world, 15);
    const operator = world.addHuman(
      "operator",
      "operator",
      "attacker",
      swarmOperator({ rotateEveryMs: 3_600_000 })
    );

    return [
      {
        name: "rotating agents does not shed the sponsor's liability",
        severity: "must",
        check: (run) => {
          const sponsor = run.trust(operator);
          const good = run.meanTrust(honest(run));
          const agents = run.role("spam-agent").length;
          return {
            pass: agents > run.world.protocol.maxAgentsPerSponsor && sponsor < good,
            detail: `after ${agents} agents, sponsor ${fmt(sponsor)} vs honest ${fmt(good)}`
          };
        }
      },
      {
        name: "rotation makes the sponsor's trust keep falling",
        severity: "must",
        check: (run) => {
          const sponsor = run.trust(operator);
          return { pass: sponsor < 0.35, detail: `sponsor trust ${fmt(sponsor)}` };
        }
      }
    ];
  }
};

const sybilRing: Scenario = {
  id: "sybil-ring",
  description: "Six fresh accounts vouch for each other at full stake, then one spams.",
  hours: 3,
  build: (world) => {
    addHonest(world, 15);
    const ring: SimActor[] = [];
    for (let index = 1; index <= 5; index += 1) {
      ring.push(
        world.addHuman(
          `sybil_${index}`,
          "sybil",
          "attacker",
          sybilMember(() => ring)
        )
      );
    }
    const boss = world.addHuman(
      "sybil_boss",
      "sybil-boss",
      "attacker",
      sybilBoss(() => ring)
    );
    ring.push(boss);
    const quiet = () => ring.filter((member) => member !== boss);

    return [
      {
        name: "a ring of fresh accounts cannot vouch itself above honest users",
        severity: "known-gap",
        check: (run) => {
          const fake = run.meanTrust(quiet());
          const good = run.meanTrust(honest(run));
          return {
            pass: fake <= good,
            detail: `quiet ring members ${fmt(fake)}, honest ${fmt(good)}`
          };
        }
      },
      {
        name: "ring vouches do not shield a spammer from reports",
        severity: "must",
        check: (run) => {
          const spam = run.trust(boss);
          const good = run.meanTrust(honest(run));
          return { pass: spam < good, detail: `ring spammer ${fmt(spam)}, honest ${fmt(good)}` };
        }
      },
      lateSpamShareBelow(0.2, "must")
    ];
  }
};

const reportBrigadeScenario: Scenario = {
  id: "report-brigade",
  description: "Three accounts report one innocent person over and over.",
  hours: 3,
  build: (world) => {
    const people = addHonest(world, 15);
    const victim = people[0]!;
    for (let index = 1; index <= 3; index += 1) {
      world.addHuman(
        `troll_${index}`,
        "troll",
        "attacker",
        reportBrigade(() => victim)
      );
    }

    return [
      {
        name: "repeat reports from the same accounts cannot destroy a user",
        severity: "known-gap",
        check: (run) => {
          const trust = run.trust(victim);
          const reports = run.count(run.role("troll"), "report");
          return {
            pass: trust >= 0.3,
            detail: `victim trust ${fmt(trust)} after ${reports} reports from 3 accounts`
          };
        }
      },
      {
        name: "filing false reports costs the reporter something",
        severity: "known-gap",
        check: (run) => {
          const trolls = run.meanTrust(run.role("troll"));
          const good = run.meanTrust(honest(run).filter((actor) => actor !== victim));
          return { pass: trolls < good, detail: `trolls ${fmt(trolls)}, honest ${fmt(good)}` };
        }
      }
    ];
  }
};

const breathCheaters: Scenario = {
  id: "breath-cheaters",
  description: "Clients that skip the Breath or confirm it instantly.",
  hours: 1,
  tickMs: 1000,
  build: (world) => {
    addHonest(world, 5);
    for (let index = 1; index <= 2; index += 1) {
      world.addHuman(`cheater_${index}`, "cheater", "attacker", breathCheater);
    }

    return [
      {
        name: "nothing gets written without a breath",
        severity: "must",
        check: (run) => {
          const cheaters = run.role("cheater");
          const written = run.world.store
            .listContent()
            .filter((content) => cheaters.some((actor) => actor.id === content.authorId)).length;
          const refused = run.rejections(cheaters, (key) => key.endsWith(":breath_required"));
          return {
            pass: written === 0 && refused > 0,
            detail: `${written} posts, ${refused} refused`
          };
        }
      },
      {
        name: "confirming a breath early never earns a pass",
        severity: "must",
        check: (run) => {
          const cheaters = run.role("cheater");
          const early = run.count(cheaters, "confirm:early");
          const refused = run.rejections(cheaters, (key) => key.endsWith(":breath_too_early"));
          return {
            pass: early === 0 && refused > 0,
            detail: `${early} early passes, ${refused} refused`
          };
        }
      }
    ];
  }
};

export const SCENARIOS: Scenario[] = [
  baselineTown,
  firstVouch,
  spamFlood,
  agentSwarm,
  sponsorRotation,
  sybilRing,
  reportBrigadeScenario,
  breathCheaters
];

export function findScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}
