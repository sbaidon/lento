import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DEFAULT_PROTOCOL_CONFIG, ProtocolService, SqliteStore } from "@lento/core";
import { createHttpServer } from "@lento/server";
import { runCli } from "./index";

interface CapturedOutput {
  stdout: string;
  stderr: string;
}

async function captureConsole(action: () => Promise<void>): Promise<CapturedOutput> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    stdout.push(args.map((arg) => String(arg)).join(" "));
  };
  console.error = (...args: unknown[]) => {
    stderr.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
    await action();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return {
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n")
  };
}

function parseJson<T>(output: string): T {
  return JSON.parse(output) as T;
}

describe("CLI integration", () => {
  test("runs user/content/feed lifecycle against a live server", async () => {
    const service = new ProtocolService({
      ...DEFAULT_PROTOCOL_CONFIG,
      serverSecret: "test-secret"
    });
    const server = createHttpServer(service, { port: 0 });
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const userAOut = await captureConsole(async () => {
        await runCli(["user", "alice", "--url", baseUrl]);
      });
      const alice = parseJson<{ id: string }>(userAOut.stdout);

      const userBOut = await captureConsole(async () => {
        await runCli(["user", "bob", "--url", baseUrl]);
      });
      const bob = parseJson<{ id: string }>(userBOut.stdout);

      const postOut = await captureConsole(async () => {
        await runCli(["post", bob.id, "hello", "from", "bob", "--url", baseUrl]);
      });
      const content = parseJson<{ id: string }>(postOut.stdout);

      const vouchOut = await captureConsole(async () => {
        await runCli(["vouch", alice.id, bob.id, "2", "--url", baseUrl]);
      });
      const vouchResult = parseJson<{ trustScore: number }>(vouchOut.stdout);
      expect(vouchResult.trustScore).toBeTypeOf("number");

      const interactionOut = await captureConsole(async () => {
        await runCli([
          "interact",
          alice.id,
          content.id,
          "comment",
          "nonce-integration",
          "--url",
          baseUrl
        ]);
      });
      const interaction = parseJson<{ id: string; kind: string }>(interactionOut.stdout);
      expect(interaction.kind).toBe("comment");

      const feedOut = await captureConsole(async () => {
        await runCli(["feed", alice.id, "10", "--url", baseUrl]);
      });
      const feed = parseJson<Array<{ content: { id: string } }>>(feedOut.stdout);

      expect(feed.length).toBeGreaterThan(0);
      expect(feed[0]?.content.id).toBe(content.id);
      expect(userAOut.stderr).toBe("");
      expect(userBOut.stderr).toBe("");
    } finally {
      server.stop(true);
    }
  });

  test("prints verified identity through the CLI", async () => {
    const service = new ProtocolService({
      ...DEFAULT_PROTOCOL_CONFIG,
      serverSecret: "test-secret"
    });
    const server = createHttpServer(service, {
      port: 0,
      identityVerifier: {
        async verify(token) {
          if (token !== "valid-token") {
            return null;
          }

          return {
            provider: "moltbook",
            id: "agt_1",
            name: "Atlas",
            isClaimed: true
          };
        }
      }
    });
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const output = await captureConsole(async () => {
        await runCli(["identity", "--url", baseUrl, "--moltbook-identity", "valid-token"]);
      });
      const identity = parseJson<{ id: string; provider: string }>(output.stdout);

      expect(identity.id).toBe("agt_1");
      expect(identity.provider).toBe("moltbook");
      expect(output.stderr).toBe("");
    } finally {
      server.stop(true);
    }
  });

  test("auto-provisions the authenticated agent through the CLI", async () => {
    const service = new ProtocolService({
      ...DEFAULT_PROTOCOL_CONFIG,
      serverSecret: "test-secret"
    });
    const server = createHttpServer(service, {
      port: 0,
      identityVerifier: {
        async verify(token) {
          if (token !== "valid-token") {
            return null;
          }

          return {
            provider: "moltbook",
            id: "agt_1",
            name: "Atlas"
          };
        }
      }
    });
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const output = await captureConsole(async () => {
        await runCli(["agent-me", "--url", baseUrl, "--moltbook-identity", "valid-token"]);
      });
      const agent = parseJson<{ id: string; kind: string; identity: { id: string } }>(
        output.stdout
      );

      expect(agent.kind).toBe("agent");
      expect(agent.id.startsWith("agt_")).toBeTrue();
      expect(agent.identity.id).toBe("agt_1");
      expect(output.stderr).toBe("");
    } finally {
      server.stop(true);
    }
  });

  test("exports and imports SQLite state for migration workflows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lento-cli-store-"));
    const sourceDbPath = join(dir, "source.sqlite");
    const targetDbPath = join(dir, "target.sqlite");
    const snapshotPath = join(dir, "snapshot.json");

    try {
      const sourceStore = new SqliteStore({ path: sourceDbPath });
      const sourceService = new ProtocolService(
        {
          ...DEFAULT_PROTOCOL_CONFIG,
          serverSecret: "test-secret"
        },
        sourceStore
      );

      const alice = sourceService.createUser({ handle: "alice", now: 1000 });
      sourceService.createContent({ authorId: alice.id, body: "hello migration", now: 1001 });
      sourceStore.close();

      const exportOutput = await captureConsole(async () => {
        await runCli(["store-export", "--db", sourceDbPath, "--out", snapshotPath]);
      });
      const exportResult = parseJson<{ ok: boolean; actors: number; content: number }>(
        exportOutput.stdout
      );

      expect(exportResult.ok).toBeTrue();
      expect(exportResult.actors).toBe(1);
      expect(exportResult.content).toBe(1);

      const importOutput = await captureConsole(async () => {
        await runCli(["store-import", "--db", targetDbPath, "--in", snapshotPath]);
      });
      const importResult = parseJson<{ ok: boolean; actors: number; content: number }>(
        importOutput.stdout
      );

      expect(importResult.ok).toBeTrue();
      expect(importResult.actors).toBe(1);
      expect(importResult.content).toBe(1);

      const targetStore = new SqliteStore({ path: targetDbPath });
      const targetService = new ProtocolService(
        {
          ...DEFAULT_PROTOCOL_CONFIG,
          serverSecret: "test-secret"
        },
        targetStore
      );

      expect(targetService.listActors()).toHaveLength(1);
      expect(targetService.listContent()).toHaveLength(1);
      expect(targetService.listContent()[0]?.body).toBe("hello migration");

      targetStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
