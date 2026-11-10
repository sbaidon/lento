import { describe, expect, test } from "bun:test";
import { BreathGate, DEFAULT_BREATH_CONFIG } from "./breath";

const config = { ...DEFAULT_BREATH_CONFIG, minDelayMs: 3000, maxDelayMs: 5000, graceMs: 100 };

function code(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("BreathGate", () => {
  test("picks a delay inside the configured range", () => {
    expect(new BreathGate(config, () => 0).begin("a", 0).readyInMs).toBe(3000);
    expect(new BreathGate(config, () => 0.999999).begin("a", 0).readyInMs).toBe(5000);
  });

  test("a confirmation inside the window earns a single-use pass", () => {
    const gate = new BreathGate(config, () => 0.5);
    const ticket = gate.begin("alice", 0);
    expect(ticket.readyInMs).toBe(4000);

    const { pass } = gate.confirm("alice", ticket.id, 4500);
    expect(code(() => gate.consume("bob", pass, 4600))).toBe("breath_required");
    expect(code(() => gate.consume("alice", "brp_wrong", 4600))).toBe("breath_required");

    gate.consume("alice", pass, 4600);
    expect(code(() => gate.consume("alice", pass, 4700))).toBe("breath_required");
  });

  test("early and late confirmations void the breath", () => {
    const gate = new BreathGate(config, () => 0.5);

    const early = gate.begin("alice", 0);
    expect(code(() => gate.confirm("alice", early.id, 1000))).toBe("breath_too_early");
    expect(code(() => gate.confirm("alice", early.id, 4500))).toBe("breath_not_found");

    const late = gate.begin("alice", 10_000);
    expect(code(() => gate.confirm("alice", late.id, 10_000 + 4000 + 4000 + 101))).toBe(
      "breath_missed"
    );
  });

  test("passes expire, cannot be confirmed twice, and are replaced by a new breath", () => {
    const gate = new BreathGate(config, () => 0.5);

    const first = gate.begin("alice", 0);
    const { pass } = gate.confirm("alice", first.id, 4000);
    expect(code(() => gate.confirm("alice", first.id, 4100))).toBe("breath_not_found");
    expect(code(() => gate.consume("alice", pass, 4000 + config.passTtlMs + 1))).toBe(
      "breath_required"
    );

    const second = gate.begin("alice", 100_000);
    const earned = gate.confirm("alice", second.id, 104_000);
    // Beginning again discards the unspent pass: no stockpiling.
    gate.begin("alice", 105_000);
    expect(code(() => gate.consume("alice", earned.pass, 105_100))).toBe("breath_required");
    expect(code(() => gate.consume("alice", undefined, 105_100))).toBe("breath_required");
  });
});
