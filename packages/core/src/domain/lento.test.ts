import { describe, expect, test } from "bun:test";
import { LentoCostEngine } from "./lento";
import { DEFAULT_PROTOCOL_CONFIG } from "./config";

describe("LentoCostEngine", () => {
  const engine = new LentoCostEngine({
    ...DEFAULT_PROTOCOL_CONFIG,
    serverSecret: "test-secret",
    pulseWindowMs: 60_000
  });

  test("produces deterministic proof/cost for same input", () => {
    const input = {
      kind: "comment" as const,
      actorId: "usr_a",
      targetId: "cnt_b",
      trustScore: 0.5,
      clientNonce: "nonce-1",
      at: 120_000
    };

    const first = engine.calculate(input);
    const second = engine.calculate(input);

    expect(first.proof).toBe(second.proof);
    expect(first.cost).toBe(second.cost);
    expect(first.multiplier).toBe(second.multiplier);
  });

  test("changes proof when nonce changes", () => {
    const baseInput = {
      kind: "react" as const,
      actorId: "usr_a",
      targetId: "cnt_b",
      trustScore: 0.5,
      at: 120_000
    };

    const first = engine.calculate({ ...baseInput, clientNonce: "nonce-1" });
    const second = engine.calculate({ ...baseInput, clientNonce: "nonce-2" });

    expect(first.proof).not.toBe(second.proof);
  });

  test("higher trust reduces interaction cost for same random roll", () => {
    const shared = {
      kind: "share" as const,
      actorId: "usr_a",
      targetId: "cnt_b",
      clientNonce: "same-nonce",
      at: 120_000
    };

    const lowTrust = engine.calculate({ ...shared, trustScore: 0.1 });
    const highTrust = engine.calculate({ ...shared, trustScore: 0.9 });

    expect(highTrust.cost).toBeLessThanOrEqual(lowTrust.cost);
  });
});
