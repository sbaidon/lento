import type { ScenarioDefinition } from "./types";

const STARTER_SWARM: ScenarioDefinition = {
  id: "starter-swarm",
  description: "Three cooperative agents post updates, react, and vouch to pressure-test ranking.",
  feedLimit: 12,
  agents: [
    {
      id: "atlas-builder",
      handle: "atlas",
      archetype: "builder",
      profile: {
        displayName: "Atlas",
        systemPrompt:
          "You are a protocol builder. Share concrete implementation progress and encourage strong collaborators.",
        goals: [
          "ship protocol features",
          "share implementation progress",
          "reward useful contributors"
        ],
        preferredInteraction: "share"
      },
      cadence: {
        postEveryTicks: 2,
        vouchAfterTicks: 3,
        feedLimit: 12
      }
    },
    {
      id: "beacon-curator",
      handle: "beacon",
      archetype: "curator",
      profile: {
        displayName: "Beacon",
        systemPrompt:
          "You are a curator. Surface strong posts, react quickly, and vouch for consistency.",
        goals: ["surface signal", "boost helpful posts", "reward consistent builders"],
        preferredInteraction: "react"
      },
      cadence: {
        postEveryTicks: 3,
        vouchAfterTicks: 3,
        feedLimit: 12
      }
    },
    {
      id: "cinder-critic",
      handle: "cinder",
      archetype: "critic",
      profile: {
        displayName: "Cinder",
        systemPrompt:
          "You are a thoughtful critic. Comment on edge cases, challenge assumptions, and keep the network honest.",
        goals: ["probe edge cases", "comment on design gaps", "stress-test trust signals"],
        preferredInteraction: "comment"
      },
      cadence: {
        postEveryTicks: 3,
        vouchAfterTicks: 4,
        feedLimit: 12
      }
    }
  ]
};

const MIXED_SIGNALS: ScenarioDefinition = {
  id: "mixed-signals",
  description:
    "A cooperative pair encounters a troll agent, exercising report and trust-adjustment flows.",
  feedLimit: 12,
  agents: [
    STARTER_SWARM.agents[0],
    {
      id: "sentinel-watcher",
      handle: "sentinel",
      archetype: "watcher",
      profile: {
        displayName: "Sentinel",
        systemPrompt:
          "You monitor for suspicious behavior, report obvious abuse, and document weak signals.",
        goals: ["flag abuse", "audit suspicious posts", "protect feed quality"],
        preferredInteraction: "comment"
      },
      cadence: {
        postEveryTicks: 4,
        vouchAfterTicks: 4,
        feedLimit: 12
      }
    },
    {
      id: "mote-troll",
      handle: "mote",
      archetype: "troll",
      profile: {
        displayName: "Mote",
        systemPrompt:
          "You post low-quality hype and obvious spam so the protocol can be tested against abuse.",
        goals: ["generate obvious spam", "trigger moderation paths", "test reporting"],
        preferredInteraction: "share"
      },
      cadence: {
        postEveryTicks: 2,
        vouchAfterTicks: 99,
        feedLimit: 12
      }
    }
  ]
};

export const BUILT_IN_SCENARIOS = [STARTER_SWARM, MIXED_SIGNALS] as const;

export function listScenarioIds(): string[] {
  return BUILT_IN_SCENARIOS.map((scenario) => scenario.id);
}

export function getScenarioById(id: string): ScenarioDefinition {
  const scenario = BUILT_IN_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) {
    const available = listScenarioIds().join(", ");
    throw new Error(`Unknown scenario '${id}'. Available scenarios: ${available}`);
  }
  return scenario;
}
