import { checkInvariants, type Violation } from "./invariants";
import { type Group, type SimActor, World, type WorldOptions } from "./world";

export type Severity = "must" | "known-gap";

export interface Expectation {
  name: string;
  /**
   * `must`: the protocol is expected to guarantee this today.
   * `known-gap`: a weakness we know about. It is expected to fail, and the
   * run flags it if it starts passing so it can be promoted to `must`.
   */
  severity: Severity;
  check: (run: RunContext) => { pass: boolean; detail: string };
}

export interface Scenario {
  id: string;
  description: string;
  hours: number;
  tickMs?: number;
  world?: Partial<WorldOptions>;
  /** Populates the world and returns what the run should be judged on. */
  build: (world: World) => Expectation[];
}

export type ExpectationStatus = "pass" | "fail" | "gap" | "fixed";

export interface ExpectationResult {
  name: string;
  severity: Severity;
  status: ExpectationStatus;
  detail: string;
}

export interface GroupStats {
  actors: number;
  meanTrust: number;
  minTrust: number;
  posts: number;
  interactions: number;
  vouches: number;
  reports: number;
}

export interface ActorSummary {
  key: string;
  role: string;
  group: Group;
  kind: "user" | "agent";
  trust: number;
  energy: number;
  ok: Record<string, number>;
  rejected: Record<string, number>;
}

export interface RunResult {
  scenario: string;
  seed: number;
  hours: number;
  ticks: number;
  /** True when no invariant broke, every `must` held, and no known gap silently closed. */
  ok: boolean;
  violations: Violation[];
  expectations: ExpectationResult[];
  groups: Record<Group, GroupStats>;
  /** Share of spam in honest users' top-20 feeds, averaged over the second half of the run. */
  lateSpamFeedShare: number;
  /** Worst sampled spam share of honest feeds at any point in the run. */
  peakSpamFeedShare: number;
  actors: ActorSummary[];
  wallMs: number;
}

/** What expectations can look at once a run has finished. */
export class RunContext {
  constructor(
    readonly world: World,
    readonly hours: number,
    readonly spamShareSamples: Array<{ at: number; share: number }>
  ) {}

  trust(actor: SimActor): number {
    return this.world.service.getActor(actor.id, this.world.now).trustScore;
  }

  energy(actor: SimActor): number {
    return this.world.service.getActor(actor.id, this.world.now).energy.current;
  }

  select(filter: (actor: SimActor) => boolean): SimActor[] {
    return this.world.actors.filter(filter);
  }

  role(role: string): SimActor[] {
    return this.select((actor) => actor.role === role);
  }

  meanTrust(actors: SimActor[]): number {
    return mean(actors.map((actor) => this.trust(actor)));
  }

  count(actors: SimActor[], label: string): number {
    return actors.reduce((total, actor) => total + (actor.ok[label] ?? 0), 0);
  }

  rejections(actors: SimActor[], match: (key: string) => boolean): number {
    return actors.reduce(
      (total, actor) =>
        total +
        Object.entries(actor.rejected)
          .filter(([key]) => match(key))
          .reduce((sum, [, value]) => sum + value, 0),
      0
    );
  }

  /** Mean spam share of honest feeds over the second half of the run. */
  lateSpamFeedShare(): number {
    const midpoint = this.world.startAt + (this.world.now - this.world.startAt) / 2;
    return mean(
      this.spamShareSamples.filter((sample) => sample.at >= midpoint).map((sample) => sample.share)
    );
  }
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

const round = (value: number, digits = 4) => Number(value.toFixed(digits));

function sampleSpamShare(world: World): number | undefined {
  if (world.spamContentIds.size === 0) {
    return 0;
  }

  const readers = world.actors.filter((actor) => actor.role === "honest");
  const shares: number[] = [];
  for (const reader of readers) {
    const feed = world.service.getFeed(reader.id, 20, world.now);
    if (feed.length > 0) {
      shares.push(
        feed.filter((item) => world.spamContentIds.has(item.content.id)).length / feed.length
      );
    }
  }
  return shares.length === 0 ? undefined : mean(shares);
}

function groupStats(context: RunContext, group: Group): GroupStats {
  const actors = context.select((actor) => actor.group === group);
  const trusts = actors.map((actor) => context.trust(actor));
  return {
    actors: actors.length,
    meanTrust: round(mean(trusts)),
    minTrust: round(trusts.length ? Math.min(...trusts) : 0),
    posts: context.count(actors, "post"),
    interactions: context.count(actors, "interact"),
    vouches: context.count(actors, "vouch"),
    reports: context.count(actors, "report")
  };
}

export interface RunOptions {
  seed?: number;
  /** Overrides the scenario's simulated duration. */
  hours?: number;
  /** How often the full invariant sweep runs, in simulated time. It always runs at the end. */
  invariantEveryMs?: number;
}

export function runScenario(scenario: Scenario, options: RunOptions = {}): RunResult {
  const startedAt = performance.now();
  const seed = options.seed ?? 1;
  const hours = options.hours ?? scenario.hours;
  const tickMs = scenario.tickMs ?? 5000;
  const invariantEveryMs = options.invariantEveryMs ?? 10 * 60_000;
  const sampleEveryMs = 30 * 60_000;

  const world = new World({ ...scenario.world, seed });
  const expectations = scenario.build(world);
  const ticks = Math.ceil((hours * 3_600_000) / tickMs);
  const samples: Array<{ at: number; share: number }> = [];
  const violations = new Map<string, Violation>();
  const sweep = () => {
    for (const violation of checkInvariants(world)) {
      const key = `${violation.invariant}|${violation.detail}`;
      if (!violations.has(key)) {
        violations.set(key, violation);
      }
    }
  };

  let sinceSweep = 0;
  let sinceSample = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    world.step(tickMs);
    sinceSweep += tickMs;
    sinceSample += tickMs;
    if (sinceSweep >= invariantEveryMs) {
      sinceSweep = 0;
      sweep();
    }
    if (sinceSample >= sampleEveryMs) {
      sinceSample = 0;
      const share = sampleSpamShare(world);
      if (share !== undefined) {
        samples.push({ at: world.now, share });
      }
    }
  }
  sweep();

  const context = new RunContext(world, hours, samples);
  const results: ExpectationResult[] = expectations.map((expectation) => {
    const { pass, detail } = expectation.check(context);
    const status: ExpectationStatus =
      expectation.severity === "must" ? (pass ? "pass" : "fail") : pass ? "fixed" : "gap";
    return { name: expectation.name, severity: expectation.severity, status, detail };
  });

  return {
    scenario: scenario.id,
    seed,
    hours,
    ticks,
    ok:
      violations.size === 0 &&
      results.every((result) => result.status === "pass" || result.status === "gap"),
    violations: [...violations.values()],
    expectations: results,
    groups: { honest: groupStats(context, "honest"), attacker: groupStats(context, "attacker") },
    lateSpamFeedShare: round(context.lateSpamFeedShare()),
    peakSpamFeedShare: round(Math.max(0, ...samples.map((sample) => sample.share))),
    actors: world.actors.map((actor) => ({
      key: actor.key,
      role: actor.role,
      group: actor.group,
      kind: actor.kind,
      trust: round(context.trust(actor)),
      energy: round(context.energy(actor), 2),
      ok: actor.ok,
      rejected: actor.rejected
    })),
    wallMs: Math.round(performance.now() - startedAt)
  };
}

const STATUS_LABEL: Record<ExpectationStatus, string> = {
  pass: "PASS ",
  fail: "FAIL ",
  gap: "GAP  ",
  fixed: "FIXED"
};

export function formatResult(result: RunResult): string {
  const lines = [
    `${result.ok ? "ok  " : "FAIL"} ${result.scenario}  seed=${result.seed}  ${result.hours}h simulated in ${result.wallMs}ms`
  ];
  for (const group of ["honest", "attacker"] as const) {
    const stats = result.groups[group];
    if (stats.actors > 0) {
      lines.push(
        `     ${group.padEnd(8)} n=${stats.actors} trust mean=${stats.meanTrust} min=${stats.minTrust} posts=${stats.posts} interactions=${stats.interactions} vouches=${stats.vouches} reports=${stats.reports}`
      );
    }
  }
  if (result.groups.attacker.posts > 0) {
    lines.push(
      `     spam share of honest feeds: peak ${(result.peakSpamFeedShare * 100).toFixed(1)}%, late run ${(result.lateSpamFeedShare * 100).toFixed(1)}%`
    );
  }
  for (const expectation of result.expectations) {
    lines.push(
      `     ${STATUS_LABEL[expectation.status]} ${expectation.name}: ${expectation.detail}`
    );
  }
  for (const violation of result.violations) {
    lines.push(`     INVARIANT BROKEN ${violation.invariant}: ${violation.detail}`);
  }
  return lines.join("\n");
}
