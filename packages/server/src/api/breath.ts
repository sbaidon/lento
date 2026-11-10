import { randomBytes } from "node:crypto";
import { ProtocolError } from "@lento/core";

/**
 * The Breath, enforced by the server.
 *
 * Before a write, an actor begins a breath. The server picks a random delay
 * and tells the client when the confirmation window opens. A confirmation
 * that lands inside the window earns a single-use pass, and the write must
 * carry that pass.
 *
 * What this guarantees: every gated action costs real wall-clock time, one at
 * a time per actor, and cannot be skipped or stockpiled. What it does not do:
 * prove a human is present. A script can wait and confirm on time. It pays
 * the same time cost a person does.
 */
export interface BreathConfig {
  /** Shortest wait before the confirmation window opens. */
  minDelayMs: number;
  /** Longest wait before the confirmation window opens. */
  maxDelayMs: number;
  /** How long the confirmation window stays open. */
  windowMs: number;
  /** Slack on both edges of the window for clock and network jitter. */
  graceMs: number;
  /** How long an earned pass stays usable. */
  passTtlMs: number;
}

export const DEFAULT_BREATH_CONFIG: BreathConfig = {
  minDelayMs: 3500,
  maxDelayMs: 7000,
  windowMs: 4000,
  graceMs: 1000,
  passTtlMs: 60_000
};

export const BREATH_PASS_HEADER = "x-lento-breath";

interface BreathState {
  breathId: string;
  readyAt: number;
  closesAt: number;
  pass?: string;
  passExpiresAt?: number;
}

export interface BreathTicket {
  id: string;
  /** Milliseconds from now until the confirmation window opens. */
  readyInMs: number;
  /** Milliseconds the window stays open once it does. */
  windowMs: number;
}

export interface BreathPass {
  pass: string;
  expiresInMs: number;
}

const MAX_TRACKED_ACTORS = 50_000;

export class BreathGate {
  // One entry per actor: a breath in progress, or one earned and unspent pass.
  private readonly states = new Map<string, BreathState>();

  constructor(
    private readonly config: BreathConfig = DEFAULT_BREATH_CONFIG,
    private readonly random: () => number = Math.random
  ) {}

  /** Starts a breath. Any breath or unspent pass the actor already had is discarded. */
  begin(actorId: string, now = Date.now()): BreathTicket {
    if (this.states.size >= MAX_TRACKED_ACTORS && !this.states.has(actorId)) {
      this.prune(now);
    }

    const span = Math.max(0, this.config.maxDelayMs - this.config.minDelayMs);
    const delay = this.config.minDelayMs + Math.floor(this.random() * (span + 1));
    const state: BreathState = {
      breathId: `brt_${randomBytes(12).toString("hex")}`,
      readyAt: now + delay,
      closesAt: now + delay + this.config.windowMs
    };
    this.states.set(actorId, state);

    return { id: state.breathId, readyInMs: delay, windowMs: this.config.windowMs };
  }

  /** Confirms presence inside the window and returns a single-use pass. */
  confirm(actorId: string, breathId: string, now = Date.now()): BreathPass {
    const state = this.states.get(actorId);
    if (!state || state.breathId !== breathId || state.pass) {
      throw new ProtocolError("breath_not_found", 404, "No such breath in progress. Begin again.");
    }

    if (now < state.readyAt - this.config.graceMs) {
      // Confirming early voids the breath, so guessing costs a full restart.
      this.states.delete(actorId);
      throw new ProtocolError("breath_too_early", 409, "Too early. Begin again and wait for it.");
    }

    if (now > state.closesAt + this.config.graceMs) {
      this.states.delete(actorId);
      throw new ProtocolError("breath_missed", 410, "The moment passed. Begin again.");
    }

    state.pass = `brp_${randomBytes(24).toString("base64url")}`;
    state.passExpiresAt = now + this.config.passTtlMs;
    return { pass: state.pass, expiresInMs: this.config.passTtlMs };
  }

  /** Spends the actor's pass. Throws if it is missing, wrong, expired, or already used. */
  consume(actorId: string, pass: string | undefined, now = Date.now()): void {
    const state = this.states.get(actorId);
    const valid =
      pass !== undefined &&
      state?.pass !== undefined &&
      state.pass === pass &&
      state.passExpiresAt !== undefined &&
      now <= state.passExpiresAt;

    if (!valid) {
      throw new ProtocolError(
        "breath_required",
        428,
        "This action needs a fresh breath. Begin one, confirm it, and send the pass."
      );
    }

    this.states.delete(actorId);
  }

  private prune(now: number): void {
    for (const [actorId, state] of this.states) {
      const deadline = state.passExpiresAt ?? state.closesAt + this.config.graceMs;
      if (deadline < now) {
        this.states.delete(actorId);
      }
    }
  }
}
