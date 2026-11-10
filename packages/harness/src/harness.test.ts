import { describe, expect, test } from "bun:test";
import { honestHuman, spammer } from "./behaviors";
import { fuzz } from "./fuzz";
import { checkInvariants } from "./invariants";
import { Rng } from "./rng";
import { formatResult, type RunResult, runScenario, type Scenario } from "./runner";
import { findScenario, SCENARIOS } from "./scenarios";
import { World } from "./world";

const withoutTiming = (result: RunResult) => ({ ...result, wallMs: 0 });

describe("Rng", () => {
  test("is deterministic per seed and stays in range", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const draws = Array.from({ length: 50 }, () => a.next());
    expect(Array.from({ length: 50 }, () => b.next())).toEqual(draws);
    expect(Array.from({ length: 50 }, () => c.next())).not.toEqual(draws);
    expect(draws.every((value) => value >= 0 && value < 1)).toBe(true);

    const ints = Array.from({ length: 200 }, () => a.int(3, 5));
    expect(new Set(ints)).toEqual(new Set([3, 4, 5]));
    expect(a.pick([])).toBeUndefined();
  });
});

describe("scenarios", () => {
  // Every scenario is a regression test: invariants hold, every `must`
  // passes, and every known gap is still a gap. When a gap closes the run
  // reports "fixed" and fails, which is the cue to promote it to `must`.
  for (const scenario of SCENARIOS) {
    test(`${scenario.id} holds at seed 1`, () => {
      const result = runScenario(scenario, { seed: 1 });
      if (!result.ok) {
        console.log(formatResult(result));
      }
      expect(result.violations).toEqual([]);
      expect(result.expectations.filter((item) => item.status === "fail")).toEqual([]);
      expect(result.expectations.filter((item) => item.status === "fixed")).toEqual([]);
      expect(result.ok).toBe(true);
    }, 60_000);
  }

  test("the same seed replays exactly, and a different seed does not", () => {
    const scenario = findScenario("agent-swarm")!;
    const first = runScenario(scenario, { seed: 7, hours: 1 });
    const again = runScenario(scenario, { seed: 7, hours: 1 });
    const other = runScenario(scenario, { seed: 8, hours: 1 });
    expect(withoutTiming(again)).toEqual(withoutTiming(first));
    expect(withoutTiming(other)).not.toEqual(withoutTiming(first));
  });

  test("cheap scenarios hold across several seeds", () => {
    for (const id of ["first-vouch", "breath-cheaters", "report-brigade"]) {
      for (let seed = 2; seed <= 6; seed += 1) {
        const result = runScenario(findScenario(id)!, { seed });
        expect({ id, seed, ok: result.ok }).toEqual({ id, seed, ok: true });
      }
    }
  });
});

describe("the harness catches what it claims to catch", () => {
  test("a failed must and a closed gap both fail the run", () => {
    const scenario: Scenario = {
      id: "self-check",
      description: "expectations wired to known outcomes",
      hours: 0.05,
      build: (world) => {
        world.addHuman("solo", "honest", "honest", honestHuman());
        return [
          { name: "true must", severity: "must", check: () => ({ pass: true, detail: "" }) },
          { name: "false must", severity: "must", check: () => ({ pass: false, detail: "" }) },
          { name: "open gap", severity: "known-gap", check: () => ({ pass: false, detail: "" }) },
          { name: "closed gap", severity: "known-gap", check: () => ({ pass: true, detail: "" }) }
        ];
      }
    };

    const result = runScenario(scenario);
    expect(result.expectations.map((item) => item.status)).toEqual([
      "pass",
      "fail",
      "gap",
      "fixed"
    ]);
    expect(result.ok).toBe(false);
  });

  test("invariants flag corrupted state, crashes, and impossible write speed", () => {
    const world = new World({ seed: 1 });
    const sam = world.addHuman("sam", "honest", "honest", spammer);
    expect(checkInvariants(world)).toEqual([]);

    const stored = world.store.getUser(sam.id)!;
    world.store.saveUser({
      ...stored,
      trustScore: 1.4,
      energy: { ...stored.energy, current: stored.energy.max + 50 }
    });
    sam.gatedSuccessAt.push(1000, 1200);
    world.crashes.push({ at: 0, actor: "sam", action: "post", message: "boom" });

    const broken = checkInvariants(world).map((violation) => violation.invariant);
    expect(broken).toContain("trust-in-bounds");
    expect(broken).toContain("energy-in-bounds");
    expect(broken).toContain("breath-spacing");
    expect(broken).toContain("no-crashes");
  });

  test("a non-protocol error is recorded as a crash, not swallowed", () => {
    const world = new World({ seed: 1 });
    const sam = world.addHuman("sam", "honest", "honest", () => {});
    world.service.getFeed = () => {
      throw new TypeError("store exploded");
    };
    expect(world.feed(sam)).toEqual([]);
    expect(world.crashes).toHaveLength(1);
    expect(world.crashes[0]?.message).toBe("store exploded");
  });
});

describe("fuzz", () => {
  test("in-memory and SQLite stores agree across seeds, with no crashes", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const result = fuzz(seed, 300);
      expect({ seed, findings: result.findings }).toEqual({ seed, findings: [] });
      // Guard against a fuzzer that only ever produces rejected operations.
      expect(result.accepted).toBeGreaterThan(100);
      expect(result.rejected).toBeGreaterThan(20);
    }
  }, 60_000);
});
