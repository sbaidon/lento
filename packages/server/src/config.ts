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
  enableWebUi: boolean;
  adminToken?: string;
  rateLimitEnabled: boolean;
  clientIpHeader?: string;
  logRequests: boolean;
  contactEmail?: string;
}

function parseOptionalString(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value ? value : undefined;
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
      enableAdminUi: parseBoolean(env.LENTO_ENABLE_ADMIN_UI),
      enableWebUi: parseBoolean(env.LENTO_ENABLE_WEB_UI),
      adminToken: parseOptionalString(env.LENTO_ADMIN_TOKEN),
      // On unless explicitly switched off.
      rateLimitEnabled: env.LENTO_RATE_LIMIT !== "off",
      clientIpHeader: parseOptionalString(env.LENTO_CLIENT_IP_HEADER)?.toLowerCase(),
      logRequests: parseBoolean(env.LENTO_LOG_REQUESTS),
      contactEmail: parseOptionalString(env.LENTO_CONTACT_EMAIL)
    }),
    catch: (error) => (error instanceof Error ? error : new Error(String(error)))
  });
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Refuses configurations that are unsafe on a public host. A server bound to
 * loopback is treated as local development and only gets warnings.
 */
export function checkDeploymentSafety(config: ServerRuntimeConfig): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isLocal = config.hostname !== undefined && LOOPBACK_HOSTS.has(config.hostname);
  const flag = (message: string) => (isLocal ? warnings : errors).push(message);

  if (config.enableAdminUi && !config.adminToken) {
    flag("LENTO_ENABLE_ADMIN_UI is on without LENTO_ADMIN_TOKEN: the admin UI would be public.");
  }

  if (config.secret === DEFAULT_PROTOCOL_CONFIG.serverSecret) {
    flag("LENTO_SERVER_SECRET is not set: actor keys would be signed with a public default.");
  }

  if (config.enableWebUi && !config.requireIdentityForWrites) {
    flag(
      "LENTO_ENABLE_WEB_UI is on without LENTO_REQUIRE_IDENTITY_FOR_WRITES=true: anyone could write as any actor."
    );
  }

  if (!config.databasePath) {
    warnings.push("LENTO_DATABASE_PATH is not set: all data is in memory and lost on restart.");
  }

  if (!config.rateLimitEnabled) {
    warnings.push("Rate limiting is off (LENTO_RATE_LIMIT=off).");
  }

  return { errors, warnings };
}
