import { describe, expect, test } from "bun:test";
import { ProtocolError } from "@lento/core";
import { Effect } from "effect";
import {
  createIdentityVerifierFromConfig,
  DevMoltbookIdentityVerifier,
  HttpMoltbookIdentityVerifier,
  loadIdentityVerifierConfig,
  resolveAuthenticatedIdentity
} from "./moltbook-identity";

describe("resolveAuthenticatedIdentity", () => {
  test("returns undefined when the header is absent", async () => {
    const request = new Request("http://localhost/health");

    await expect(resolveAuthenticatedIdentity(request)).resolves.toBeUndefined();
  });

  test("throws when identity verification is not configured", async () => {
    const request = new Request("http://localhost/identity/me", {
      headers: {
        "x-moltbook-identity": "token"
      }
    });

    await expect(resolveAuthenticatedIdentity(request)).rejects.toMatchObject({
      code: "identity_not_configured",
      status: 503
    } satisfies Partial<ProtocolError>);
  });

  test("returns verified identity from the injected verifier", async () => {
    const request = new Request("http://localhost/identity/me", {
      headers: {
        "x-moltbook-identity": "valid-token"
      }
    });

    const identity = await resolveAuthenticatedIdentity(request, {
      verifier: {
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

    expect(identity).toEqual({
      provider: "moltbook",
      id: "agt_1",
      name: "Atlas"
    });
  });
});

describe("HttpMoltbookIdentityVerifier", () => {
  test("maps the Moltbook verify response", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          valid: true,
          agent: {
            id: "agt_1",
            name: "Atlas",
            description: "Test agent",
            avatarUrl: "https://example.com/atlas.png",
            karma: 7,
            claimed: true,
            owner: {
              xHandle: "sbaidon"
            }
          }
        }),
        { status: 200 }
      );
    };

    const verifier = new HttpMoltbookIdentityVerifier(
      "app-key",
      fetcher,
      "https://www.moltbook.com"
    );
    const identity = await verifier.verify("identity-token");

    expect(calls[0]?.url).toBe("https://www.moltbook.com/api/v1/agents/verify-identity");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({
      "content-type": "application/json",
      "x-moltbook-app-key": "app-key"
    });
    expect(identity).toEqual({
      provider: "moltbook",
      id: "agt_1",
      name: "Atlas",
      description: "Test agent",
      avatarUrl: "https://example.com/atlas.png",
      karma: 7,
      isClaimed: true,
      createdAt: undefined,
      followerCount: undefined,
      owner: {
        xHandle: "sbaidon"
      }
    });
  });

  test("returns null for invalid identity payloads", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ valid: false }), { status: 200 });

    const verifier = new HttpMoltbookIdentityVerifier("app-key", fetcher);
    await expect(verifier.verify("identity-token")).resolves.toBeNull();
  });
});

describe("DevMoltbookIdentityVerifier", () => {
  test("maps local dev tokens into Moltbook-shaped identities", async () => {
    const verifier = new DevMoltbookIdentityVerifier();
    await expect(verifier.verify("dev:atlas-builder:Atlas%20Builder")).resolves.toEqual({
      provider: "moltbook",
      id: "atlas-builder",
      name: "Atlas Builder"
    });
  });
});

describe("identity verifier config", () => {
  test("loads verifier config from env through Effect", () => {
    const config = Effect.runSync(
      loadIdentityVerifierConfig({
        MOLTBOOK_APP_KEY: "app-key",
        MOLTBOOK_API_BASE_URL: "https://verify.example",
        LENTO_DEV_IDENTITY_MODE: "true"
      })
    );

    expect(config).toEqual({
      appKey: "app-key",
      baseUrl: "https://verify.example",
      devIdentityMode: true
    });
  });

  test("creates the appropriate verifier from config", () => {
    expect(
      createIdentityVerifierFromConfig({
        appKey: undefined,
        baseUrl: "https://www.moltbook.com",
        devIdentityMode: true
      })
    ).toBeInstanceOf(DevMoltbookIdentityVerifier);

    expect(
      createIdentityVerifierFromConfig({
        appKey: "app-key",
        baseUrl: "https://verify.example",
        devIdentityMode: false
      })
    ).toBeInstanceOf(HttpMoltbookIdentityVerifier);
  });
});
