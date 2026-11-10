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

  test("serves the human web client at the root only when enabled", async () => {
    const service = new ProtocolService({
      ...DEFAULT_PROTOCOL_CONFIG,
      serverSecret: "test-secret"
    });
    const enabled = createHttpServer(service, { port: 0, enableWebUi: true });
    const disabled = createTestServer();

    try {
      const response = await fetch(`http://127.0.0.1:${enabled.port}/`);
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(html).toContain("The Slow Network");
      expect(html).toContain('id="breath"');

      const missing = await fetch(`http://127.0.0.1:${disabled.port}/`);
      expect(missing.status).toBe(404);
    } finally {
      enabled.stop(true);
      disabled.stop(true);
    }
  });

  test("feed items carry the author handle and kind", async () => {
    const server = createTestServer();
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const post = (path: string, body: unknown) =>
      fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }).then((response) => response.json());

    try {
      const { user: alice } = await post("/users", { handle: "alice" });
      const { user: bob } = await post("/users", { handle: "bob" });
      await post("/content", { authorId: alice.id, body: "slow hello" });

      const response = await fetch(`${baseUrl}/feed/${bob.id}`);
      const payload = await response.json();
      expect(payload.feed).toHaveLength(1);
      expect(payload.feed[0].authorHandle).toBe("alice");
      expect(payload.feed[0].authorKind).toBe("user");
      expect(payload.feed[0].content.body).toBe("slow hello");
    } finally {
      server.stop(true);
    }
  });

  describe("actor keys and sponsored agents", () => {
    function createKeyServer(requireIdentityForWrites = true) {
      const service = new ProtocolService({
        ...DEFAULT_PROTOCOL_CONFIG,
        serverSecret: "test-secret"
      });
      const server = createHttpServer(service, {
        port: 0,
        requireIdentityForWrites,
        actorKeySecret: "key-secret"
      });
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const call = async (method: string, path: string, body?: unknown, key?: string) => {
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            ...(body === undefined ? {} : { "content-type": "application/json" }),
            ...(key ? { authorization: `Bearer ${key}` } : {})
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, data: await response.json() };
      };
      return { server, call };
    }

    test("signup returns a key that gates writes to that user", async () => {
      const { server, call } = createKeyServer();
      try {
        const alice = await call("POST", "/users", { handle: "alice" });
        const bob = await call("POST", "/users", { handle: "bob" });
        expect(alice.status).toBe(201);
        expect(alice.data.key).toStartWith(`lento_${alice.data.user.id}.`);

        const me = await call("GET", "/me", undefined, alice.data.key);
        expect(me.data.actor.handle).toBe("alice");
        expect((await call("GET", "/me")).status).toBe(401);

        const anonymous = await call("POST", "/content", {
          authorId: alice.data.user.id,
          body: "no key"
        });
        expect(anonymous.status).toBe(401);
        expect(anonymous.data.error.code).toBe("identity_required");

        const forged = await call(
          "POST",
          "/content",
          { body: "forged" },
          `lento_${alice.data.user.id}.AAAA`
        );
        expect(forged.status).toBe(401);
        expect(forged.data.error.code).toBe("key_invalid");

        const impersonation = await call(
          "POST",
          "/content",
          { authorId: alice.data.user.id, body: "as alice" },
          bob.data.key
        );
        expect(impersonation.status).toBe(403);
        expect(impersonation.data.error.code).toBe("actor_forbidden");

        const posted = await call("POST", "/content", { body: "as myself" }, alice.data.key);
        expect(posted.status).toBe(201);
        expect(posted.data.content.authorId).toBe(alice.data.user.id);
      } finally {
        server.stop(true);
      }
    });

    test("a human sponsors, pays for, and can disable an agent", async () => {
      const { server, call } = createKeyServer();
      try {
        const alice = await call("POST", "/users", { handle: "alice" });
        const bob = await call("POST", "/users", { handle: "bob" });
        const aliceKey = alice.data.key as string;
        const post = await call("POST", "/content", { body: "human post" }, bob.data.key);

        expect((await call("POST", "/agents", { handle: "helper" })).status).toBe(401);

        const created = await call("POST", "/agents", { handle: "helper" }, aliceKey);
        expect(created.status).toBe(201);
        expect(created.data.agent.sponsorId).toBe(alice.data.user.id);
        const agentKey = created.data.key as string;
        const agentId = created.data.agent.id as string;

        // Agents cannot sponsor agents.
        const nested = await call("POST", "/agents", { handle: "nested" }, agentKey);
        expect(nested.status).toBe(403);
        expect(nested.data.error.code).toBe("sponsor_must_be_human");

        const agentPost = await call("POST", "/content", { body: "agent post" }, agentKey);
        expect(agentPost.status).toBe(201);
        const reaction = await call(
          "POST",
          "/interactions",
          { targetContentId: post.data.content.id, kind: "react", clientNonce: "n1" },
          agentKey
        );
        expect(reaction.status).toBe(201);

        const sponsor = await call("GET", `/users/${alice.data.user.id}`);
        expect(sponsor.data.user.energy.current).toBeLessThan(alice.data.user.energy.current);

        const vouch = await call("POST", "/vouches", { toActorId: bob.data.user.id }, agentKey);
        expect(vouch.status).toBe(403);
        expect(vouch.data.error.code).toBe("agent_cannot_vouch");

        const feed = await call("GET", `/feed/${bob.data.user.id}`);
        const agentItem = feed.data.feed.find(
          (item: { content: { authorId: string } }) => item.content.authorId === agentId
        );
        expect(agentItem.authorKind).toBe("agent");
        expect(agentItem.authorSponsorHandle).toBe("alice");

        const listed = await call("GET", `/agents?sponsorId=${alice.data.user.id}`);
        expect(listed.data.agents).toHaveLength(1);

        const notSponsor = await call(
          "POST",
          `/agents/${agentId}/disable`,
          undefined,
          bob.data.key
        );
        expect(notSponsor.status).toBe(403);

        const disabled = await call("POST", `/agents/${agentId}/disable`, undefined, aliceKey);
        expect(disabled.status).toBe(200);
        expect(disabled.data.agent.disabledAt).toBeTypeOf("number");

        const afterDisable = await call("POST", "/content", { body: "still here" }, agentKey);
        expect(afterDisable.status).toBe(403);
        expect(afterDisable.data.error.code).toBe("agent_disabled");
      } finally {
        server.stop(true);
      }
    });
  });

  test("hardening: rate limits, body limit, security headers, admin auth, logging", async () => {
    const service = new ProtocolService({
      ...DEFAULT_PROTOCOL_CONFIG,
      serverSecret: "test-secret"
    });
    const logged: Array<{ path: string; status: number; ip: string }> = [];
    const server = createHttpServer(service, {
      port: 0,
      enableWebUi: true,
      enableAdminUi: true,
      adminToken: "admin-token",
      contactEmail: "hello@lento.social",
      clientIpHeader: "x-test-ip",
      maxRequestBodyBytes: 2048,
      rateLimit: {
        signup: { limit: 2, windowMs: 60_000 },
        write: { limit: 100, windowMs: 60_000 },
        read: { limit: 100, windowMs: 60_000 }
      },
      logger: (entry) => logged.push(entry)
    });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const signup = (handle: string, ip: string) =>
      fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-ip": ip },
        body: JSON.stringify({ handle })
      });

    try {
      expect((await signup("one", "198.51.100.1")).status).toBe(201);
      expect((await signup("two", "198.51.100.1")).status).toBe(201);
      const limited = await signup("three", "198.51.100.1");
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect((await limited.json()).error.code).toBe("rate_limited");
      // A different client is not affected.
      expect((await signup("four", "198.51.100.2")).status).toBe(201);

      const oversized = await fetch(`${baseUrl}/content`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorId: "usr_x", body: "x".repeat(5000) })
      });
      expect(oversized.status).toBe(413);

      const page = await fetch(`${baseUrl}/`, { headers: { "x-forwarded-proto": "https" } });
      expect(page.headers.get("x-content-type-options")).toBe("nosniff");
      expect(page.headers.get("x-frame-options")).toBe("DENY");
      expect(page.headers.get("strict-transport-security")).toContain("max-age=");
      const csp = page.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("script-src 'sha256-");
      expect(csp).not.toContain("unsafe-inline");
      expect(await page.text()).not.toContain(' style="');

      const about = await fetch(`${baseUrl}/about`);
      expect(about.status).toBe(200);
      expect(await about.text()).toContain("mailto:hello@lento.social");

      const noAuth = await fetch(`${baseUrl}/admin/api/overview`);
      expect(noAuth.status).toBe(401);
      expect(noAuth.headers.get("www-authenticate")).toContain("Basic");
      const authed = await fetch(`${baseUrl}/admin/api/overview`, {
        headers: { authorization: `Basic ${btoa("admin:admin-token")}` }
      });
      expect(authed.status).toBe(200);

      expect(logged.some((entry) => entry.path === "/users" && entry.status === 429)).toBe(true);
      expect(logged.find((entry) => entry.path === "/users")?.ip).toBe("198.51.100.1");
    } finally {
      server.stop(true);
    }
  });

  test("required breath gates posts and interactions with a single-use pass", async () => {
    const service = new ProtocolService({
      ...DEFAULT_PROTOCOL_CONFIG,
      serverSecret: "test-secret"
    });
    const server = createHttpServer(service, {
      port: 0,
      requireIdentityForWrites: true,
      actorKeySecret: "key-secret",
      requireBreath: true,
      breathConfig: { minDelayMs: 60, maxDelayMs: 60, windowMs: 400, graceMs: 20, passTtlMs: 5000 }
    });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const call = async (
      path: string,
      body: unknown,
      key?: string,
      pass?: string
    ): Promise<{ status: number; data: any }> => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
          ...(pass ? { "x-lento-breath": pass } : {})
        },
        body: JSON.stringify(body)
      });
      return { status: response.status, data: await response.json() };
    };
    const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

    try {
      const alice = await call("/users", { handle: "alice" });
      const bob = await call("/users", { handle: "bob" });
      const aliceKey = alice.data.key as string;

      const noBreath = await call("/content", { body: "too fast" }, aliceKey);
      expect(noBreath.status).toBe(428);
      expect(noBreath.data.error.code).toBe("breath_required");

      expect((await call("/breath", {})).status).toBe(401);

      const rushed = await call("/breath", {}, aliceKey);
      expect(rushed.status).toBe(201);
      expect(rushed.data.breath.readyInMs).toBe(60);
      const tooEarly = await call(`/breath/${rushed.data.breath.id}/confirm`, {}, aliceKey);
      expect(tooEarly.status).toBe(409);
      expect(tooEarly.data.error.code).toBe("breath_too_early");

      const begun = await call("/breath", {}, aliceKey);
      await wait(90);
      const stolen = await call(`/breath/${begun.data.breath.id}/confirm`, {}, bob.data.key);
      expect(stolen.status).toBe(404);
      const confirmed = await call(`/breath/${begun.data.breath.id}/confirm`, {}, aliceKey);
      expect(confirmed.status).toBe(200);
      const pass = confirmed.data.pass as string;

      const asBob = await call("/content", { body: "borrowed breath" }, bob.data.key, pass);
      expect(asBob.status).toBe(428);

      const posted = await call("/content", { body: "worth the wait" }, aliceKey, pass);
      expect(posted.status).toBe(201);

      const reused = await call(
        "/interactions",
        { targetContentId: posted.data.content.id, kind: "react" },
        aliceKey,
        pass
      );
      expect(reused.status).toBe(428);

      const missed = await call("/breath", {}, aliceKey);
      await wait(60 + 400 + 20 + 80);
      const late = await call(`/breath/${missed.data.breath.id}/confirm`, {}, aliceKey);
      expect(late.status).toBe(410);
      expect(late.data.error.code).toBe("breath_missed");

      // Reporting abuse is never slowed down.
      const report = await call(
        "/abuse-reports",
        { targetActorId: bob.data.user.id, severity: 1 },
        aliceKey
      );
      expect(report.status).toBe(201);
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
