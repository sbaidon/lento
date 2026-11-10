import {
  HttpApp,
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse
} from "@effect/platform";
import {
  type Actor,
  type Agent,
  type MoltbookIdentity,
  ProtocolError,
  ProtocolService,
  makeProtocolRuntime,
  isProtocolError
} from "@lento/core";
import { Effect, Either } from "effect";
import { renderAdminDashboardHtml } from "../admin/dashboard";
import { renderAboutHtml } from "../web/about";
import { renderWebClientHtml } from "../web/client";
import { issueActorKey, readBearerToken, verifyActorKey } from "./actor-keys";
import {
  applySecurityHeaders,
  buildPageCsp,
  classifyRequest,
  isAdminAuthorized,
  type RateLimitConfig,
  RateLimiter,
  type RequestLogger,
  resolveClientIp
} from "./hardening";
import {
  type MoltbookIdentityVerifier,
  resolveAuthenticatedIdentityEffect
} from "./moltbook-identity";

export { ACTOR_KEY_PREFIX, issueActorKey, verifyActorKey } from "./actor-keys";
export { DEFAULT_RATE_LIMITS, jsonRequestLogger } from "./hardening";
export type { RateLimitConfig, RequestLogEntry, RequestLogger } from "./hardening";

/** Largest request body the server will read. Posts cap at 1,000 characters. */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 64 * 1024;

export {
  createIdentityVerifierFromConfig,
  createIdentityVerifierFromEnv,
  DevMoltbookIdentityVerifier,
  HttpMoltbookIdentityVerifier,
  loadIdentityVerifierConfig,
  MOLTBOOK_IDENTITY_HEADER,
  resolveAuthenticatedIdentity,
  resolveAuthenticatedIdentityEffect
} from "./moltbook-identity";
export type { IdentityVerifierConfig, MoltbookIdentityVerifier } from "./moltbook-identity";

interface ServerOptions {
  port?: number;
  hostname?: string;
  idleTimeout?: number;
  development?: boolean;
  adminStreamIntervalMs?: number;
  identityVerifier?: MoltbookIdentityVerifier;
  requireIdentityForWrites?: boolean;
  enableAdminUi?: boolean;
  enableWebUi?: boolean;
  /**
   * Secret used to issue and verify Lento actor keys. When unset, actor keys
   * are off: no key is returned on signup and bearer tokens are rejected.
   */
  actorKeySecret?: string;
  /** Per-client request limits. Off when unset. */
  rateLimit?: RateLimitConfig;
  /**
   * Header a trusted proxy sets to the real client address, such as
   * `fly-client-ip`. Leave unset when clients connect directly.
   */
  clientIpHeader?: string;
  /** Password for the admin UI and API, checked as HTTP Basic auth. */
  adminToken?: string;
  maxRequestBodyBytes?: number;
  /** Called once per finished request. */
  logger?: RequestLogger;
  /** Shown on the /about page as the address for reports and removal requests. */
  contactEmail?: string;
}

interface RequestContext {
  request: HttpServerRequest.HttpServerRequest;
  url: URL;
  authenticatedIdentity?: MoltbookIdentity;
  authenticatedAgent?: Agent;
  /** Actor proven by a Lento actor key (`Authorization: Bearer lento_...`). */
  keyActor?: Actor;
}

interface AdminTransportStats {
  pendingRequests: number;
  pendingWebSockets: number;
  adminSubscribers: number;
  pushIntervalMs: number;
}

interface AdminSnapshot {
  generatedAt: string;
  summary: {
    totalActors: number;
    totalUsers: number;
    totalAgents: number;
    totalContent: number;
    totalInteractions: number;
    totalAbuseReports: number;
    averageTrust: number;
  };
  leaders: ReturnType<typeof mapActorSummary>[];
  actors: ReturnType<typeof mapActorSummary>[];
  reports: unknown[];
  interactions: unknown[];
  content: unknown[];
  transport: AdminTransportStats;
}

interface AdminHooks {
  getSnapshotEffect: () => Effect.Effect<AdminSnapshot, unknown>;
  publishSnapshot: () => void;
}

const ADMIN_DASHBOARD_TOPIC = "admin:dashboard";
const textDecoder = new TextDecoder();

function toJson(data: unknown, status = 200): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.unsafeJson(data, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function toHtml(markup: string, status = 200): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.html(markup).pipe(
    HttpServerResponse.setStatus(status),
    HttpServerResponse.setHeader("content-type", "text/html; charset=utf-8")
  );
}

function fromSync<A>(thunk: () => A): Effect.Effect<A, unknown> {
  return Effect.try({
    try: thunk,
    catch: (error) => error
  });
}

function getRequestUrlEffect(): Effect.Effect<URL, unknown, HttpServerRequest.HttpServerRequest> {
  return Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
    Effect.flatMap(HttpServerRequest.toWeb(request), (webRequest) =>
      fromSync(() => new URL(webRequest.url))
    )
  );
}

function parseJsonEffect<T>(): Effect.Effect<
  T,
  ProtocolError,
  HttpServerRequest.HttpServerRequest
> {
  return Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
    request.json.pipe(
      Effect.map((body) => body as T),
      Effect.catchAll(() =>
        Effect.fail(new ProtocolError("invalid_json", 400, "Request body must be valid JSON."))
      )
    )
  );
}

function parseNumber(raw: string | null): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function mapActorSummary(actor: Actor) {
  return {
    id: actor.id,
    kind: actor.kind,
    handle: actor.handle,
    trustScore: actor.trustScore,
    createdAt: actor.createdAt,
    energy: actor.energy,
    stats: actor.stats,
    identity: actor.kind === "agent" ? actor.identity : undefined,
    sponsorId: actor.kind === "agent" ? actor.sponsorId : undefined,
    disabledAt: actor.kind === "agent" ? actor.disabledAt : undefined
  };
}

function requireAuthenticatedIdentityEffect(
  authenticatedIdentity?: MoltbookIdentity
): Effect.Effect<MoltbookIdentity, ProtocolError> {
  return authenticatedIdentity
    ? Effect.succeed(authenticatedIdentity)
    : Effect.fail(
        new ProtocolError("identity_missing", 401, "Missing X-Moltbook-Identity request header.")
      );
}

function requireActorId(actorId: string | undefined, fieldName: string): string {
  if (!actorId || actorId.trim().length === 0) {
    throw new ProtocolError("missing_actor", 400, `${fieldName} is required.`);
  }

  return actorId;
}

function resolveActingActorId(
  actorId: string | undefined,
  authenticatedActor: Actor | undefined,
  fieldName: string
): string {
  if (!authenticatedActor) {
    return requireActorId(actorId, fieldName);
  }

  if (actorId && actorId !== authenticatedActor.id) {
    throw new ProtocolError(
      "actor_forbidden",
      403,
      `Authenticated ${authenticatedActor.kind} '${authenticatedActor.id}' cannot act as '${actorId}'.`
    );
  }

  return authenticatedActor.id;
}

function resolveKeyActorEffect(
  runtime: ReturnType<typeof makeProtocolRuntime>,
  options: ServerOptions,
  request: Request
): Effect.Effect<Actor | undefined, unknown> {
  const token = readBearerToken(request);
  if (!token) {
    return Effect.succeed(undefined);
  }

  const invalid = new ProtocolError("key_invalid", 401, "Actor key is not valid.");
  const actorId = options.actorKeySecret
    ? verifyActorKey(options.actorKeySecret, token)
    : undefined;
  if (!actorId) {
    return Effect.fail(invalid);
  }

  // A valid signature for an actor that no longer exists is still a bad key.
  return runtime.getActor(actorId).pipe(Effect.catchAll(() => Effect.fail(invalid)));
}

function requireKeyUserEffect(context: RequestContext): Effect.Effect<Actor, ProtocolError> {
  if (!context.keyActor) {
    return Effect.fail(
      new ProtocolError("key_required", 401, "This route needs a human user's actor key.")
    );
  }

  return context.keyActor.kind === "user"
    ? Effect.succeed(context.keyActor)
    : Effect.fail(
        new ProtocolError("sponsor_must_be_human", 403, "Only human users can manage agents.")
      );
}

function isWriteMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function getPathParamEffect(
  name: string
): Effect.Effect<string, ProtocolError, HttpRouter.RouteContext> {
  return Effect.flatMap(HttpRouter.params, (params) => {
    const value = params[name];
    return value
      ? Effect.succeed(value)
      : Effect.fail(
          new ProtocolError("missing_path_param", 400, `Missing path parameter '${name}'.`)
        );
  });
}

function buildRequestContextEffect(
  runtime: ReturnType<typeof makeProtocolRuntime>,
  options: ServerOptions
): Effect.Effect<RequestContext, unknown, HttpServerRequest.HttpServerRequest> {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const webRequest = yield* HttpServerRequest.toWeb(request);
    const url = yield* fromSync(() => new URL(webRequest.url));
    const authenticatedIdentity = yield* resolveAuthenticatedIdentityEffect(webRequest, {
      verifier: options.identityVerifier
    });

    const keyActor = yield* resolveKeyActorEffect(runtime, options, webRequest);

    if (
      options.requireIdentityForWrites &&
      isWriteMethod(request.method) &&
      !authenticatedIdentity &&
      !keyActor
    ) {
      yield* Effect.fail(
        new ProtocolError(
          "identity_required",
          401,
          "Authenticated identity is required for write requests."
        )
      );
    }

    const authenticatedAgent = authenticatedIdentity
      ? yield* runtime.findAgentByIdentity(authenticatedIdentity)
      : undefined;

    return {
      request,
      url,
      authenticatedIdentity,
      authenticatedAgent,
      keyActor
    };
  });
}

/**
 * The actor a write request is authenticated as, if any. An actor key wins.
 * Otherwise a verified external identity resolves to its bound agent.
 */
function resolveActingActorEffect(
  runtime: ReturnType<typeof makeProtocolRuntime>,
  context: RequestContext
): Effect.Effect<Actor | undefined, unknown> {
  if (context.keyActor) {
    return Effect.succeed(context.keyActor);
  }

  return context.authenticatedIdentity
    ? getOrRegisterAuthenticatedAgentEffect(
        runtime,
        context.authenticatedIdentity,
        context.authenticatedAgent
      )
    : Effect.succeed(undefined);
}

function getOrRegisterAuthenticatedAgentEffect(
  runtime: ReturnType<typeof makeProtocolRuntime>,
  authenticatedIdentity: MoltbookIdentity | undefined,
  authenticatedAgent: Agent | undefined
): Effect.Effect<Agent, unknown> {
  return Effect.gen(function* () {
    const identity = yield* requireAuthenticatedIdentityEffect(authenticatedIdentity);
    if (authenticatedAgent) {
      return authenticatedAgent;
    }

    return yield* runtime.getOrRegisterAgent(identity);
  });
}

function validateIdentityHeaderEffect(
  request: Request,
  options: ServerOptions
): Effect.Effect<void, unknown> {
  return resolveAuthenticatedIdentityEffect(request, {
    verifier: options.identityVerifier
  }).pipe(Effect.asVoid);
}

function renderErrorResponse(error: unknown): HttpServerResponse.HttpServerResponse {
  if (isProtocolError(error)) {
    return toJson({ error: { code: error.code, message: error.message } }, error.status);
  }

  if (HttpServerError.isServerError(error)) {
    if (error._tag === "RouteNotFound") {
      return toJson({ error: { code: "not_found", message: "Route not found." } }, 404);
    }

    if (error._tag === "RequestError") {
      return toJson(
        {
          error: {
            code: "invalid_request",
            message: error.message
          }
        },
        400
      );
    }
  }

  console.error("Unhandled error", error);
  return toJson(
    {
      error: {
        code: "internal_error",
        message: "Unhandled server error."
      }
    },
    500
  );
}

function createAdminSnapshotEffect(
  runtime: ReturnType<typeof makeProtocolRuntime>,
  transport: AdminTransportStats
): Effect.Effect<AdminSnapshot, unknown> {
  return Effect.gen(function* () {
    const summary = yield* runtime.getNetworkSummary();
    const actors = yield* runtime.listActors();
    const reports = yield* Effect.flatMap(runtime.listAbuseReports(8), (items) =>
      Effect.forEach(items, (report) =>
        Effect.all({
          reporter: runtime.getActor(report.reporterActorId),
          target: runtime.getActor(report.targetActorId)
        }).pipe(
          Effect.map(({ reporter, target }) => ({
            ...report,
            reporter: mapActorSummary(reporter),
            target: mapActorSummary(target)
          }))
        )
      )
    );
    const interactions = yield* Effect.flatMap(runtime.listInteractions(8), (items) =>
      Effect.forEach(items, (interaction) =>
        Effect.all({
          actor: runtime.getActor(interaction.actorId),
          targetContent: runtime.getContent(interaction.targetContentId)
        }).pipe(
          Effect.map(({ actor, targetContent }) => ({
            ...interaction,
            actor: mapActorSummary(actor),
            targetContent
          }))
        )
      )
    );
    const content = yield* Effect.flatMap(runtime.listContent(), (items) =>
      Effect.forEach(items.slice(0, 8), (item) =>
        Effect.map(runtime.getActor(item.authorId), (author) => ({
          ...item,
          authorHandle: author.handle,
          authorKind: author.kind,
          authorTrust: author.trustScore
        }))
      )
    );

    return {
      generatedAt: new Date().toISOString(),
      summary,
      leaders: actors.slice(0, 5).map(mapActorSummary),
      actors: actors.map(mapActorSummary),
      reports,
      interactions,
      content,
      transport
    };
  });
}

function getAdminSnapshotEffect(
  runtime: ReturnType<typeof makeProtocolRuntime>,
  options: ServerOptions,
  adminHooks?: AdminHooks
): Effect.Effect<AdminSnapshot, unknown> {
  return adminHooks
    ? adminHooks.getSnapshotEffect()
    : createAdminSnapshotEffect(runtime, {
        pendingRequests: 0,
        pendingWebSockets: 0,
        adminSubscribers: 0,
        pushIntervalMs: options.adminStreamIntervalMs ?? 4000
      });
}

function createServerApp(
  runtime: ReturnType<typeof makeProtocolRuntime>,
  options: ServerOptions,
  adminHooks?: AdminHooks
) {
  let router = HttpRouter.empty.pipe(
    HttpRouter.get("/health", runtime.health().pipe(Effect.map((health) => toJson(health)))),
    HttpRouter.get(
      "/identity/me",
      Effect.gen(function* () {
        const context = yield* buildRequestContextEffect(runtime, options);
        const identity = yield* requireAuthenticatedIdentityEffect(context.authenticatedIdentity);
        return toJson({
          identity,
          agent: context.authenticatedAgent
        });
      })
    ),
    HttpRouter.post(
      "/agents/register",
      Effect.gen(function* () {
        const context = yield* buildRequestContextEffect(runtime, options);
        const identity = yield* requireAuthenticatedIdentityEffect(context.authenticatedIdentity);
        const body = yield* parseJsonEffect<{ handle?: string }>();
        const agent = yield* runtime.registerAgent(identity, body.handle);
        yield* Effect.sync(() => adminHooks?.publishSnapshot());
        return toJson({ agent });
      })
    ),
    HttpRouter.get(
      "/me",
      Effect.gen(function* () {
        const context = yield* buildRequestContextEffect(runtime, options);
        const actor = yield* resolveActingActorEffect(runtime, context);
        if (!actor) {
          yield* Effect.fail(
            new ProtocolError("key_required", 401, "Send an actor key to look up yourself.")
          );
        }
        return toJson({ actor });
      })
    ),
    HttpRouter.post(
      "/agents",
      Effect.gen(function* () {
        const context = yield* buildRequestContextEffect(runtime, options);
        const sponsor = yield* requireKeyUserEffect(context);
        const body = yield* parseJsonEffect<{ handle: string }>();
        const agent = yield* runtime.createSponsoredAgent(sponsor.id, body.handle);
        yield* Effect.sync(() => adminHooks?.publishSnapshot());
        // actorKeySecret is set here: requireKeyUserEffect only passes with a verified key.
        const key = issueActorKey(options.actorKeySecret ?? "", agent.id);
        return toJson({ agent, key }, 201);
      })
    ),
    HttpRouter.get(
      "/agents",
      Effect.gen(function* () {
        const url = yield* getRequestUrlEffect();
        const sponsorId = yield* fromSync(() =>
          requireActorId(url.searchParams.get("sponsorId") ?? undefined, "sponsorId")
        );
        const agents = yield* runtime.listSponsoredAgents(sponsorId);
        return toJson({ agents });
      })
    ),
    HttpRouter.post(
      "/agents/:agentId/disable",
      Effect.gen(function* () {
        const context = yield* buildRequestContextEffect(runtime, options);
        const sponsor = yield* requireKeyUserEffect(context);
        const agentId = yield* getPathParamEffect("agentId");
        const agent = yield* runtime.disableAgent(sponsor.id, agentId);
        yield* Effect.sync(() => adminHooks?.publishSnapshot());
        return toJson({ agent });
      })
    ),
    HttpRouter.get(
      "/agents/me",
      Effect.gen(function* () {
        const context = yield* buildRequestContextEffect(runtime, options);
        const agent = yield* getOrRegisterAuthenticatedAgentEffect(
          runtime,
          context.authenticatedIdentity,
          context.authenticatedAgent
        );
        return toJson({ agent });
      })
    ),
    HttpRouter.get(
      "/agents/:agentId",
      Effect.gen(function* () {
        const agentId = yield* getPathParamEffect("agentId");
        const agent = yield* runtime.getAgent(agentId);
        return toJson({ agent });
      })
    ),
    HttpRouter.post(
      "/users",
      Effect.gen(function* () {
        // With identity-gated writes, signing up only makes sense when the
        // server can hand the new user a key to authenticate with.
        if (options.requireIdentityForWrites && !options.actorKeySecret) {
          yield* Effect.fail(
            new ProtocolError(
              "user_mode_disabled",
              403,
              "Local user creation is disabled when identity-gated writes are enabled."
            )
          );
        }

        const body = yield* parseJsonEffect<{ handle: string }>();
        const user = yield* runtime.createUser(body.handle);
        yield* Effect.sync(() => adminHooks?.publishSnapshot());
        const key = options.actorKeySecret
          ? issueActorKey(options.actorKeySecret, user.id)
          : undefined;
        return toJson({ user, key }, 201);
      })
    ),
    HttpRouter.get(
      "/users/:userId",
      Effect.gen(function* () {
        const userId = yield* getPathParamEffect("userId");
        const user = yield* runtime.getUser(userId);
        return toJson({ user });
      })
    ),
    HttpRouter.post(
      "/content",
      Effect.gen(function* () {
        const context = yield* buildRequestContextEffect(runtime, options);
        const body = yield* parseJsonEffect<{
          authorId?: string;
          actorId?: string;
          body: string;
        }>();
        const actingAgent = yield* resolveActingActorEffect(runtime, context);
        const authorId = yield* fromSync(() =>
          resolveActingActorId(body.authorId ?? body.actorId, actingAgent, "authorId")
        );
        const content = yield* runtime.createContent(authorId, body.body);
        yield* Effect.sync(() => adminHooks?.publishSnapshot());
        return toJson({ content }, 201);
      })
    ),
    HttpRouter.get(
      "/content",
      Effect.gen(function* () {
        const url = yield* getRequestUrlEffect();
        const authorId =
          url.searchParams.get("authorId") ?? url.searchParams.get("actorId") ?? undefined;
        const content = yield* runtime.listContent(authorId);
        return toJson({ content });
      })
    ),
    HttpRouter.get(
      "/content/:contentId",
      Effect.gen(function* () {
        const contentId = yield* getPathParamEffect("contentId");
        const content = yield* runtime.getContent(contentId);
        return toJson({ content });
      })
    ),
    HttpRouter.post(
      "/vouches",
      Effect.gen(function* () {
        const context = yield* buildRequestContextEffect(runtime, options);
        const body = yield* parseJsonEffect<{
          fromActorId?: string;
          fromUserId?: string;
          toActorId?: string;
          toUserId?: string;
          stake?: number;
        }>();
        const actingAgent = yield* resolveActingActorEffect(runtime, context);
        const fromActorId = yield* fromSync(() =>
          resolveActingActorId(body.fromActorId ?? body.fromUserId, actingAgent, "fromActorId")
        );
        const toActorId = yield* fromSync(() =>
          requireActorId(body.toActorId ?? body.toUserId, "toActorId")
        );
        const response = yield* runtime.createVouch(fromActorId, toActorId, body.stake);
        yield* Effect.sync(() => adminHooks?.publishSnapshot());
        return toJson(response, 201);
      })
    ),
    HttpRouter.post(
      "/abuse-reports",
      Effect.gen(function* () {
        const context = yield* buildRequestContextEffect(runtime, options);
        const body = yield* parseJsonEffect<{
          reporterActorId?: string;
          reporterUserId?: string;
          targetActorId?: string;
          targetUserId?: string;
          severity: 1 | 2 | 3 | 4 | 5;
        }>();
        const actingAgent = yield* resolveActingActorEffect(runtime, context);
        const reporterActorId = yield* fromSync(() =>
          resolveActingActorId(
            body.reporterActorId ?? body.reporterUserId,
            actingAgent,
            "reporterActorId"
          )
        );
        const targetActorId = yield* fromSync(() =>
          requireActorId(body.targetActorId ?? body.targetUserId, "targetActorId")
        );
        const response = yield* runtime.createAbuseReport(
          reporterActorId,
          targetActorId,
          body.severity
        );
        yield* Effect.sync(() => adminHooks?.publishSnapshot());
        return toJson(response, 201);
      })
    ),
    HttpRouter.post(
      "/interactions",
      Effect.gen(function* () {
        const context = yield* buildRequestContextEffect(runtime, options);
        const body = yield* parseJsonEffect<{
          actorId?: string;
          targetContentId: string;
          kind: "react" | "comment" | "share" | "dm";
          clientNonce?: string;
        }>();
        const actingAgent = yield* resolveActingActorEffect(runtime, context);
        const actorId = yield* fromSync(() =>
          resolveActingActorId(body.actorId, actingAgent, "actorId")
        );
        const interaction = yield* runtime.createInteraction(
          actorId,
          body.targetContentId,
          body.kind,
          body.clientNonce
        );
        yield* Effect.sync(() => adminHooks?.publishSnapshot());
        return toJson({ interaction }, 201);
      })
    ),
    HttpRouter.get(
      "/feed/:actorId",
      Effect.gen(function* () {
        const actorId = yield* getPathParamEffect("actorId");
        const url = yield* getRequestUrlEffect();
        const limit = parseNumber(url.searchParams.get("limit"));
        const items = yield* runtime.getFeed(actorId, limit);
        const feed = yield* Effect.forEach(items, (item) =>
          Effect.flatMap(runtime.getActor(item.content.authorId), (author) =>
            author.kind === "agent" && author.sponsorId
              ? Effect.map(runtime.getActor(author.sponsorId), (sponsor) => ({
                  ...item,
                  authorHandle: author.handle,
                  authorKind: author.kind,
                  authorSponsorHandle: sponsor.handle
                }))
              : Effect.succeed({
                  ...item,
                  authorHandle: author.handle,
                  authorKind: author.kind
                })
          )
        );
        return toJson({ feed });
      })
    )
  );

  if (options.enableWebUi) {
    const webClientHtml = renderWebClientHtml();
    const webClientCsp = buildPageCsp(webClientHtml);
    const aboutHtml = renderAboutHtml(options.contactEmail);
    const aboutCsp = buildPageCsp(aboutHtml);
    router = router.pipe(
      HttpRouter.get(
        "/about",
        Effect.succeed(
          toHtml(aboutHtml).pipe(HttpServerResponse.setHeader("content-security-policy", aboutCsp))
        )
      ),
      HttpRouter.get(
        "/",
        Effect.succeed(
          toHtml(webClientHtml).pipe(
            HttpServerResponse.setHeader("content-security-policy", webClientCsp)
          )
        )
      )
    );
  }

  if (options.enableAdminUi) {
    router = router.pipe(
      HttpRouter.get(
        "/admin",
        Effect.succeed(toHtml(renderAdminDashboardHtml(options.adminStreamIntervalMs ?? 4000)))
      ),
      HttpRouter.get(
        "/admin/api/snapshot",
        Effect.gen(function* () {
          const snapshot = yield* getAdminSnapshotEffect(runtime, options, adminHooks);
          return toJson(snapshot);
        })
      ),
      HttpRouter.get(
        "/admin/api/overview",
        Effect.gen(function* () {
          const snapshot = yield* getAdminSnapshotEffect(runtime, options, adminHooks);
          return toJson({
            summary: snapshot.summary,
            leaders: snapshot.leaders,
            transport: snapshot.transport,
            generatedAt: snapshot.generatedAt
          });
        })
      ),
      HttpRouter.get(
        "/admin/api/actors",
        Effect.gen(function* () {
          const snapshot = yield* getAdminSnapshotEffect(runtime, options, adminHooks);
          return toJson({
            actors: snapshot.actors
          });
        })
      ),
      HttpRouter.get(
        "/admin/api/reports",
        Effect.gen(function* () {
          const snapshot = yield* getAdminSnapshotEffect(runtime, options, adminHooks);
          return toJson({ reports: snapshot.reports });
        })
      ),
      HttpRouter.get(
        "/admin/api/interactions",
        Effect.gen(function* () {
          const snapshot = yield* getAdminSnapshotEffect(runtime, options, adminHooks);
          return toJson({ interactions: snapshot.interactions });
        })
      ),
      HttpRouter.get(
        "/admin/api/content",
        Effect.gen(function* () {
          const snapshot = yield* getAdminSnapshotEffect(runtime, options, adminHooks);
          return toJson({ content: snapshot.content });
        })
      )
    );
  }

  return router.pipe(Effect.catchAll((error) => Effect.succeed(renderErrorResponse(error))));
}

export function createHttpServer(
  service: ProtocolService,
  options: ServerOptions = {}
): ReturnType<typeof Bun.serve> {
  const runtime = makeProtocolRuntime(service);
  const adminStreamIntervalMs = options.adminStreamIntervalMs ?? 4000;
  let server!: ReturnType<typeof Bun.serve>;

  const getTransportStats = (): AdminTransportStats => ({
    pendingRequests: server?.pendingRequests ?? 0,
    pendingWebSockets: server?.pendingWebSockets ?? 0,
    adminSubscribers: server ? server.subscriberCount(ADMIN_DASHBOARD_TOPIC) : 0,
    pushIntervalMs: adminStreamIntervalMs
  });

  const encodeAdminMessage = (message: unknown) => JSON.stringify(message);

  const sendAdminSnapshotToSocket = (socket: { send(data: string): unknown }) => {
    void Effect.runPromise(
      Effect.either(createAdminSnapshotEffect(runtime, getTransportStats()))
    ).then((result) => {
      const payload = Either.isRight(result)
        ? encodeAdminMessage({
            type: "snapshot",
            snapshot: result.right
          })
        : encodeAdminMessage({
            type: "error",
            error: {
              code: "admin_snapshot_failed",
              message: result.left instanceof Error ? result.left.message : String(result.left)
            }
          });

      socket.send(payload);
    });
  };

  const publishAdminSnapshot = () => {
    if (!options.enableAdminUi || !server) {
      return;
    }

    void Effect.runPromise(
      Effect.either(createAdminSnapshotEffect(runtime, getTransportStats()))
    ).then((result) => {
      const payload = Either.isRight(result)
        ? encodeAdminMessage({
            type: "snapshot",
            snapshot: result.right
          })
        : encodeAdminMessage({
            type: "error",
            error: {
              code: "admin_snapshot_failed",
              message: result.left instanceof Error ? result.left.message : String(result.left)
            }
          });

      server.publish(ADMIN_DASHBOARD_TOPIC, payload);
    });
  };

  const app = createServerApp(runtime, options, {
    getSnapshotEffect: () => createAdminSnapshotEffect(runtime, getTransportStats()),
    publishSnapshot: publishAdminSnapshot
  });
  const handler = HttpApp.toWebHandler(app);
  const rateLimiter = options.rateLimit ? new RateLimiter(options.rateLimit) : undefined;

  server = Bun.serve({
    port: options.port ?? 3000,
    hostname: options.hostname,
    idleTimeout: options.idleTimeout,
    development: options.development,
    maxRequestBodySize: options.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES,
    websocket: {
      open(socket) {
        socket.subscribe(ADMIN_DASHBOARD_TOPIC);
        sendAdminSnapshotToSocket(socket);
      },
      message(socket, message) {
        const text =
          typeof message === "string" ? message : textDecoder.decode(message as Uint8Array);
        if (text === "snapshot" || text.includes('"type":"snapshot"')) {
          sendAdminSnapshotToSocket(socket);
        }
      }
    },
    async fetch(request, incomingServer) {
      const startedAt = performance.now();
      const url = new URL(request.url);
      const ip = resolveClientIp(
        request,
        incomingServer.requestIP(request)?.address,
        options.clientIpHeader
      );

      const finish = (response: Response): Response => {
        options.logger?.({
          level: "info",
          msg: "request",
          time: new Date().toISOString(),
          method: request.method,
          path: url.pathname,
          status: response.status,
          durationMs: Math.round(performance.now() - startedAt),
          ip
        });
        return applySecurityHeaders(response, request);
      };

      try {
        if (rateLimiter && url.pathname !== "/health") {
          const decision = rateLimiter.check(classifyRequest(request.method, url.pathname), ip);
          if (!decision.allowed) {
            const limited = HttpServerResponse.toWeb(
              toJson(
                { error: { code: "rate_limited", message: "Too many requests. Slow down." } },
                429
              )
            );
            limited.headers.set("retry-after", String(decision.retryAfterSeconds));
            return finish(limited);
          }
        }

        const isAdminPath = url.pathname === "/admin" || url.pathname.startsWith("/admin/");
        if (
          options.enableAdminUi &&
          options.adminToken &&
          isAdminPath &&
          !isAdminAuthorized(request, options.adminToken)
        ) {
          return finish(
            new Response("Admin credentials required.", {
              status: 401,
              headers: { "www-authenticate": 'Basic realm="Lento admin", charset="UTF-8"' }
            })
          );
        }

        if (options.enableAdminUi && url.pathname === "/admin/ws") {
          const validation = await Effect.runPromise(
            Effect.either(validateIdentityHeaderEffect(request, options))
          );
          if (Either.isLeft(validation)) {
            return finish(HttpServerResponse.toWeb(renderErrorResponse(validation.left)));
          }

          if (incomingServer.upgrade(request, { data: { channel: "admin" } })) {
            return;
          }

          return finish(new Response("Failed to upgrade websocket.", { status: 500 }));
        }

        const validation = await Effect.runPromise(
          Effect.either(validateIdentityHeaderEffect(request, options))
        );
        if (Either.isLeft(validation)) {
          return finish(HttpServerResponse.toWeb(renderErrorResponse(validation.left)));
        }
        return finish(await handler(request));
      } catch (error) {
        return finish(HttpServerResponse.toWeb(renderErrorResponse(error)));
      }
    }
  });

  const adminInterval =
    options.enableAdminUi && adminStreamIntervalMs > 0
      ? setInterval(() => {
          publishAdminSnapshot();
        }, adminStreamIntervalMs)
      : undefined;

  adminInterval?.unref?.();

  const originalStop = server.stop.bind(server);
  server.stop = ((closeActiveConnections?: boolean) => {
    if (adminInterval) {
      clearInterval(adminInterval);
    }
    return originalStop(closeActiveConnections);
  }) as typeof server.stop;

  return server;
}
