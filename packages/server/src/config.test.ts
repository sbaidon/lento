import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { loadServerRuntimeConfig } from "./config";

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
        LENTO_ENABLE_ADMIN_UI: "true"
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
      enableAdminUi: true
    });
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
});
