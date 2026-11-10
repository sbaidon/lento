import {
  DEFAULT_PROTOCOL_CONFIG,
  exportProtocolStore,
  InMemoryStore,
  type InteractionKind,
  isProtocolError,
  type ProtocolConfig,
  ProtocolService,
  type ProtocolStore,
  SqliteStore
} from "@lento/core";
import { checkStoreInvariants } from "./invariants";
import { Rng } from "./rng";
import { createSequentialIds } from "./world";

export type FuzzFindingKind = "crash" | "divergence" | "invariant" | "state-divergence";

export interface FuzzFinding {
  kind: FuzzFindingKind;
  step: number;
  op: string;
  detail: string;
}

export interface FuzzResult {
  seed: number;
  steps: number;
  /** How many operations the protocol accepted. A healthy run has a good mix. */
  accepted: number;
  rejected: number;
  findings: FuzzFinding[];
}

interface Replica {
  name: string;
  store: ProtocolStore;
  service: ProtocolService;
}

function makeReplica(name: string, store: ProtocolStore, config: ProtocolConfig): Replica {
  return {
    name,
    store,
    service: new ProtocolService(config, store, { createId: createSequentialIds() })
  };
}

/** JSON with object keys sorted, so two values compare equal whatever order their fields were built in. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        )
      : inner
  );
}

/** Runs one call and reduces its outcome to a comparable string. */
function outcome(run: () => unknown): {
  text: string;
  ok: boolean;
  crashed: boolean;
  value?: unknown;
} {
  try {
    const value = run();
    return { text: `ok:${stableJson(value)}`, ok: true, crashed: false, value };
  } catch (error) {
    if (isProtocolError(error)) {
      return { text: `rejected:${error.code}`, ok: false, crashed: false };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { text: `crash:${message}`, ok: false, crashed: true };
  }
}

function canonicalState(store: ProtocolStore): string {
  const snapshot = exportProtocolStore(store);
  const byId = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => a.id.localeCompare(b.id));
  return stableJson({
    users: byId(snapshot.users),
    agents: byId(snapshot.agents),
    content: byId(snapshot.content),
    interactions: byId(snapshot.interactions),
    vouches: byId(snapshot.vouches),
    abuseReports: [...snapshot.abuseReports].sort(
      (a, b) =>
        a.createdAt - b.createdAt ||
        a.reporterActorId.localeCompare(b.reporterActorId) ||
        a.targetActorId.localeCompare(b.targetActorId) ||
        a.severity - b.severity
    )
  });
}

const KINDS: InteractionKind[] = ["react", "comment", "share", "dm"];
const BAD_HANDLES = ["", "ab", "Has Space", "x".repeat(40), "dash-ed", "émile"];

/**
 * Differential, model-free fuzzing. A seeded stream of valid and deliberately
 * invalid operations is applied to two replicas of the protocol, one on the
 * in-memory store and one on SQLite. Findings:
 *
 * - `crash`: an operation threw something other than a ProtocolError
 * - `divergence`: the two stores answered the same operation differently
 * - `invariant`: stored state broke a protocol invariant
 * - `state-divergence`: the stores ended up holding different data
 */
export function fuzz(seed: number, steps = 400): FuzzResult {
  const rng = new Rng(seed);
  const config: ProtocolConfig = { ...DEFAULT_PROTOCOL_CONFIG, serverSecret: "fuzz-secret" };
  const sqlite = new SqliteStore({ path: ":memory:" });
  const replicas = [
    makeReplica("memory", new InMemoryStore(), config),
    makeReplica("sqlite", sqlite, config)
  ];

  const findings: FuzzFinding[] = [];
  const seen = new Set<string>();
  const report = (kind: FuzzFindingKind, step: number, op: string, detail: string) => {
    // One finding per distinct problem, not one per occurrence.
    const key = `${kind}|${op.split(" ")[0]}|${detail.replace(/_[0-9a-f]{16}/g, "_ID")}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push({ kind, step, op, detail });
    }
  };

  const users: string[] = [];
  const agents: string[] = [];
  const content: string[] = [];
  let now = Date.UTC(2026, 0, 1);
  let accepted = 0;
  let rejected = 0;
  let handleCounter = 0;

  const someUser = () => (rng.chance(0.05) ? "usr_missing" : (rng.pick(users) ?? "usr_missing"));
  const someActor = () => (rng.chance(0.3) && agents.length > 0 ? rng.pick(agents)! : someUser());
  const someContent = () =>
    rng.chance(0.05) ? "cnt_missing" : (rng.pick(content) ?? "cnt_missing");
  const freshHandle = () =>
    rng.chance(0.1) ? rng.pick(BAD_HANDLES)! : `h${(handleCounter += 1)}_${rng.int(0, 2)}`;

  try {
    for (let step = 0; step < steps; step += 1) {
      now += rng.int(0, 20 * 60_000);
      const roll = rng.next();
      let label: string;
      let apply: (service: ProtocolService) => unknown;
      let onAccept: ((value: unknown) => void) | undefined;

      if (users.length < 3 || roll < 0.1) {
        const handle = freshHandle();
        label = `createUser ${JSON.stringify(handle)}`;
        apply = (service) => service.createUser({ handle, now });
        onAccept = (value) => users.push((value as { id: string }).id);
      } else if (roll < 0.3) {
        const authorId = someActor();
        const body = rng.chance(0.1)
          ? rng.pick(["", "   ", "x".repeat(config.maxContentLength + 1)])!
          : `post ${step}`;
        label = `createContent ${authorId} len=${body.length}`;
        apply = (service) => service.createContent({ authorId, body, now });
        onAccept = (value) => content.push((value as { id: string }).id);
      } else if (roll < 0.55) {
        const actorId = someActor();
        const targetContentId = someContent();
        const kind = rng.pick(KINDS)!;
        label = `createInteraction ${actorId} ${kind} ${targetContentId}`;
        apply = (service) =>
          service.createInteraction({
            actorId,
            targetContentId,
            kind,
            clientNonce: `n${step}`,
            now
          });
      } else if (roll < 0.7) {
        const fromActorId = someActor();
        const toActorId = rng.chance(0.1) ? fromActorId : someActor();
        const stake = rng.pick([1, 2, 5, 0, 6, Number.NaN, 2.7])!;
        label = `createVouch ${fromActorId} -> ${toActorId} stake=${stake}`;
        apply = (service) => service.createVouch({ fromActorId, toActorId, stake, now });
      } else if (roll < 0.8) {
        const reporterActorId = someActor();
        const targetActorId = someActor();
        const severity = rng.pick([1, 3, 5, 0, 9, Number.NaN])! as 1 | 2 | 3 | 4 | 5;
        label = `createAbuseReport ${reporterActorId} -> ${targetActorId} sev=${severity}`;
        apply = (service) =>
          service.createAbuseReport({ reporterActorId, targetActorId, severity, now });
      } else if (roll < 0.88) {
        const sponsorId = someActor();
        const handle = freshHandle();
        label = `createSponsoredAgent ${sponsorId} ${JSON.stringify(handle)}`;
        apply = (service) => service.createSponsoredAgent({ sponsorId, handle, now });
        onAccept = (value) => agents.push((value as { id: string }).id);
      } else if (roll < 0.93) {
        const sponsorId = someUser();
        const agentId = rng.pick(agents) ?? "agt_missing";
        label = `disableAgent ${sponsorId} ${agentId}`;
        apply = (service) => service.disableAgent({ sponsorId, agentId, now });
      } else {
        const actorId = someActor();
        const limit = rng.pick([1, 20, 100, 0, -5, 1000, Number.NaN])!;
        label = `getFeed ${actorId} limit=${limit}`;
        apply = (service) => service.getFeed(actorId, limit, now);
      }

      const results = replicas.map((replica) => outcome(() => apply(replica.service)));
      const [memory, disk] = results as [(typeof results)[number], (typeof results)[number]];

      results.forEach((result, index) => {
        if (result.crashed) {
          report("crash", step, label, `${replicas[index]!.name}: ${result.text.slice(6)}`);
        }
      });
      if (memory.text !== disk.text) {
        report(
          "divergence",
          step,
          label,
          `memory ${memory.text.slice(0, 160)} | sqlite ${disk.text.slice(0, 160)}`
        );
      }

      if (memory.ok) {
        accepted += 1;
        onAccept?.(memory.value);
      } else {
        rejected += 1;
      }

      if (step % 25 === 24 || step === steps - 1) {
        for (const replica of replicas) {
          for (const violation of checkStoreInvariants(replica.store, config, now)) {
            report(
              "invariant",
              step,
              label,
              `${replica.name}: ${violation.invariant}: ${violation.detail}`
            );
          }
        }
      }
    }

    if (canonicalState(replicas[0]!.store) !== canonicalState(replicas[1]!.store)) {
      report(
        "state-divergence",
        steps,
        "final state",
        "in-memory and SQLite stores hold different data"
      );
    }
  } finally {
    sqlite.close();
  }

  return { seed, steps, accepted, rejected, findings };
}

export function formatFuzzResult(result: FuzzResult): string {
  const lines = [
    `${result.findings.length === 0 ? "ok  " : "FAIL"} fuzz seed=${result.seed} steps=${result.steps} accepted=${result.accepted} rejected=${result.rejected}`
  ];
  for (const finding of result.findings) {
    lines.push(`     ${finding.kind} at step ${finding.step}: ${finding.op}`);
    lines.push(`       ${finding.detail}`);
  }
  return lines.join("\n");
}
