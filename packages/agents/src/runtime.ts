import { LentoApiClient } from "@lento/core";
import { Effect } from "effect";
import type {
  AgentActionKind,
  AgentActionRecord,
  AgentBrain,
  AgentDecision,
  AgentDefinition,
  ScenarioDefinition,
  ScenarioRunEvent,
  ScenarioRunResult,
  ScenarioState,
  ScenarioStateStore
} from "./types";
import { DeterministicAgentBrain } from "./brain";
import { createInitialAgentMemory } from "./store";

interface ResolvedAgentActor {
  actorId: string;
  resolvedHandle: string;
  api: LentoApiClient;
}

function nowIso(): string {
  return new Date().toISOString();
}

function truncateActions(actions: AgentActionRecord[]): AgentActionRecord[] {
  return actions.slice(-20);
}

function createDevIdentityToken(agent: AgentDefinition): string {
  return `dev:${agent.id}:${encodeURIComponent(agent.profile.displayName)}`;
}

function toActionRecord(
  tick: number,
  kind: AgentActionKind,
  summary: string,
  targetId?: string
): AgentActionRecord {
  return {
    tick,
    kind,
    summary,
    targetId,
    createdAt: nowIso()
  };
}

function appendAction(state: ScenarioState, agentId: string, action: AgentActionRecord): void {
  const memory = state.agents[agentId];
  if (!memory) {
    return;
  }

  memory.tickCount += 1;
  memory.recentActions = truncateActions([...memory.recentActions, action]);
}

function resetEphemeralMemory(state: ScenarioState, agentId: string): void {
  const memory = state.agents[agentId];
  if (!memory) {
    return;
  }

  memory.lastPostTick = undefined;
  memory.postedContentIds = [];
  memory.interactedContentIds = [];
  memory.vouchedActorIds = [];
  memory.reportedActorIds = [];
}

function fromAsync<A>(thunk: () => Promise<A> | A): Effect.Effect<A, unknown> {
  return Effect.tryPromise({
    try: () => Promise.resolve(thunk()),
    catch: (error) => error
  });
}

export class AgentRuntime {
  constructor(
    private readonly api: LentoApiClient,
    private readonly store: ScenarioStateStore,
    private readonly brain: AgentBrain = new DeterministicAgentBrain()
  ) {}

  runScenario(definition: ScenarioDefinition, ticks: number): Promise<ScenarioRunResult> {
    return Effect.runPromise(this.runScenarioEffect(definition, ticks));
  }

  resetScenario(scenarioId: string): Promise<void> {
    return Effect.runPromise(this.resetScenarioEffect(scenarioId));
  }

  private loadScenarioStateEffect(scenarioId: string): Effect.Effect<ScenarioState, unknown> {
    return fromAsync(() => this.store.load(scenarioId));
  }

  private saveScenarioStateEffect(
    scenarioId: string,
    state: ScenarioState
  ): Effect.Effect<void, unknown> {
    return fromAsync(() => this.store.save(scenarioId, state));
  }

  private resetScenarioEffect(scenarioId: string): Effect.Effect<void, unknown> {
    if (!this.store.reset) {
      return Effect.succeed(undefined);
    }

    return fromAsync(() => this.store.reset?.(scenarioId)).pipe(Effect.asVoid);
  }

  private ensureAgentActorEffect(
    api: LentoApiClient,
    agent: AgentDefinition,
    state: ScenarioState
  ): Effect.Effect<ResolvedAgentActor, unknown> {
    const memory = state.agents[agent.id] ?? createInitialAgentMemory(agent);
    state.agents[agent.id] = memory;
    const authenticatedApi = api.withMoltbookIdentityToken(createDevIdentityToken(agent));

    return Effect.map(
      fromAsync(() => authenticatedApi.registerAgent(agent.handle)),
      (resolved) => {
        if (memory.actorId && memory.actorId !== resolved.id) {
          resetEphemeralMemory(state, agent.id);
        }

        memory.actorId = resolved.id;
        memory.resolvedHandle = resolved.handle;

        return {
          actorId: resolved.id,
          resolvedHandle: resolved.handle,
          api: authenticatedApi
        };
      }
    );
  }

  private planNextActionEffect(
    definition: ScenarioDefinition,
    state: ScenarioState,
    agent: AgentDefinition,
    tick: number,
    resolvedAgent?: ResolvedAgentActor
  ): Effect.Effect<AgentDecision, unknown> {
    const memory = state.agents[agent.id] ?? createInitialAgentMemory(agent);
    state.agents[agent.id] = memory;

    if (!memory.actorId) {
      return fromAsync(() =>
        this.brain.decide({
          agent,
          memory,
          feed: [],
          tick
        })
      );
    }

    const feedLimit = agent.cadence?.feedLimit ?? definition.feedLimit ?? 20;
    const feedApi = resolvedAgent?.api ?? this.api;
    const feedActorId = resolvedAgent?.actorId ?? memory.actorId;

    return Effect.flatMap(
      fromAsync(() => feedApi.getFeed(feedActorId, feedLimit)),
      (feed) =>
        fromAsync(() =>
          this.brain.decide({
            agent,
            memory,
            feed,
            tick
          })
        )
    );
  }

  private executeDecisionEffect(
    state: ScenarioState,
    agent: AgentDefinition,
    tick: number,
    decision: AgentDecision,
    resolvedAgent?: ResolvedAgentActor
  ): Effect.Effect<AgentActionRecord, unknown> {
    const memory = state.agents[agent.id] ?? createInitialAgentMemory(agent);
    state.agents[agent.id] = memory;

    if (decision.kind === "resolve-agent") {
      return Effect.map(
        resolvedAgent
          ? Effect.succeed(resolvedAgent)
          : this.ensureAgentActorEffect(this.api, agent, state),
        (actor) =>
          toActionRecord(
            tick,
            "resolve-agent",
            `${decision.reason} -> resolved ${actor.resolvedHandle} (${actor.actorId})`,
            actor.actorId
          )
      );
    }

    const actorEffect =
      resolvedAgent !== undefined
        ? Effect.succeed(resolvedAgent)
        : this.ensureAgentActorEffect(this.api, agent, state);

    return Effect.flatMap(actorEffect, (actor) => {
      switch (decision.kind) {
        case "post":
          return Effect.map(
            fromAsync(() => actor.api.createContent(actor.actorId, decision.body)),
            (content) => {
              memory.lastPostTick = tick;
              memory.postedContentIds = [...memory.postedContentIds, content.id].slice(-50);
              return toActionRecord(
                tick,
                "post",
                `${decision.reason} -> posted ${content.id}`,
                content.id
              );
            }
          );

        case "interact":
          return Effect.map(
            fromAsync(() =>
              actor.api.createInteraction(
                actor.actorId,
                decision.targetContentId,
                decision.interactionKind,
                `${agent.id}-${tick}-${memory.interactedContentIds.length + 1}`
              )
            ),
            (interaction) => {
              memory.interactedContentIds = [
                ...memory.interactedContentIds,
                decision.targetContentId
              ].slice(-100);
              return toActionRecord(
                tick,
                "interact",
                `${decision.reason} -> ${decision.interactionKind} on ${decision.targetContentId}`,
                interaction.id
              );
            }
          );

        case "vouch":
          return Effect.map(
            fromAsync(() =>
              actor.api.createActorVouch(actor.actorId, decision.toActorId, decision.stake)
            ),
            (result) => {
              memory.vouchedActorIds = [...memory.vouchedActorIds, decision.toActorId].slice(-50);
              return toActionRecord(
                tick,
                "vouch",
                `${decision.reason} -> vouched for ${decision.toActorId} (trust ${result.trustScore.toFixed(3)})`,
                result.vouch.id
              );
            }
          );

        case "report":
          return Effect.map(
            fromAsync(() =>
              actor.api.createActorAbuseReport(
                actor.actorId,
                decision.targetActorId,
                decision.severity
              )
            ),
            (result) => {
              memory.reportedActorIds = [...memory.reportedActorIds, decision.targetActorId].slice(
                -50
              );
              return toActionRecord(
                tick,
                "report",
                `${decision.reason} -> reported ${decision.targetActorId} (trust ${result.trustScore.toFixed(3)})`,
                decision.targetActorId
              );
            }
          );

        case "noop":
          return Effect.succeed(toActionRecord(tick, "noop", decision.reason));
      }
    });
  }

  private runAgentTickEffect(
    definition: ScenarioDefinition,
    state: ScenarioState,
    agent: AgentDefinition,
    tick: number
  ): Effect.Effect<ScenarioRunEvent, never> {
    const api = this.api;
    const ensureAgentActorEffect = this.ensureAgentActorEffect.bind(this);
    const planNextActionEffect = this.planNextActionEffect.bind(this);
    const executeDecisionEffect = this.executeDecisionEffect.bind(this);
    const memory = state.agents[agent.id] ?? createInitialAgentMemory(agent);
    state.agents[agent.id] = memory;

    return Effect.catchAll(
      Effect.gen(function* () {
        const resolvedAgent = memory.actorId
          ? yield* ensureAgentActorEffect(api, agent, state)
          : undefined;
        const decision = yield* planNextActionEffect(definition, state, agent, tick, resolvedAgent);
        const action = yield* executeDecisionEffect(state, agent, tick, decision, resolvedAgent);

        appendAction(state, agent.id, action);

        return {
          agentId: agent.id,
          handle: state.agents[agent.id]?.resolvedHandle ?? agent.handle,
          action
        };
      }),
      (error) =>
        Effect.sync(() => {
          const message = error instanceof Error ? error.message : String(error);
          const action = toActionRecord(tick, "error", message);
          appendAction(state, agent.id, action);

          return {
            agentId: agent.id,
            handle: state.agents[agent.id]?.resolvedHandle ?? agent.handle,
            action
          };
        })
    );
  }

  private runScenarioEffect(
    definition: ScenarioDefinition,
    ticks: number
  ): Effect.Effect<ScenarioRunResult, unknown> {
    const loadScenarioStateEffect = this.loadScenarioStateEffect.bind(this);
    const runAgentTickEffect = this.runAgentTickEffect.bind(this);
    const saveScenarioStateEffect = this.saveScenarioStateEffect.bind(this);

    return Effect.gen(function* () {
      let state = yield* loadScenarioStateEffect(definition.id);
      const events: ScenarioRunEvent[] = [];

      for (let step = 0; step < ticks; step += 1) {
        const tick = state.totalTicks + 1;

        for (const agent of definition.agents) {
          const event = yield* runAgentTickEffect(definition, state, agent, tick);
          events.push(event);
        }

        state = {
          ...state,
          totalTicks: tick
        };
        yield* saveScenarioStateEffect(definition.id, state);
      }

      return {
        scenarioId: definition.id,
        totalTicks: state.totalTicks,
        events,
        state
      };
    });
  }
}
