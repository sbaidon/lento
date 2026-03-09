import { DEFAULT_PROTOCOL_CONFIG } from "@lento/core";
import { Effect } from "effect";

export interface ServerRuntimeConfig {
  port: number;
  hostname?: string;
  idleTimeout?: number;
  development: boolean;
  adminStreamIntervalMs: number;
  databasePath?: string;
  secret: string;
  requireIdentityForWrites: boolean;
  enableAdminUi: boolean;
}

function parsePort(raw: string | undefined): number {
  const value = raw ?? "3000";
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`PORT must be a non-negative integer. Received '${value}'.`);
  }

  return parsed;
}

function parseOptionalNonNegativeInteger(
  raw: string | undefined,
  envName: string
): number | undefined {
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${envName} must be a non-negative integer. Received '${raw}'.`);
  }

  return parsed;
}

function parseBoolean(raw: string | undefined): boolean {
  return raw === "true";
}

export function loadServerRuntimeConfig(
  env: Record<string, string | undefined> = Bun.env
): Effect.Effect<ServerRuntimeConfig, Error> {
  return Effect.try({
    try: () => ({
      port: parsePort(env.PORT),
      hostname: env.LENTO_SERVER_HOSTNAME,
      idleTimeout: parseOptionalNonNegativeInteger(
        env.LENTO_SERVER_IDLE_TIMEOUT_SECONDS,
        "LENTO_SERVER_IDLE_TIMEOUT_SECONDS"
      ),
      development: parseBoolean(env.LENTO_SERVER_DEVELOPMENT),
      adminStreamIntervalMs:
        parseOptionalNonNegativeInteger(
          env.LENTO_ADMIN_STREAM_INTERVAL_MS,
          "LENTO_ADMIN_STREAM_INTERVAL_MS"
        ) ?? 4000,
      databasePath: env.LENTO_DATABASE_PATH,
      secret: env.LENTO_SERVER_SECRET ?? DEFAULT_PROTOCOL_CONFIG.serverSecret,
      requireIdentityForWrites: parseBoolean(env.LENTO_REQUIRE_IDENTITY_FOR_WRITES),
      enableAdminUi: parseBoolean(env.LENTO_ENABLE_ADMIN_UI)
    }),
    catch: (error) => (error instanceof Error ? error : new Error(String(error)))
  });
}
