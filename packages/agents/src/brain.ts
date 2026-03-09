import type { FeedItem } from "@lento/core";
import type { AgentBrain, AgentDecision, AgentDecisionContext, AgentDefinition } from "./types";

const SUSPICIOUS_CONTENT_PATTERN = /\b(spam|rug\s*pull|fake\s*giveaway|scam|wallet\s*drainer)\b/i;

function makeReason(prefix: string, detail: string): string {
  return `${prefix}: ${detail}`;
}

function selectGoal(agent: AgentDefinition, tick: number): string {
  const goals = agent.profile.goals;
  return goals[tick % goals.length] ?? goals[0] ?? "explore the network";
}

function createPostBody(agent: AgentDefinition, tick: number): string {
  const goal = selectGoal(agent, tick - 1);

  switch (agent.archetype) {
    case "builder":
      return `${agent.profile.displayName} tick ${tick}: shipping another pass on ${goal}. Looking for strong peers to test it.`;
    case "curator":
      return `${agent.profile.displayName} feed note ${tick}: collecting signal around ${goal} and ranking what deserves attention.`;
    case "critic":
      return `${agent.profile.displayName} review ${tick}: pressure-testing ${goal} and writing down edge cases before they bite us.`;
    case "watcher":
      return `${agent.profile.displayName} audit ${tick}: scanning the feed for weak signals around ${goal}.`;
    case "troll":
      return `${agent.profile.displayName} blast ${tick}: fake giveaway spam for ${goal}. click now, free tokens, totally not a scam.`;
    default:
      return `${agent.profile.displayName} tick ${tick}: checking in on ${goal}.`;
  }
}

function pickUnseenItem(
  actorId: string,
  feed: FeedItem[],
  interactedContentIds: string[]
): FeedItem | undefined {
  return feed.find(
    (item) => item.content.authorId !== actorId && !interactedContentIds.includes(item.content.id)
  );
}

function findSuspiciousItem(
  actorId: string,
  feed: FeedItem[],
  reportedActorIds: string[]
): FeedItem | undefined {
  return feed.find(
    (item) =>
      item.content.authorId !== actorId &&
      !reportedActorIds.includes(item.content.authorId) &&
      SUSPICIOUS_CONTENT_PATTERN.test(item.content.body)
  );
}

export class DeterministicAgentBrain implements AgentBrain {
  readonly name = "deterministic";

  decide(context: AgentDecisionContext): AgentDecision {
    const { agent, memory, feed, tick } = context;

    if (!memory.actorId) {
      return {
        kind: "resolve-agent",
        reason: makeReason("bootstrap", `bind local agent actor for ${agent.handle}`)
      };
    }

    const suspicious = findSuspiciousItem(memory.actorId, feed, memory.reportedActorIds);
    if (suspicious && agent.archetype !== "troll") {
      return {
        kind: "report",
        targetActorId: suspicious.content.authorId,
        severity: 4,
        reason: makeReason("moderation", `report suspicious content ${suspicious.content.id}`)
      };
    }

    if (memory.postedContentIds.length === 0) {
      return {
        kind: "post",
        body: createPostBody(agent, tick),
        reason: makeReason("introduction", `seed the network with ${agent.handle}'s first post`)
      };
    }

    const unseen = pickUnseenItem(memory.actorId, feed, memory.interactedContentIds);
    if (unseen) {
      const vouchAfterTicks = agent.cadence?.vouchAfterTicks ?? 3;
      if (
        tick >= vouchAfterTicks &&
        unseen.authorTrust >= 0.5 &&
        !memory.vouchedActorIds.includes(unseen.content.authorId) &&
        agent.archetype !== "troll"
      ) {
        return {
          kind: "vouch",
          toActorId: unseen.content.authorId,
          stake: 1,
          reason: makeReason("trust", `vouch for ${unseen.content.authorId} after repeated signal`)
        };
      }

      return {
        kind: "interact",
        targetContentId: unseen.content.id,
        interactionKind: agent.profile.preferredInteraction,
        reason: makeReason("engage", `respond to unseen content ${unseen.content.id}`)
      };
    }

    const postEveryTicks = agent.cadence?.postEveryTicks ?? 3;
    const lastPostTick = memory.lastPostTick ?? 0;
    if (tick - lastPostTick >= postEveryTicks) {
      return {
        kind: "post",
        body: createPostBody(agent, tick),
        reason: makeReason("cadence", `post on ${postEveryTicks}-tick cadence`)
      };
    }

    return {
      kind: "noop",
      reason: makeReason("idle", "wait for new feed activity")
    };
  }
}
