import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentDefinition, AgentMemory, ScenarioState, ScenarioStateStore } from "./types";

interface PersistedAgentState {
  version: 2;
  scenarios: Record<string, ScenarioState>;
}

function createEmptyState(): PersistedAgentState {
  return {
    version: 2,
    scenarios: {}
  };
}

export function createInitialAgentMemory(agent: AgentDefinition): AgentMemory {
  return {
    resolvedHandle: agent.handle,
    actorId: undefined,
    tickCount: 0,
    lastPostTick: undefined,
    postedContentIds: [],
    interactedContentIds: [],
    vouchedActorIds: [],
    reportedActorIds: [],
    recentActions: []
  };
}

export function createInitialScenarioState(): ScenarioState {
  return {
    totalTicks: 0,
    agents: {}
  };
}

export class InMemoryScenarioStateStore implements ScenarioStateStore {
  private readonly states = new Map<string, ScenarioState>();

  load(scenarioId: string): ScenarioState {
    return this.states.get(scenarioId) ?? createInitialScenarioState();
  }

  save(scenarioId: string, state: ScenarioState): void {
    this.states.set(scenarioId, state);
  }

  reset(scenarioId: string): void {
    this.states.delete(scenarioId);
  }
}

export class FileScenarioStateStore implements ScenarioStateStore {
  constructor(private readonly filePath: string) {}

  load(scenarioId: string): ScenarioState {
    const persisted = this.readPersistedState();
    return persisted.scenarios[scenarioId] ?? createInitialScenarioState();
  }

  save(scenarioId: string, state: ScenarioState): void {
    const persisted = this.readPersistedState();
    persisted.scenarios[scenarioId] = state;
    this.writePersistedState(persisted);
  }

  reset(scenarioId: string): void {
    const persisted = this.readPersistedState();
    if (!(scenarioId in persisted.scenarios)) {
      return;
    }

    delete persisted.scenarios[scenarioId];
    this.writePersistedState(persisted);
  }

  clearAll(): void {
    rmSync(this.filePath, { force: true });
  }

  private readPersistedState(): PersistedAgentState {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedAgentState;
      if (parsed.version !== 2 || typeof parsed.scenarios !== "object" || !parsed.scenarios) {
        return createEmptyState();
      }
      return parsed;
    } catch {
      return createEmptyState();
    }
  }

  private writePersistedState(state: PersistedAgentState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}
