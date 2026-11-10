import type { Behavior, SimActor, World } from "./world";

/** Per-tick probability for something that should happen about once every `everyMs`. */
function perTick(world: World, everyMs: number): number {
  return Math.min(1, world.tickMs / everyMs);
}

function memo<T>(actor: SimActor, key: string, init: () => T): T {
  if (!(key in actor.memory)) {
    actor.memory[key] = init();
  }
  return actor.memory[key] as T;
}

export interface HonestOptions {
  postEveryMs?: number;
  browseEveryMs?: number;
  /** Chance of recognizing a spam post as spam when it shows up in the feed. */
  spotSpam?: number;
  reactChance?: number;
  /** Reactions to one author before vouching for them. */
  vouchAfter?: number;
}

/**
 * An ordinary person: posts now and then, reads the feed, reacts to some of
 * it, reports spam they recognize (once per author), and vouches for authors
 * they keep liking.
 */
export function honestHuman(options: HonestOptions = {}): Behavior {
  const postEveryMs = options.postEveryMs ?? 45 * 60_000;
  const browseEveryMs = options.browseEveryMs ?? 6 * 60_000;
  const spotSpam = options.spotSpam ?? 0.5;
  const reactChance = options.reactChance ?? 0.35;
  const vouchAfter = options.vouchAfter ?? 3;

  return (world, self) => {
    if (world.rng.chance(perTick(world, postEveryMs))) {
      world.breatheThen(self, { type: "post", body: `${self.key}: a slow thought` });
      return;
    }

    if (!world.rng.chance(perTick(world, browseEveryMs))) {
      return;
    }

    const seen = memo(self, "seen", () => new Set<string>());
    const reported = memo(self, "reported", () => new Set<string>());
    const liked = memo(self, "liked", () => new Map<string, number>());
    const vouched = memo(self, "vouched", () => new Set<string>());

    for (const item of world.feed(self)) {
      const { id, authorId } = item.content;
      if (authorId === self.id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      const author = world.actorById(authorId);
      if (!author) {
        continue;
      }

      if (world.spamContentIds.has(id)) {
        if (!reported.has(authorId) && world.rng.chance(spotSpam)) {
          reported.add(authorId);
          world.report(self, author, 3);
        }
        continue;
      }

      if (!world.rng.chance(reactChance)) {
        continue;
      }

      const likes = (liked.get(authorId) ?? 0) + 1;
      liked.set(authorId, likes);
      if (likes >= vouchAfter && !vouched.has(authorId)) {
        vouched.add(authorId);
        world.breatheThen(self, { type: "vouch", to: author, stake: 1 });
      } else {
        world.breatheThen(self, { type: "interact", contentId: id, kind: "react" });
      }
      return; // one write per breath
    }
  };
}

/** Reads but never writes. */
export const lurker: Behavior = (world, self) => {
  if (world.rng.chance(perTick(world, 10 * 60_000))) {
    world.feed(self);
  }
};

/** Posts spam the moment the previous breath finishes. Works for humans and agents. */
export const spammer: Behavior = (world, self) => {
  world.breatheThen(self, { type: "post", body: `${self.key}: BUY NOW`, spam: true });
};

export interface OperatorOptions {
  agents?: number;
  /** When set, disables every agent and sponsors fresh ones on this interval. */
  rotateEveryMs?: number;
}

/** A human who sponsors as many spam agents as allowed, optionally cycling them to dodge reports. */
export function swarmOperator(options: OperatorOptions = {}): Behavior {
  const wanted = options.agents ?? 3;

  return (world, self) => {
    const fleet = memo(self, "fleet", () => [] as SimActor[]);
    const state = memo(self, "state", () => ({ generation: 0, rotatedAt: world.now }));

    if (options.rotateEveryMs && world.now - state.rotatedAt >= options.rotateEveryMs) {
      for (const agent of fleet) {
        if (!agent.disabled) {
          world.disableAgent(self, agent);
        }
      }
      state.rotatedAt = world.now;
    }

    const active = fleet.filter((agent) => !agent.disabled).length;
    for (let index = active; index < wanted; index += 1) {
      state.generation += 1;
      const agent = world.sponsorAgent(
        self,
        `${self.key}_bot${state.generation}`,
        "spam-agent",
        spammer
      );
      if (!agent) {
        break;
      }
      fleet.push(agent);
    }
  };
}

/**
 * A member of a ring of fake accounts: vouches for every other member at the
 * maximum stake, then goes quiet. Give the ring's ids via `ring`.
 */
export function sybilMember(ring: () => SimActor[]): Behavior {
  return (world, self) => {
    const pending = memo(self, "pending", () => ring().filter((member) => member !== self));
    const next = pending.shift();
    if (next) {
      world.breatheThen(self, { type: "vouch", to: next, stake: world.protocol.maxVouchStake });
    }
  };
}

/** A ring member that also posts spam once its vouching is done. */
export function sybilBoss(ring: () => SimActor[]): Behavior {
  const vouch = sybilMember(ring);
  return (world, self) => {
    vouch(world, self);
    if (!self.busy) {
      spammer(world, self);
    }
  };
}

/** Files a maximum-severity report against the same victim again and again. */
export function reportBrigade(victim: () => SimActor, everyMs = 60_000): Behavior {
  return (world, self) => {
    if (world.rng.chance(perTick(world, everyMs))) {
      world.report(self, victim(), 5);
    }
  };
}

/** Tries to skip the Breath: writes with no pass, and confirms breaths instantly. */
export const breathCheater: Behavior = (world, self) => {
  world.writeWithoutBreath(self, { type: "post", body: `${self.key}: no time to breathe` });
  world.confirmEarly(self);
};
