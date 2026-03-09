import type { FeedItem, InteractionKind } from "@lento/core";

export type AgentArchetype = "builder" | "curator" | "critic" | "watcher" | "troll";

export type AgentActionKind =
  | "resolve-agent"
  | "post"
  | "interact"
  | "vouch"
  | "report"
  | "noop"
  | "error";

export interface AgentProfile {
  displayName: string;
  systemPrompt: string;
  goals: string[];
  preferredInteraction: InteractionKind;
}

export interface AgentCadence {
  feedLimit?: number;
  postEveryTicks?: number;
  vouchAfterTicks?: number;
}

export interface AgentDefinition {
  id: string;
  handle: string;
  archetype: AgentArchetype;
  profile: AgentProfile;
  cadence?: AgentCadence;
}

export interface AgentActionRecord {
  tick: number;
  kind: AgentActionKind;
  summary: string;
  targetId?: string;
  createdAt: string;
}

export interface AgentMemory {
  resolvedHandle: string;
  actorId?: string;
  tickCount: number;
  lastPostTick?: number;
  postedContentIds: string[];
  interactedContentIds: string[];
  vouchedActorIds: string[];
  reportedActorIds: string[];
  recentActions: AgentActionRecord[];
}

export interface ScenarioDefinition {
  id: string;
  description: string;
  agents: AgentDefinition[];
  feedLimit?: number;
}

export interface ScenarioState {
  totalTicks: number;
  agents: Record<string, AgentMemory>;
}

export interface ScenarioRunEvent {
  agentId: string;
  handle: string;
  action: AgentActionRecord;
}

export interface ScenarioRunResult {
  scenarioId: string;
  totalTicks: number;
  events: ScenarioRunEvent[];
  state: ScenarioState;
}

export interface AgentDecisionContext {
  agent: AgentDefinition;
  memory: AgentMemory;
  feed: FeedItem[];
  tick: number;
}

export type AgentDecision =
  | {
      kind: "resolve-agent";
      reason: string;
    }
  | {
      kind: "post";
      body: string;
      reason: string;
    }
  | {
      kind: "interact";
      targetContentId: string;
      interactionKind: InteractionKind;
      reason: string;
    }
  | {
      kind: "vouch";
      toActorId: string;
      stake: number;
      reason: string;
    }
  | {
      kind: "report";
      targetActorId: string;
      severity: 1 | 2 | 3 | 4 | 5;
      reason: string;
    }
  | {
      kind: "noop";
      reason: string;
    };

export interface AgentBrain {
  readonly name: string;
  decide(context: AgentDecisionContext): Promise<AgentDecision> | AgentDecision;
}

export interface ScenarioStateStore {
  load(scenarioId: string): Promise<ScenarioState> | ScenarioState;
  save(scenarioId: string, state: ScenarioState): Promise<void> | void;
  reset?(scenarioId: string): Promise<void> | void;
}
