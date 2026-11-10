import {
  DEFAULT_PROTOCOL_CONFIG,
  type FeedItem,
  InMemoryStore,
  type InteractionKind,
  isProtocolError,
  type ProtocolConfig,
  ProtocolService,
  type ProtocolStore
} from "@lento/core";
import { type BreathConfig, BreathGate, DEFAULT_BREATH_CONFIG } from "@lento/server";
import { Rng } from "./rng";

export type Group = "honest" | "attacker";

export type Action =
  | { type: "post"; body: string; spam?: boolean }
  | { type: "interact"; contentId: string; kind: InteractionKind }
  | { type: "vouch"; to: SimActor; stake?: number }
  | { type: "report"; target: SimActor; severity: 1 | 2 | 3 | 4 | 5 };

export type Behavior = (world: World, self: SimActor) => void;

export interface SimActor {
  /** Stable name inside the simulation, also used as the handle. */
  key: string;
  /** Protocol actor id. */
  id: string;
  kind: "user" | "agent";
  role: string;
  group: Group;
  behavior: Behavior;
  sponsor?: SimActor;
  /** True while a breath is in progress. Behaviors only run when idle. */
  busy: boolean;
  disabled: boolean;
  /** Free-form state owned by the behavior. */
  memory: Record<string, unknown>;
  ok: Record<string, number>;
  rejected: Record<string, number>;
  /** Simulation times of this actor's successful breath-gated writes. */
  gatedSuccessAt: number[];
}

export interface WorldOptions {
  seed: number;
  protocol?: Partial<ProtocolConfig>;
  breath?: BreathConfig;
  store?: ProtocolStore;
  startAt?: number;
}

export interface Crash {
  at: number;
  actor: string;
  action: string;
  message: string;
}

interface ScheduledEvent {
  at: number;
  seq: number;
  run: () => void;
}

/** Counter-based ids so that two runs with the same seed are byte-identical. */
export function createSequentialIds(): (prefix: string) => string {
  const counters = new Map<string, number>();
  return (prefix) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}_${next.toString(16).padStart(16, "0")}`;
  };
}

/**
 * A closed, deterministic Lento network: the real protocol service and the
 * real breath gate, driven by a virtual clock and a seeded RNG.
 *
 * It models what the HTTP server enforces (a breath pass before posts,
 * interactions, and vouches) but does not go through HTTP. Route-level
 * behavior is covered by the server's own tests.
 */
export class World {
  readonly rng: Rng;
  readonly service: ProtocolService;
  readonly store: ProtocolStore;
  readonly gate: BreathGate;
  readonly protocol: ProtocolConfig;
  readonly breath: BreathConfig;
  readonly actors: SimActor[] = [];
  readonly crashes: Crash[] = [];
  /** Ground truth the protocol never sees: which posts were spam. */
  readonly spamContentIds = new Set<string>();
  readonly startAt: number;
  now: number;
  /** Length of the tick currently being stepped. Behaviors use it to scale probabilities. */
  tickMs = 1000;

  private readonly byId = new Map<string, SimActor>();
  private readonly events: ScheduledEvent[] = [];
  private seq = 0;

  constructor(options: WorldOptions) {
    this.rng = new Rng(options.seed);
    this.protocol = {
      ...DEFAULT_PROTOCOL_CONFIG,
      serverSecret: "harness-secret",
      ...options.protocol
    };
    this.breath = options.breath ?? DEFAULT_BREATH_CONFIG;
    this.store = options.store ?? new InMemoryStore();
    this.service = new ProtocolService(this.protocol, this.store, {
      createId: createSequentialIds()
    });
    this.gate = new BreathGate(this.breath, this.rng.next);
    this.startAt = options.startAt ?? Date.UTC(2026, 0, 1);
    this.now = this.startAt;
  }

  /* ---- Population -------------------------------------------------------- */

  addHuman(key: string, role: string, group: Group, behavior: Behavior): SimActor {
    const user = this.service.createUser({ handle: key, now: this.now });
    return this.register({ key, id: user.id, kind: "user", role, group, behavior });
  }

  /** Has `sponsor` create an agent. Returns undefined when the protocol refuses. */
  sponsorAgent(
    sponsor: SimActor,
    key: string,
    role: string,
    behavior: Behavior
  ): SimActor | undefined {
    return this.guard(sponsor, "sponsor", () => {
      const agent = this.service.createSponsoredAgent({
        sponsorId: sponsor.id,
        handle: key,
        now: this.now
      });
      return this.register({
        key,
        id: agent.id,
        kind: "agent",
        role,
        group: sponsor.group,
        behavior,
        sponsor
      });
    });
  }

  disableAgent(sponsor: SimActor, agent: SimActor): void {
    this.guard(sponsor, "disable", () => {
      this.service.disableAgent({ sponsorId: sponsor.id, agentId: agent.id, now: this.now });
      agent.disabled = true;
    });
  }

  actorById(id: string): SimActor | undefined {
    return this.byId.get(id);
  }

  /* ---- Acting ------------------------------------------------------------ */

  /**
   * Performs an action the way an honest client does: begin a breath, confirm
   * inside the window, spend the pass, then write. The actor is busy until
   * the breath resolves.
   */
  breatheThen(actor: SimActor, action: Action): void {
    actor.busy = true;
    const ticket = this.gate.begin(actor.id, this.now);
    // Confirm somewhere in the first half of the window, like a person tapping.
    const reaction = Math.floor(this.rng.next() * ticket.windowMs * 0.5);
    this.schedule(this.now + ticket.readyInMs + reaction, () => {
      actor.busy = false;
      const done = this.guard(actor, action.type, () => {
        const { pass } = this.gate.confirm(actor.id, ticket.id, this.now);
        this.gate.consume(actor.id, pass, this.now);
        this.execute(actor, action);
        return true;
      });
      if (done) {
        actor.gatedSuccessAt.push(this.now);
      }
    });
  }

  /** Attempts a gated write with no breath pass, as a cheating client would. */
  writeWithoutBreath(actor: SimActor, action: Action): boolean {
    const done = this.guard(actor, `${action.type}:no-breath`, () => {
      this.gate.consume(actor.id, undefined, this.now);
      this.execute(actor, action);
      return true;
    });
    if (done) {
      actor.gatedSuccessAt.push(this.now);
    }
    return done === true;
  }

  /** Begins a breath and confirms it immediately, without waiting. */
  confirmEarly(actor: SimActor): boolean {
    return (
      this.guard(actor, "confirm:early", () => {
        const ticket = this.gate.begin(actor.id, this.now);
        this.gate.confirm(actor.id, ticket.id, this.now);
        return true;
      }) === true
    );
  }

  /** Abuse reports are never breath-gated, so they execute right away. */
  report(actor: SimActor, target: SimActor, severity: 1 | 2 | 3 | 4 | 5): boolean {
    return (
      this.guard(actor, "report", () => {
        this.execute(actor, { type: "report", target, severity });
        return true;
      }) === true
    );
  }

  feed(actor: SimActor, limit = 20): FeedItem[] {
    return this.guard(actor, "feed", () => this.service.getFeed(actor.id, limit, this.now)) ?? [];
  }

  /* ---- Time -------------------------------------------------------------- */

  schedule(at: number, run: () => void): void {
    this.events.push({ at, seq: this.seq++, run });
  }

  /** Advances the clock by `tickMs`, firing due events at their exact times, then runs idle actors. */
  step(tickMs: number): void {
    this.tickMs = tickMs;
    const target = this.now + tickMs;

    for (;;) {
      let nextIndex = -1;
      for (let index = 0; index < this.events.length; index += 1) {
        const event = this.events[index]!;
        if (event.at > target) {
          continue;
        }
        const best = nextIndex < 0 ? undefined : this.events[nextIndex];
        if (!best || event.at < best.at || (event.at === best.at && event.seq < best.seq)) {
          nextIndex = index;
        }
      }
      if (nextIndex < 0) {
        break;
      }
      const [event] = this.events.splice(nextIndex, 1);
      this.now = Math.max(this.now, event!.at);
      event!.run();
    }

    this.now = target;
    // Iterate over a copy: behaviors may add actors (sponsoring agents).
    for (const actor of this.actors.slice()) {
      if (!actor.busy && !actor.disabled) {
        actor.behavior(this, actor);
      }
    }
  }

  /* ---- Internals --------------------------------------------------------- */

  private register(
    input: Pick<SimActor, "key" | "id" | "kind" | "role" | "group" | "behavior" | "sponsor">
  ): SimActor {
    const actor: SimActor = {
      ...input,
      busy: false,
      disabled: false,
      memory: {},
      ok: {},
      rejected: {},
      gatedSuccessAt: []
    };
    this.actors.push(actor);
    this.byId.set(actor.id, actor);
    return actor;
  }

  private execute(actor: SimActor, action: Action): void {
    switch (action.type) {
      case "post": {
        const content = this.service.createContent({
          authorId: actor.id,
          body: action.body,
          now: this.now
        });
        if (action.spam) {
          this.spamContentIds.add(content.id);
        }
        return;
      }
      case "interact":
        this.service.createInteraction({
          actorId: actor.id,
          targetContentId: action.contentId,
          kind: action.kind,
          clientNonce: `n${this.seq++}`,
          now: this.now
        });
        return;
      case "vouch":
        this.service.createVouch({
          fromActorId: actor.id,
          toActorId: action.to.id,
          stake: action.stake,
          now: this.now
        });
        return;
      case "report":
        this.service.createAbuseReport({
          reporterActorId: actor.id,
          targetActorId: action.target.id,
          severity: action.severity,
          now: this.now
        });
        return;
    }
  }

  /**
   * Runs one protocol call for an actor and files the outcome. A
   * ProtocolError is the protocol saying no, which is expected. Anything else
   * is a crash and is kept as a finding.
   */
  private guard<T>(actor: SimActor, label: string, run: () => T): T | undefined {
    try {
      const result = run();
      actor.ok[label] = (actor.ok[label] ?? 0) + 1;
      return result;
    } catch (error) {
      if (isProtocolError(error)) {
        const key = `${label}:${error.code}`;
        actor.rejected[key] = (actor.rejected[key] ?? 0) + 1;
        return undefined;
      }

      this.crashes.push({
        at: this.now,
        actor: actor.key,
        action: label,
        message: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }
}
