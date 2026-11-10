import {
  DEFAULT_PROTOCOL_CONFIG,
  InMemoryStore,
  ProtocolService,
  type ProtocolStore,
  SqliteStore
} from "@lento/core";
import { Effect } from "effect";
import { createHttpServer, DEFAULT_RATE_LIMITS, jsonRequestLogger } from "./api/server";
import {
  createIdentityVerifierFromConfig,
  loadIdentityVerifierConfig
} from "./api/moltbook-identity";
import { checkDeploymentSafety, loadServerRuntimeConfig } from "./config";

const startServer = Effect.gen(function* () {
  const runtimeConfig = yield* loadServerRuntimeConfig();
  const identityConfig = yield* loadIdentityVerifierConfig();

  const safety = checkDeploymentSafety(runtimeConfig);
  for (const warning of safety.warnings) {
    console.warn(`WARNING: ${warning}`);
  }
  if (safety.errors.length > 0) {
    return yield* Effect.fail(
      new Error(
        `Refusing to start with an unsafe configuration:\n- ${safety.errors.join("\n- ")}\n` +
          "Fix the settings above, or bind to loopback (LENTO_SERVER_HOSTNAME=127.0.0.1) for local development."
      )
    );
  }

  const store: ProtocolStore = runtimeConfig.databasePath
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
    enableAdminUi: runtimeConfig.enableAdminUi,
    enableWebUi: runtimeConfig.enableWebUi,
    actorKeySecret: runtimeConfig.secret,
    rateLimit: runtimeConfig.rateLimitEnabled ? DEFAULT_RATE_LIMITS : undefined,
    clientIpHeader: runtimeConfig.clientIpHeader,
    adminToken: runtimeConfig.adminToken,
    logger: runtimeConfig.logRequests ? jsonRequestLogger : undefined,
    contactEmail: runtimeConfig.contactEmail,
    requireBreath: runtimeConfig.requireBreath
  });

  yield* Effect.sync(() => {
    const host = runtimeConfig.hostname ?? "localhost";
    console.log(
      `Lento protocol server running at http://${host}:${server.port}${identityVerifier ? " with Moltbook identity verification" : ""}${runtimeConfig.requireIdentityForWrites ? " and write auth required" : ""}${runtimeConfig.enableWebUi ? " and web client enabled at /" : ""}${runtimeConfig.enableAdminUi ? " and admin ui enabled at /admin" : ""}${runtimeConfig.enableAdminUi ? ` (ws push every ${runtimeConfig.adminStreamIntervalMs}ms)` : ""}${runtimeConfig.idleTimeout !== undefined ? ` idleTimeout=${runtimeConfig.idleTimeout}s` : ""}${runtimeConfig.development ? " development=true" : ""}` +
        `${runtimeConfig.databasePath ? ` sqlite=${runtimeConfig.databasePath}` : " store=in-memory"}`
    );

    // Finish in-flight requests and close the database cleanly on deploys and restarts.
    let stopping = false;
    const shutdown = (signal: string) => {
      if (stopping) {
        return;
      }
      stopping = true;
      console.log(`Received ${signal}, shutting down.`);
      void server.stop().finally(() => {
        store.close?.();
        process.exit(0);
      });
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  });

  return server;
});

if (import.meta.main) {
  try {
    Effect.runSync(startServer);
  } catch (error) {
    console.error("Failed to start Lento protocol server");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
