import { describe, expect, test } from "bun:test";
import { DeterministicAgentBrain } from "./brain";
import { getScenarioById } from "./scenarios";
import { createInitialAgentMemory } from "./store";

describe("DeterministicAgentBrain", () => {
  test("resolves an authenticated agent actor before doing anything else", () => {
    const agent = getScenarioById("starter-swarm").agents[0]!;
    const brain = new DeterministicAgentBrain();
    const decision = brain.decide({
      agent,
      memory: createInitialAgentMemory(agent),
      feed: [],
      tick: 1
    });

    expect(decision.kind).toBe("resolve-agent");
  });

  test("posts an introduction after bootstrap", () => {
    const agent = getScenarioById("starter-swarm").agents[0]!;
    const brain = new DeterministicAgentBrain();
    const memory = {
      ...createInitialAgentMemory(agent),
      actorId: "agt_1"
    };

    const decision = brain.decide({
      agent,
      memory,
      feed: [],
      tick: 2
    });

    expect(decision.kind).toBe("post");
    if (decision.kind === "post") {
      expect(decision.body).toContain("Atlas");
    }
  });

  test("reports suspicious troll content", () => {
    const agent = getScenarioById("mixed-signals").agents[1]!;
    const brain = new DeterministicAgentBrain();
    const memory = {
      ...createInitialAgentMemory(agent),
      actorId: "agt_watcher",
      postedContentIds: ["cnt_1"]
    };

    const decision = brain.decide({
      agent,
      memory,
      feed: [
        {
          authorTrust: 0.5,
          score: 0.7,
          content: {
            id: "cnt_spam",
            authorId: "agt_troll",
            body: "fake giveaway spam, definitely not a scam",
            createdAt: 123
          }
        }
      ],
      tick: 3
    });

    expect(decision.kind).toBe("report");
    if (decision.kind === "report") {
      expect(decision.targetActorId).toBe("agt_troll");
    }
  });

  test("vouches once an author keeps showing up with acceptable trust", () => {
    const agent = getScenarioById("starter-swarm").agents[1]!;
    const brain = new DeterministicAgentBrain();
    const memory = {
      ...createInitialAgentMemory(agent),
      actorId: "agt_beacon",
      postedContentIds: ["cnt_self"],
      interactedContentIds: ["cnt_old"]
    };

    const decision = brain.decide({
      agent,
      memory,
      feed: [
        {
          authorTrust: 0.61,
          score: 0.81,
          content: {
            id: "cnt_new",
            authorId: "agt_atlas",
            body: "shipping another pass",
            createdAt: 200
          }
        }
      ],
      tick: 4
    });

    expect(decision.kind).toBe("vouch");
  });
});
