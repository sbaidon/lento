import { describe, expect, test } from "bun:test";
import { DEFAULT_PROTOCOL_CONFIG, ProtocolService } from "@lento/core";
import { createHttpServer } from "./server";
import type { MoltbookIdentityVerifier } from "./moltbook-identity";

describe("createHttpServer", () => {
  function createTestServer(
    identityVerifier?: MoltbookIdentityVerifier,
    requireIdentityForWrites = false,
    enableAdminUi = false
  ): ReturnType<typeof createHttpServer> {
    const service = new ProtocolService({
      ...DEFAULT_PROTOCOL_CONFIG,
      serverSecret: "test-secret"
    });
    return createHttpServer(service, {
      port: 0,
      identityVerifier,
      requireIdentityForWrites,
      enableAdminUi
    });
  }

  function waitForSocketMessage(socket: WebSocket): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for websocket message."));
      }, 2000);

      const handleMessage = (event: MessageEvent) => {
        cleanup();
        try {
          resolve(JSON.parse(String(event.data)));
        } catch (error) {
          reject(error);
        }
      };

      const handleError = () => {
        cleanup();
        reject(new Error("Websocket error while waiting for message."));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeEventListener("message", handleMessage);
        socket.removeEventListener("error", handleError);
      };

      socket.addEventListener("message", handleMessage);
      socket.addEventListener("error", handleError);
    });
  }

  function waitForSocketOpen(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for websocket open."));
      }, 2000);

      const handleOpen = () => {
        cleanup();
        resolve();
      };

      const handleError = () => {
        cleanup();
        reject(new Error("Websocket error while waiting for open."));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
    });
  }

  test("returns health endpoint", async () => {
    const server = createTestServer();

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({ ok: true });
    } finally {
      server.stop(true);
    }
  });

  test("supports end-to-end protocol lifecycle routes", async () => {
    const server = createTestServer();
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const aliceResponse = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "alice" })
      });
      expect(aliceResponse.status).toBe(201);
      const alicePayload = await aliceResponse.json();
      const alice = alicePayload.user as { id: string };

      const bobResponse = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "bob" })
      });
      expect(bobResponse.status).toBe(201);
      const bobPayload = await bobResponse.json();
      const bob = bobPayload.user as { id: string };

      const contentResponse = await fetch(`${baseUrl}/content`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorId: bob.id, body: "hello world from bob" })
      });
      expect(contentResponse.status).toBe(201);
      const contentPayload = await contentResponse.json();
      const content = contentPayload.content as { id: string };

      const vouchResponse = await fetch(`${baseUrl}/vouches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromUserId: alice.id, toUserId: bob.id, stake: 2 })
      });
      expect(vouchResponse.status).toBe(201);
      const vouchPayload = await vouchResponse.json();
      expect(vouchPayload.trustScore).toBeTypeOf("number");

      const interactionResponse = await fetch(`${baseUrl}/interactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actorId: alice.id,
          targetContentId: content.id,
          kind: "comment",
          clientNonce: "nonce-1"
        })
      });
      expect(interactionResponse.status).toBe(201);
      const interactionPayload = await interactionResponse.json();
      expect(interactionPayload.interaction.kind).toBe("comment");

      const feedResponse = await fetch(`${baseUrl}/feed/${alice.id}?limit=10`);
      expect(feedResponse.status).toBe(200);
      const feedPayload = await feedResponse.json();
      expect(Array.isArray(feedPayload.feed)).toBe(true);
      expect(feedPayload.feed.length).toBeGreaterThan(0);
      expect(feedPayload.feed[0].content.id).toBe(content.id);
    } finally {
      server.stop(true);
    }
  });

  test("maps not-found and protocol errors to structured responses", async () => {
    const server = createTestServer();
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const first = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "alice" })
      });
      expect(first.status).toBe(201);

      const duplicate = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "alice" })
      });
      expect(duplicate.status).toBe(409);
      const duplicatePayload = await duplicate.json();
      expect(duplicatePayload.error.code).toBe("duplicate_handle");

      const invalidJson = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{"
      });
      expect(invalidJson.status).toBe(400);
      const invalidPayload = await invalidJson.json();
      expect(invalidPayload.error.code).toBe("invalid_json");

      const notFound = await fetch(`${baseUrl}/does-not-exist`);
      expect(notFound.status).toBe(404);
      const notFoundPayload = await notFound.json();
      expect(notFoundPayload.error.code).toBe("not_found");
    } finally {
      server.stop(true);
    }
  });

  test("returns verified Moltbook identity when provided", async () => {
    const verifier: MoltbookIdentityVerifier = {
      async verify(token) {
        if (token !== "valid-token") {
          return null;
        }

        return {
          provider: "moltbook",
          id: "agt_1",
          name: "Atlas",
          isClaimed: true,
          karma: 42
        };
      }
    };
    const server = createTestServer(verifier);

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/identity/me`, {
        headers: {
          "x-moltbook-identity": "valid-token"
        }
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.identity).toEqual({
        provider: "moltbook",
        id: "agt_1",
        name: "Atlas",
        isClaimed: true,
        karma: 42
      });
      expect(payload.agent).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("auto-provisions the authenticated agent actor", async () => {
    const verifier: MoltbookIdentityVerifier = {
      async verify(token) {
        if (token !== "valid-token") {
          return null;
        }

        return {
          provider: "moltbook",
          id: "agt_1",
          name: "Atlas Prime"
        };
      }
    };
    const server = createTestServer(verifier);

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/agents/me`, {
        headers: {
          "x-moltbook-identity": "valid-token"
        }
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.agent.kind).toBe("agent");
      expect(payload.agent.identity.id).toBe("agt_1");
    } finally {
      server.stop(true);
    }
  });

  test("authenticated agents can write as their bound actor without supplying an author id", async () => {
    const verifier: MoltbookIdentityVerifier = {
      async verify(token) {
        if (token !== "valid-token") {
          return null;
        }

        return {
          provider: "moltbook",
          id: "agt_1",
          name: "Atlas Prime"
        };
      }
    };
    const server = createTestServer(verifier);
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const contentResponse = await fetch(`${baseUrl}/content`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-moltbook-identity": "valid-token"
        },
        body: JSON.stringify({ body: "hello from an authenticated agent" })
      });
      const contentPayload = await contentResponse.json();

      expect(contentResponse.status).toBe(201);
      expect(contentPayload.content.authorId).toMatch(/^agt_/);
    } finally {
      server.stop(true);
    }
  });

  test("authenticated agents cannot act as another actor id", async () => {
    const verifier: MoltbookIdentityVerifier = {
      async verify(token) {
        if (token !== "valid-token") {
          return null;
        }

        return {
          provider: "moltbook",
          id: "agt_1",
          name: "Atlas Prime"
        };
      }
    };
    const server = createTestServer(verifier);
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const userResponse = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "alice" })
      });
      const userPayload = await userResponse.json();
      const alice = userPayload.user as { id: string };

      const contentResponse = await fetch(`${baseUrl}/content`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-moltbook-identity": "valid-token"
        },
        body: JSON.stringify({
          authorId: alice.id,
          body: "trying to impersonate alice"
        })
      });
      const contentPayload = await contentResponse.json();

      expect(contentResponse.status).toBe(403);
      expect(contentPayload.error.code).toBe("actor_forbidden");
    } finally {
      server.stop(true);
    }
  });

  test("rejects invalid Moltbook identity headers", async () => {
    const verifier: MoltbookIdentityVerifier = {
      async verify() {
        return null;
      }
    };
    const server = createTestServer(verifier);

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/health`, {
        headers: {
          "x-moltbook-identity": "bad-token"
        }
      });
      const payload = await response.json();

      expect(response.status).toBe(401);
      expect(payload.error.code).toBe("identity_invalid");
    } finally {
      server.stop(true);
    }
  });

  test("can require identity for all writes", async () => {
    const verifier: MoltbookIdentityVerifier = {
      async verify(token) {
        if (token !== "valid-token") {
          return null;
        }

        return {
          provider: "moltbook",
          id: "agt_1",
          name: "Atlas Prime"
        };
      }
    };
    const server = createTestServer(verifier, true);
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const anonymousWrite = await fetch(`${baseUrl}/content`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "anonymous write" })
      });
      const anonymousPayload = await anonymousWrite.json();
      expect(anonymousWrite.status).toBe(401);
      expect(anonymousPayload.error.code).toBe("identity_required");

      const userMode = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-moltbook-identity": "valid-token"
        },
        body: JSON.stringify({ handle: "alice" })
      });
      const userModePayload = await userMode.json();
      expect(userMode.status).toBe(403);
      expect(userModePayload.error.code).toBe("user_mode_disabled");
    } finally {
      server.stop(true);
    }
  });

  test("serves a private admin dashboard when enabled", async () => {
    const server = createTestServer(undefined, false, true);
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const aliceResponse = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "alice" })
      });
      const alicePayload = await aliceResponse.json();
      const alice = alicePayload.user as { id: string };

      await fetch(`${baseUrl}/content`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorId: alice.id, body: "hello from admin test" })
      });

      const htmlResponse = await fetch(`${baseUrl}/admin`);
      const html = await htmlResponse.text();
      expect(htmlResponse.status).toBe(200);
      expect(html).toContain("Lento Control Room");

      const overviewResponse = await fetch(`${baseUrl}/admin/api/overview`);
      const overview = await overviewResponse.json();
      expect(overview.summary.totalActors).toBe(1);
      expect(overview.summary.totalContent).toBe(1);
      expect(overview.transport.pushIntervalMs).toBe(4000);

      const actorsResponse = await fetch(`${baseUrl}/admin/api/actors`);
      const actors = await actorsResponse.json();
      expect(actors.actors).toHaveLength(1);
      expect(actors.actors[0].handle).toBe("alice");

      const contentResponse = await fetch(`${baseUrl}/admin/api/content`);
      const content = await contentResponse.json();
      expect(content.content).toHaveLength(1);
      expect(content.content[0].authorHandle).toBe("alice");

      const snapshotResponse = await fetch(`${baseUrl}/admin/api/snapshot`);
      const snapshot = await snapshotResponse.json();
      expect(snapshot.summary.totalActors).toBe(1);
      expect(snapshot.transport.adminSubscribers).toBeTypeOf("number");
    } finally {
      server.stop(true);
    }
  });

  test("streams admin snapshots over Bun websocket transport", async () => {
    const server = createHttpServer(
      new ProtocolService({
        ...DEFAULT_PROTOCOL_CONFIG,
        serverSecret: "test-secret"
      }),
      {
        port: 0,
        enableAdminUi: true,
        adminStreamIntervalMs: 10000
      }
    );
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/admin/ws`);

    try {
      await waitForSocketOpen(socket);

      const initialPayload = (await waitForSocketMessage(socket)) as {
        type: string;
        snapshot: { summary: { totalActors: number } };
      };
      expect(initialPayload.type).toBe("snapshot");
      expect(initialPayload.snapshot.summary.totalActors).toBe(0);

      const firstMessage = waitForSocketMessage(socket);
      socket.send(JSON.stringify({ type: "snapshot" }));
      const firstPayload = (await firstMessage) as {
        type: string;
        snapshot: { summary: { totalActors: number } };
      };

      expect(firstPayload.type).toBe("snapshot");
      expect(firstPayload.snapshot.summary.totalActors).toBe(0);

      const secondMessage = waitForSocketMessage(socket);
      await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "socket_alice" })
      });

      const secondPayload = (await secondMessage) as {
        type: string;
        snapshot: {
          summary: { totalActors: number };
          transport: { adminSubscribers: number };
        };
      };

      expect(secondPayload.type).toBe("snapshot");
      expect(secondPayload.snapshot.summary.totalActors).toBe(1);
      expect(secondPayload.snapshot.transport.adminSubscribers).toBeGreaterThanOrEqual(1);
    } finally {
      socket.close();
      server.stop(true);
    }
  });
});
