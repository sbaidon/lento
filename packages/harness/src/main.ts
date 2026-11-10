#!/usr/bin/env bun
import { formatFuzzResult, fuzz } from "./fuzz";
import { formatResult, runScenario } from "./runner";
import { findScenario, SCENARIOS } from "./scenarios";

const USAGE = `Lento simulation harness

  bun run harness list
  bun run harness run <scenario|all> [--seed N] [--seeds N] [--hours H] [--json]
  bun run harness fuzz [--seeds N] [--steps N] [--from N]

Exit code is 1 when an invariant breaks, a must-hold expectation fails, a
known gap starts passing (promote it), or the fuzzer finds anything.`;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberFlag(args: string[], name: string, fallback: number): number {
  const raw = flag(args, name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number.`);
  }
  return value;
}

function main(args: string[]): number {
  const [command, target] = args;

  if (command === "list") {
    for (const scenario of SCENARIOS) {
      console.log(`${scenario.id.padEnd(18)} ${scenario.hours}h  ${scenario.description}`);
    }
    return 0;
  }

  if (command === "run") {
    const scenarios = target === "all" ? SCENARIOS : [findScenario(target ?? "")];
    if (scenarios.some((scenario) => !scenario)) {
      console.error(`Unknown scenario '${target ?? ""}'. Try: bun run harness list`);
      return 1;
    }

    const firstSeed = Math.floor(numberFlag(args, "seed", 1));
    const seedCount = Math.floor(numberFlag(args, "seeds", 1));
    const hoursFlag = flag(args, "hours");
    const hours = hoursFlag === undefined ? undefined : numberFlag(args, "hours", 1);
    const asJson = args.includes("--json");
    const results = [];
    let failed = false;

    for (const scenario of scenarios) {
      for (let seed = firstSeed; seed < firstSeed + seedCount; seed += 1) {
        const result = runScenario(scenario!, { seed, hours });
        failed ||= !result.ok;
        if (asJson) {
          results.push(result);
        } else {
          console.log(formatResult(result));
        }
      }
    }

    if (asJson) {
      console.log(JSON.stringify(results, null, 2));
    }
    return failed ? 1 : 0;
  }

  if (command === "fuzz") {
    const from = Math.floor(numberFlag(args, "from", 1));
    const seeds = Math.floor(numberFlag(args, "seeds", 50));
    const steps = Math.floor(numberFlag(args, "steps", 400));
    let failures = 0;
    for (let seed = from; seed < from + seeds; seed += 1) {
      const result = fuzz(seed, steps);
      if (result.findings.length > 0) {
        failures += 1;
        console.log(formatFuzzResult(result));
      }
    }
    console.log(
      `${failures === 0 ? "ok  " : "FAIL"} fuzz: ${seeds} seeds x ${steps} steps, ${failures} with findings`
    );
    return failures === 0 ? 0 : 1;
  }

  console.log(USAGE);
  return command === undefined || command === "help" || command === "--help" ? 0 : 1;
}

try {
  process.exit(main(Bun.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
