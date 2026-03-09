import { resolve } from "node:path";
import { LentoApiClient } from "@lento/core";
import { DeterministicAgentBrain } from "./brain";
import { getScenarioById, listScenarioIds } from "./scenarios";
import { FileScenarioStateStore } from "./store";
import { AgentRuntime } from "./runtime";
import type { ScenarioRunResult } from "./types";

interface ParsedArgs {
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  const args: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      args.push(token);
      continue;
    }

    const raw = token.slice(2);
    const equalsIndex = raw.indexOf("=");
    if (equalsIndex >= 0) {
      flags[raw.slice(0, equalsIndex)] = raw.slice(equalsIndex + 1) || true;
      continue;
    }

    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      flags[raw] = next;
      index += 1;
      continue;
    }

    flags[raw] = true;
  }

  return { command, args, flags };
}

function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function flagNumber(flags: Record<string, string | boolean>, key: string): number | undefined {
  const value = flagString(flags, key);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function printHelp(): void {
  console.log(`Lento Agents

Commands:
  help
  scenarios
  scenario <scenarioId> [--ticks <n>] [--url <http://localhost:3000>] [--state <path>] [--reset] [--json]
  tick <scenarioId> [--url <http://localhost:3000>] [--state <path>] [--reset] [--json]

Examples:
  bun run agents -- scenarios
  bun run agents -- scenario starter-swarm --ticks 4 --url http://localhost:3000
  bun run agents -- scenario mixed-signals --ticks 5 --url http://localhost:3000 --reset
`);
}

function formatResult(result: ScenarioRunResult): string {
  const lines = [
    `scenario=${result.scenarioId}`,
    `totalTicks=${result.totalTicks}`,
    `events=${result.events.length}`,
    ""
  ];

  for (const event of result.events) {
    lines.push(
      `[tick ${event.action.tick}] ${event.handle} ${event.action.kind} ${event.action.summary}`
    );
  }

  return lines.join("\n");
}

export async function runAgentCli(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);

  switch (parsed.command) {
    case "help": {
      printHelp();
      return;
    }

    case "scenarios": {
      for (const scenarioId of listScenarioIds()) {
        const scenario = getScenarioById(scenarioId);
        console.log(`${scenario.id}: ${scenario.description}`);
      }
      return;
    }

    case "tick":
    case "scenario": {
      const scenarioId = parsed.args[0];
      if (!scenarioId) {
        throw new Error(`Usage: ${parsed.command} <scenarioId>`);
      }

      const ticks =
        parsed.command === "tick"
          ? 1
          : Math.max(1, Math.floor(flagNumber(parsed.flags, "ticks") ?? 3));
      const baseUrl =
        flagString(parsed.flags, "url") ??
        flagString(parsed.flags, "server") ??
        Bun.env.LENTO_SERVER_URL ??
        "http://localhost:3000";
      const statePath = resolve(flagString(parsed.flags, "state") ?? ".lento/agents/state.json");
      const reset = parsed.flags.reset === true;
      const json = parsed.flags.json === true;
      const scenario = getScenarioById(scenarioId);
      const runtime = new AgentRuntime(
        new LentoApiClient(baseUrl),
        new FileScenarioStateStore(statePath),
        new DeterministicAgentBrain()
      );

      if (reset) {
        await runtime.resetScenario(scenario.id);
      }

      const result = await runtime.runScenario(scenario, ticks);
      console.log(json ? JSON.stringify(result, null, 2) : formatResult(result));
      return;
    }

    default:
      throw new Error(`Unknown command '${parsed.command}'. Use 'help'.`);
  }
}
