import { describe, expect, test } from "bun:test";
import { LentoApiClient } from "./lento-api-client";

describe("LentoApiClient", () => {
  test("createUser posts handle and returns user payload", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          user: {
            id: "usr_1",
            handle: "alice",
            trustScore: 0.5,
            createdAt: 1000,
            energy: {
              current: 10,
              max: 10,
              regenPerHour: 1,
              updatedAt: 1000
            },
            stats: {
              interactions: 0,
              abuseReports: 0,
              vouchesGiven: 0,
              vouchesReceived: 0
            }
          }
        }),
        {
          status: 201
        }
      );
    };

    const api = new LentoApiClient("http://localhost:3000", fetcher);
    const user = await api.createUser("alice");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://localhost:3000/users");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({ "content-type": "application/json" });
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ handle: "alice" }));
    expect(user.id).toBe("usr_1");
  });

  test("surfaces protocol errors with code and message", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "duplicate_handle",
            message: "Handle already exists."
          }
        }),
        {
          status: 409
        }
      );

    const api = new LentoApiClient("http://localhost:3000", fetcher);
    await expect(api.createUser("alice")).rejects.toThrow(
      "duplicate_handle: Handle already exists."
    );
  });

  test("adds feed limit query parameter", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ feed: [] }), { status: 200 });
    };

    const api = new LentoApiClient("http://localhost:3000", fetcher);
    await api.getFeed("usr_42", 15);

    expect(calls[0]).toBe("http://localhost:3000/feed/usr_42?limit=15");
  });

  test("sends moltbook identity token when configured", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          identity: {
            provider: "moltbook",
            id: "agt_1",
            name: "Atlas"
          }
        }),
        { status: 200 }
      );
    };

    const api = new LentoApiClient("http://localhost:3000", {
      fetcher,
      moltbookIdentityToken: "identity-token"
    });
    const identity = await api.getIdentity();

    expect(calls[0]?.url).toBe("http://localhost:3000/identity/me");
    expect(calls[0]?.init?.headers).toEqual({
      "content-type": "application/json",
      "x-moltbook-identity": "identity-token"
    });
    expect(identity.id).toBe("agt_1");
  });

  test("registers and fetches the authenticated agent", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      const pathname = new URL(String(input)).pathname;

      if (pathname === "/agents/register") {
        return new Response(
          JSON.stringify({
            agent: {
              id: "agt_local",
              kind: "agent",
              handle: "atlas",
              trustScore: 0.5,
              createdAt: 1000,
              verifiedAt: 1000,
              energy: {
                current: 10,
                max: 10,
                regenPerHour: 1,
                updatedAt: 1000
              },
              stats: {
                interactions: 0,
                abuseReports: 0,
                vouchesGiven: 0,
                vouchesReceived: 0
              },
              identity: {
                provider: "moltbook",
                id: "agt_1",
                name: "Atlas"
              }
            }
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          agent: {
            id: "agt_local",
            kind: "agent",
            handle: "atlas",
            trustScore: 0.5,
            createdAt: 1000,
            verifiedAt: 1000,
            energy: {
              current: 10,
              max: 10,
              regenPerHour: 1,
              updatedAt: 1000
            },
            stats: {
              interactions: 0,
              abuseReports: 0,
              vouchesGiven: 0,
              vouchesReceived: 0
            },
            identity: {
              provider: "moltbook",
              id: "agt_1",
              name: "Atlas"
            }
          }
        }),
        { status: 200 }
      );
    };

    const api = new LentoApiClient("http://localhost:3000", {
      fetcher,
      moltbookIdentityToken: "identity-token"
    });
    const registered = await api.registerAgent("atlas");
    const me = await api.getAuthenticatedAgent();

    expect(calls[0]?.url).toBe("http://localhost:3000/agents/register");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ handle: "atlas" }));
    expect(calls[1]?.url).toBe("http://localhost:3000/agents/me");
    expect(registered.id).toBe("agt_local");
    expect(me.identity.id).toBe("agt_1");
  });

  test("can derive a client with a specific Moltbook identity token", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const api = new LentoApiClient("http://localhost:3000", {
      fetcher,
      headers: {
        "x-trace-id": "trace-1"
      }
    });

    await api.withMoltbookIdentityToken("dev:atlas:Atlas").health();

    expect(calls[0]?.url).toBe("http://localhost:3000/health");
    expect(calls[0]?.init?.headers).toEqual({
      "content-type": "application/json",
      "x-trace-id": "trace-1",
      "x-moltbook-identity": "dev:atlas:Atlas"
    });
  });
});
