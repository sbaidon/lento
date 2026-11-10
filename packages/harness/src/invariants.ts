import type { ProtocolConfig, ProtocolStore } from "@lento/core";
import type { World } from "./world";

export interface Violation {
  invariant: string;
  at: number;
  detail: string;
}

const EPSILON = 1e-9;

/**
 * Properties that must hold in every reachable state, whatever the actors
 * do. A violation is a protocol bug, not a balance question.
 */
export function checkInvariants(world: World): Violation[] {
  const violations = checkStoreInvariants(world.store, world.protocol, world.now);
  const fail = (invariant: string, detail: string) =>
    violations.push({ invariant, at: world.now, detail });

  // The Breath: no actor completes gated writes faster than the shortest breath.
  const minGap = world.breath.minDelayMs - world.breath.graceMs;
  for (const actor of world.actors) {
    for (let index = 1; index < actor.gatedSuccessAt.length; index += 1) {
      const gap = actor.gatedSuccessAt[index]! - actor.gatedSuccessAt[index - 1]!;
      if (gap < minGap) {
        fail("breath-spacing", `${actor.key} wrote twice ${gap}ms apart`);
        break;
      }
    }
  }

  for (const crash of world.crashes) {
    fail("no-crashes", `${crash.actor} ${crash.action}: ${crash.message}`);
  }

  return violations;
}

/** The invariants that can be read straight off stored state, with no simulation context. */
export function checkStoreInvariants(
  store: ProtocolStore,
  protocol: ProtocolConfig,
  now: number
): Violation[] {
  const violations: Violation[] = [];
  const fail = (invariant: string, detail: string) =>
    violations.push({ invariant, at: now, detail });
  const world = { store, protocol };

  const users = world.store.listUsers();
  const agents = world.store.listAgents();
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const handles = new Set<string>();

  for (const actor of [...users, ...agents]) {
    if (actor.energy.current < -EPSILON || actor.energy.current > actor.energy.max + EPSILON) {
      fail(
        "energy-in-bounds",
        `${actor.handle} has energy ${actor.energy.current} of ${actor.energy.max}`
      );
    }
    if (!(actor.trustScore >= 0.01 - EPSILON && actor.trustScore <= 0.99 + EPSILON)) {
      fail("trust-in-bounds", `${actor.handle} has trust ${actor.trustScore}`);
    }
    if (handles.has(actor.handle)) {
      fail("handles-unique", `handle ${actor.handle} is used twice`);
    }
    handles.add(actor.handle);
  }

  const activeBySponsor = new Map<string, number>();
  for (const agent of agents) {
    if (!agent.sponsorId) {
      continue;
    }
    if (!agent.disabledAt) {
      activeBySponsor.set(agent.sponsorId, (activeBySponsor.get(agent.sponsorId) ?? 0) + 1);
    }
    if (agent.stats.vouchesGiven > 0) {
      fail("sponsored-agents-cannot-vouch", `${agent.handle} gave a vouch`);
    }
  }
  for (const [sponsorId, count] of activeBySponsor) {
    if (count > world.protocol.maxAgentsPerSponsor) {
      fail("sponsor-agent-cap", `${sponsorId} runs ${count} active agents`);
    }
  }

  for (const report of world.store.listAbuseReports()) {
    if (agentById.get(report.reporterActorId)?.sponsorId) {
      fail("sponsored-agents-cannot-report", `${report.reporterActorId} filed a report`);
    }
  }

  for (const content of world.store.listContent()) {
    const disabledAt = agentById.get(content.authorId)?.disabledAt;
    if (disabledAt !== undefined && content.createdAt > disabledAt) {
      fail("disabled-agents-are-silent", `${content.authorId} posted after being disabled`);
    }
  }

  for (const interaction of world.store.listInteractions()) {
    if (interaction.appliedCost < 1) {
      fail("interactions-cost-energy", `${interaction.id} cost ${interaction.appliedCost}`);
    }
    const disabledAt = agentById.get(interaction.actorId)?.disabledAt;
    if (disabledAt !== undefined && interaction.createdAt > disabledAt) {
      fail("disabled-agents-are-silent", `${interaction.actorId} interacted after being disabled`);
    }
  }

  return violations;
}
