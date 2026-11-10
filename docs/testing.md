# Testing Lento

Lento has three layers of tests. `bun run test` runs all of them.

| Layer                | Where                         | What it answers                                                                                         |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| Unit and HTTP tests  | `packages/*/src/**/*.test.ts` | Does each piece do what it says?                                                                        |
| Simulation scenarios | `packages/harness`            | Do the protocol's rules hold up against whole populations, including attackers?                         |
| Differential fuzzing | `packages/harness`            | Do random valid and invalid operations ever crash, break an invariant, or make the two stores disagree? |

## The simulation harness

`packages/harness` runs a closed Lento network in one process: the real `ProtocolService`, the real `BreathGate`, a virtual clock, and a seeded random number generator. A 12 hour network runs in a couple of seconds, and the same seed always replays exactly.

```bash
bun run harness list
bun run harness run all
bun run harness run sybil-ring --seeds 20
bun run harness run spam-flood --seed 7 --hours 6 --json
bun run harness fuzz --seeds 200 --steps 500
```

The exit code is 1 when anything needs attention, so these work as CI gates.

### Actors

Behaviors live in `src/behaviors.ts`. Each is a small function that runs whenever its actor is idle:

- `honestHuman`: posts now and then, reads the feed, reacts, reports spam it recognizes, vouches for authors it keeps liking
- `lurker`: reads only
- `spammer`: posts spam the moment its last breath finishes (human or agent)
- `swarmOperator`: sponsors the maximum number of spam agents, optionally rotating them
- `sybilMember` and `sybilBoss`: a ring of fake accounts that vouch for each other
- `reportBrigade`: reports one victim again and again
- `breathCheater`: writes with no breath pass and confirms breaths instantly

Honest actors act the way the web client does: begin a breath, confirm inside the window, spend the pass, write.

### Invariants

Checked throughout every run (`src/invariants.ts`). A broken invariant is a bug, never a tuning question:

- energy stays between 0 and the actor's maximum
- trust stays between 0.01 and 0.99
- handles are unique
- a sponsor never has more active agents than the cap
- sponsored agents never vouch or file reports
- a disabled agent never writes again
- every interaction costs at least 1 energy
- no actor completes gated writes faster than the shortest breath
- no call throws anything other than a `ProtocolError`

### Expectations: `must` and `known-gap`

Each scenario ends with named expectations about the outcome.

- **`must`** is something the protocol guarantees today. If it fails, the run fails.
- **`known-gap`** is a weakness we know about and have not fixed. It is expected to fail and is reported as `GAP`. If it ever passes, the run reports `FIXED` and fails on purpose: that is the cue to promote it to `must` so it can never regress.

This keeps CI green without hiding problems, and turns every fix into a permanent guarantee.

### What the harness says today (seed 1)

Holds:

- A sponsor's spam swarm is bounded by the sponsor's energy: 93 agent posts in 6 hours, against 395 posts per hour for one unsponsored human spammer.
- The sponsor is drained by their own agents and ends at the trust floor. Rotating agents does not shed that liability.
- Reported spammers sink: spam is about 0% of honest feeds in the second half of every spam scenario.
- Repeating a report adds nothing: one report per reporter per target.
- Nothing is ever written without a breath, and confirming early never earns a pass.

Known gaps:

| Gap                                                          | Measured                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| A ring of fresh accounts can vouch itself above honest users | ring 0.711, honest 0.484                                                 |
| That ring can then report an honest user into the ground     | victim at 0.113 after 6 reports, because reports weigh by reporter trust |
| Three fresh accounts can still dent an honest user           | victim 0.335, other honest users about 0.49                              |
| False reports cost the reporter nothing                      | trolls stay at 0.500                                                     |
| Posting is free for humans, so the Breath is the only limit  | 395 posts per hour from one account                                      |
| A vouch can lower the recipient's trust                      | 0.500 to 0.489 after one full-stake vouch                                |

Closed and promoted to `must`:

- Repeat reports from the same accounts cannot destroy a user. Before: 523 reports from 3 accounts took the victim to 0.011. Now each reporter counts once per target and reports weigh by the reporter's trust: 3 reports counted, the rest refused, victim at 0.335.

The sybil ring is now the keystone. Trust decides how much a vouch and a report are worth, so anything that inflates trust cheaply undermines both.

Also measured: before reports land, spam reaches 65% to 70% of honest feeds in the first half hour.

### Adding a scenario

Add a `Scenario` to `src/scenarios.ts`: populate the world in `build`, return expectations. It is picked up by the CLI and by `bun run test` automatically.

## Differential fuzzing

`fuzz(seed, steps)` feeds one seeded stream of operations to two replicas of the protocol, one on the in-memory store and one on SQLite. About a third of the operations are deliberately invalid: bad handles, unknown ids, self-vouches, out-of-range stakes and severities, empty and oversized posts, agents trying to sponsor agents.

It reports four kinds of finding: a crash, the two stores answering differently, a broken invariant, or the stores ending up with different data.

Its first catch was real: the in-memory store did not roll back a failed operation, while SQLite did, so the stores drifted apart after any rejected write. In-memory transactions are now atomic.

## What the harness does not cover

- It calls the protocol in process, not over HTTP. Route-level checks (keys, rate limits, the breath header) are covered by the server's own tests.
- Behaviors are simple scripts, not adaptive adversaries. A gap the harness does not list may still exist.
- Scenarios are small (tens of actors, hours of simulated time). They test rules, not scale.
