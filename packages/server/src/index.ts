import { DEFAULT_PROTOCOL_CONFIG, InMemoryStore, ProtocolService, SqliteStore } from "@lento/core";
import { Effect } from "effect";
import { createHttpServer } from "./api/server";
import {
  createIdentityVerifierFromConfig,
  loadIdentityVerifierConfig
} from "./api/moltbook-identity";
import { loadServerRuntimeConfig } from "./config";

const startServer = Effect.gen(function* () {
  const runtimeConfig = yield* loadServerRuntimeConfig();
  const identityConfig = yield* loadIdentityVerifierConfig();
  const store = runtimeConfig.databasePath
    ? new SqliteStore({ path: runtimeConfig.databasePath })
    : new InMemoryStore();

  const service = new ProtocolService(
    {
      ...DEFAULT_PROTOCOL_CONFIG,
      serverSecret: runtimeConfig.secret
    },
    store
  );

  const identityVerifier = createIdentityVerifierFromConfig(identityConfig);
  const server = createHttpServer(service, {
    port: runtimeConfig.port,
    hostname: runtimeConfig.hostname,
    idleTimeout: runtimeConfig.idleTimeout,
    development: runtimeConfig.development,
    adminStreamIntervalMs: runtimeConfig.adminStreamIntervalMs,
    identityVerifier,
    requireIdentityForWrites: runtimeConfig.requireIdentityForWrites,
    enableAdminUi: runtimeConfig.enableAdminUi
  });

  yield* Effect.sync(() => {
    const host = runtimeConfig.hostname ?? "localhost";
    console.log(
      `Lento protocol server running at http://${host}:${server.port}${identityVerifier ? " with Moltbook identity verification" : ""}${runtimeConfig.requireIdentityForWrites ? " and write auth required" : ""}${runtimeConfig.enableAdminUi ? " and admin ui enabled at /admin" : ""}${runtimeConfig.enableAdminUi ? ` (ws push every ${runtimeConfig.adminStreamIntervalMs}ms)` : ""}${runtimeConfig.idleTimeout !== undefined ? ` idleTimeout=${runtimeConfig.idleTimeout}s` : ""}${runtimeConfig.development ? " development=true" : ""}` +
        `${runtimeConfig.databasePath ? ` sqlite=${runtimeConfig.databasePath}` : " store=in-memory"}`
    );
  });

  return server;
});

try {
  Effect.runSync(startServer);
} catch (error) {
  console.error("Failed to start Lento protocol server", error);
  process.exit(1);
}
