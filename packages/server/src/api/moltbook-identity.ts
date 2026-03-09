import { ProtocolError, type MoltbookIdentity } from "@lento/core";
import { Effect } from "effect";

export const MOLTBOOK_IDENTITY_HEADER = "x-moltbook-identity";

interface MoltbookVerifyResponse {
  valid?: boolean;
  agent?: {
    id?: string;
    name?: string;
    description?: string;
    avatarUrl?: string;
    karma?: number;
    claimed?: boolean;
    createdAt?: string;
    followerCount?: number;
    owner?: {
      xHandle?: string;
      xName?: string;
      xVerified?: boolean;
      xFollowerCount?: number;
    };
  };
}

export interface MoltbookIdentityVerifier {
  verify(token: string): Promise<MoltbookIdentity | null>;
}

export interface IdentityVerifierConfig {
  appKey?: string;
  baseUrl: string;
  devIdentityMode: boolean;
}

export class DevMoltbookIdentityVerifier implements MoltbookIdentityVerifier {
  async verify(token: string): Promise<MoltbookIdentity | null> {
    const [prefix, id, encodedName] = token.split(":", 3);
    if (prefix !== "dev" || !id || !encodedName) {
      return null;
    }

    return {
      provider: "moltbook",
      id,
      name: decodeURIComponent(encodedName)
    };
  }
}

export class HttpMoltbookIdentityVerifier implements MoltbookIdentityVerifier {
  constructor(
    private readonly appKey: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = "https://www.moltbook.com"
  ) {}

  async verify(token: string): Promise<MoltbookIdentity | null> {
    return Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          this.fetcher(new URL("/api/v1/agents/verify-identity", this.baseUrl), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-moltbook-app-key": this.appKey
            },
            body: JSON.stringify({ token })
          }),
        catch: (error) => {
          const message = error instanceof Error ? error.message : "Identity verification failed.";
          return new ProtocolError("identity_verification_failed", 502, message);
        }
      }).pipe(
        Effect.flatMap((response) => {
          if (!response.ok) {
            return Effect.fail(
              new ProtocolError(
                "identity_verification_failed",
                502,
                `Moltbook verification failed with status ${response.status}.`
              )
            );
          }

          return Effect.tryPromise({
            try: () => response.json() as Promise<MoltbookVerifyResponse>,
            catch: () =>
              new ProtocolError(
                "identity_verification_failed",
                502,
                "Moltbook verification returned invalid JSON."
              )
          });
        }),
        Effect.map((payload) => {
          if (!payload.valid || !payload.agent?.id || !payload.agent.name) {
            return null;
          }

          return {
            provider: "moltbook" as const,
            id: payload.agent.id,
            name: payload.agent.name,
            description: payload.agent.description,
            avatarUrl: payload.agent.avatarUrl,
            karma: payload.agent.karma,
            isClaimed: payload.agent.claimed,
            createdAt: payload.agent.createdAt,
            followerCount: payload.agent.followerCount,
            owner: payload.agent.owner
          };
        })
      )
    );
  }
}

export interface ResolveIdentityOptions {
  verifier?: MoltbookIdentityVerifier;
}

export function resolveAuthenticatedIdentityEffect(
  request: Request,
  options: ResolveIdentityOptions = {}
): Effect.Effect<MoltbookIdentity | undefined, ProtocolError> {
  const token = request.headers.get(MOLTBOOK_IDENTITY_HEADER);
  if (!token) {
    return Effect.succeed(undefined);
  }

  if (!options.verifier) {
    return Effect.fail(
      new ProtocolError(
        "identity_not_configured",
        503,
        "Moltbook identity verification is not configured on this server."
      )
    );
  }

  return Effect.tryPromise({
    try: () => options.verifier!.verify(token),
    catch: (error) =>
      error instanceof ProtocolError
        ? error
        : new ProtocolError(
            "identity_verification_failed",
            502,
            error instanceof Error ? error.message : "Identity verification failed."
          )
  }).pipe(
    Effect.flatMap((identity) =>
      identity
        ? Effect.succeed(identity)
        : Effect.fail(
            new ProtocolError("identity_invalid", 401, "Invalid Moltbook identity token.")
          )
    )
  );
}

export async function resolveAuthenticatedIdentity(
  request: Request,
  options: ResolveIdentityOptions = {}
): Promise<MoltbookIdentity | undefined> {
  const result = await Effect.runPromise(
    Effect.either(resolveAuthenticatedIdentityEffect(request, options))
  );

  if (result._tag === "Left") {
    throw result.left;
  }

  return result.right;
}

export function loadIdentityVerifierConfig(
  env: Record<string, string | undefined> = Bun.env
): Effect.Effect<IdentityVerifierConfig> {
  return Effect.sync(() => ({
    appKey: env.MOLTBOOK_APP_KEY,
    baseUrl: env.MOLTBOOK_API_BASE_URL ?? "https://www.moltbook.com",
    devIdentityMode: env.LENTO_DEV_IDENTITY_MODE === "true"
  }));
}

export function createIdentityVerifierFromConfig(
  config: IdentityVerifierConfig
): MoltbookIdentityVerifier | undefined {
  if (!config.appKey) {
    return config.devIdentityMode ? new DevMoltbookIdentityVerifier() : undefined;
  }

  return new HttpMoltbookIdentityVerifier(config.appKey, fetch, config.baseUrl);
}

export function createIdentityVerifierFromEnv(): MoltbookIdentityVerifier | undefined {
  return createIdentityVerifierFromConfig(Effect.runSync(loadIdentityVerifierConfig()));
}
