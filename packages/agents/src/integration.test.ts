import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROTOCOL_CONFIG, LentoApiClient, ProtocolService } from "@lento/core";
import { createHttpServer, DevMoltbookIdentityVerifier } from "@lento/server";
import { getScenarioById } from "./scenarios";
import { AgentRuntime } from "./runtime";
import { FileScenarioStateStore } from "./store";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("AgentRuntime", () => {
  test("runs starter scenario against a live server and persists state", async () => {
    const service = new ProtocolService({
      ...DEFAULT_PROTOCOL_CONFIG,
      serverSecret: "test-secret"
    });
    const server = createHttpServer(service, {
      port: 0,
      identityVerifier: new DevMoltbookIdentityVerifier(),
      requireIdentityForWrites: true
    });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const tempDir = mkdtempSync(join(tmpdir(), "lento-agents-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "state.json");

    try {
      const runtime = new AgentRuntime(
        new LentoApiClient(baseUrl),
        new FileScenarioStateStore(storePath)
      );
      const result = await runtime.runScenario(getScenarioById("starter-swarm"), 4);
      const atlasState = result.state.agents["atlas-builder"];
      const beaconState = result.state.agents["beacon-curator"];

      expect(result.totalTicks).toBe(4);
      expect(result.events.some((event) => event.action.kind === "resolve-agent")).toBeTrue();
      expect(result.events.some((event) => event.action.kind === "post")).toBeTrue();
      expect(result.events.some((event) => event.action.kind === "interact")).toBeTrue();
      expect(result.events.some((event) => event.action.kind === "vouch")).toBeTrue();
      expect(atlasState?.actorId).toBeString();
      expect(beaconState?.recentActions.length).toBeGreaterThan(0);

      const atlasFeed = await new LentoApiClient(baseUrl).getFeed(atlasState!.actorId!, 10);
      expect(atlasFeed.length).toBeGreaterThan(0);
    } finally {
      server.stop(true);
    }
  });

  test("mixed-signals triggers report actions", async () => {
    const service = new ProtocolService({
      ...DEFAULT_PROTOCOL_CONFIG,
      serverSecret: "test-secret"
    });
    const server = createHttpServer(service, {
      port: 0,
      identityVerifier: new DevMoltbookIdentityVerifier(),
      requireIdentityForWrites: true
    });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const tempDir = mkdtempSync(join(tmpdir(), "lento-agents-"));
    tempDirs.push(tempDir);

    try {
      const runtime = new AgentRuntime(
        new LentoApiClient(baseUrl),
        new FileScenarioStateStore(join(tempDir, "state.json"))
      );
      const result = await runtime.runScenario(getScenarioById("mixed-signals"), 4);
      expect(result.events.some((event) => event.action.kind === "report")).toBeTrue();
    } finally {
      server.stop(true);
    }
  });
});
