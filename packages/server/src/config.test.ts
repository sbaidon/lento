import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { checkDeploymentSafety, loadServerRuntimeConfig } from "./config";

describe("loadServerRuntimeConfig", () => {
  test("loads defaults and feature flags from env", () => {
    const config = Effect.runSync(
      loadServerRuntimeConfig({
        PORT: "3015",
        LENTO_SERVER_HOSTNAME: "127.0.0.1",
        LENTO_SERVER_IDLE_TIMEOUT_SECONDS: "30",
        LENTO_SERVER_DEVELOPMENT: "true",
        LENTO_ADMIN_STREAM_INTERVAL_MS: "2500",
        LENTO_DATABASE_PATH: "./data/lento.sqlite",
        LENTO_SERVER_SECRET: "secret-1",
        LENTO_REQUIRE_IDENTITY_FOR_WRITES: "true",
        LENTO_ENABLE_ADMIN_UI: "true",
        LENTO_ENABLE_WEB_UI: "true",
        LENTO_ADMIN_TOKEN: "admin-1",
        LENTO_RATE_LIMIT: "off",
        LENTO_CLIENT_IP_HEADER: "Fly-Client-IP",
        LENTO_LOG_REQUESTS: "true",
        LENTO_CONTACT_EMAIL: " hello@lento.social "
      })
    );

    expect(config).toEqual({
      port: 3015,
      hostname: "127.0.0.1",
      idleTimeout: 30,
      development: true,
      adminStreamIntervalMs: 2500,
      databasePath: "./data/lento.sqlite",
      secret: "secret-1",
      requireIdentityForWrites: true,
      enableAdminUi: true,
      enableWebUi: true,
      adminToken: "admin-1",
      rateLimitEnabled: false,
      clientIpHeader: "fly-client-ip",
      logRequests: true,
      contactEmail: "hello@lento.social"
    });

    const defaults = Effect.runSync(loadServerRuntimeConfig({}));
    expect(defaults.rateLimitEnabled).toBe(true);
    expect(defaults.adminToken).toBeUndefined();
    expect(defaults.logRequests).toBe(false);
  });

  test("fails on invalid port input", () => {
    expect(() =>
      Effect.runSync(
        loadServerRuntimeConfig({
          PORT: "abc"
        })
      )
    ).toThrow("PORT must be a non-negative integer.");
  });

  test("fails on invalid Bun transport inputs", () => {
    expect(() =>
      Effect.runSync(
        loadServerRuntimeConfig({
          PORT: "3000",
          LENTO_SERVER_IDLE_TIMEOUT_SECONDS: "-1"
        })
      )
    ).toThrow("LENTO_SERVER_IDLE_TIMEOUT_SECONDS must be a non-negative integer.");
  });

  test("refuses unsafe public configurations but only warns on loopback", () => {
    const load = (env: Record<string, string>) => Effect.runSync(loadServerRuntimeConfig(env));
    const unsafe = {
      LENTO_ENABLE_ADMIN_UI: "true",
      LENTO_ENABLE_WEB_UI: "true"
    };

    const exposed = checkDeploymentSafety(load(unsafe));
    expect(exposed.errors).toHaveLength(3);
    expect(exposed.errors.join(" ")).toContain("LENTO_ADMIN_TOKEN");
    expect(exposed.errors.join(" ")).toContain("LENTO_SERVER_SECRET");
    expect(exposed.errors.join(" ")).toContain("LENTO_REQUIRE_IDENTITY_FOR_WRITES");

    const local = checkDeploymentSafety(load({ ...unsafe, LENTO_SERVER_HOSTNAME: "127.0.0.1" }));
    expect(local.errors).toHaveLength(0);
    expect(local.warnings.length).toBeGreaterThanOrEqual(3);

    const hardened = checkDeploymentSafety(
      load({
        ...unsafe,
        LENTO_ADMIN_TOKEN: "admin-token",
        LENTO_SERVER_SECRET: "a-long-random-secret",
        LENTO_REQUIRE_IDENTITY_FOR_WRITES: "true",
        LENTO_DATABASE_PATH: "/data/lento.sqlite"
      })
    );
    expect(hardened).toEqual({ errors: [], warnings: [] });
  });
});
