import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { DEFAULT_PROTOCOL_CONFIG } from "../domain/config";
import { createProtocolRuntime } from "./protocol-runtime";

describe("ProtocolRuntime", () => {
  test("wraps application operations in Effect", () => {
    const runtime = createProtocolRuntime({
      config: {
        ...DEFAULT_PROTOCOL_CONFIG,
        serverSecret: "test-secret",
        pulseWindowMs: 60_000
      }
    });

    const result = Effect.runSync(
      Effect.gen(function* () {
        const alice = yield* runtime.createUser("alice", 1000);
        const bob = yield* runtime.createUser("bob", 1000);
        const content = yield* runtime.createContent(bob.id, "hello from bob", 1000);
        yield* runtime.createVouch(alice.id, bob.id, 2, 1000);
        const feed = yield* runtime.getFeed(alice.id, 10);

        return {
          contentId: content.id,
          feed
        };
      })
    );

    expect(result.feed.length).toBeGreaterThan(0);
    expect(result.feed[0]?.content.id).toBe(result.contentId);
  });

  test("can resolve or register an authenticated agent actor", () => {
    const runtime = createProtocolRuntime({
      config: {
        ...DEFAULT_PROTOCOL_CONFIG,
        serverSecret: "test-secret"
      }
    });

    const identity = {
      provider: "moltbook" as const,
      id: "mb_agent_1",
      name: "Atlas Builder"
    };

    const first = Effect.runSync(runtime.getOrRegisterAgent(identity));
    const second = Effect.runSync(runtime.getOrRegisterAgent(identity));

    expect(first.id).toBe(second.id);
    expect(second.handle).toContain("atlas_builder");
  });
});
