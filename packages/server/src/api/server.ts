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
import {
  type MoltbookIdentityVerifier,
  resolveAuthenticatedIdentityEffect
} from "./moltbook-identity";

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
}

interface RequestContext {
  request: HttpServerRequest.HttpServerRequest;
  url: URL;
  authenticatedIdentity?: MoltbookIdentity;
  authenticatedAgent?: Agent;
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
    identity: actor.kind === "agent" ? actor.identity : undefined
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
  authenticatedAgent: Agent | undefined,
  fieldName: string
): string {
  if (!authenticatedAgent) {
    return requireActorId(actorId, fieldName);
  }

  if (actorId && actorId !== authenticatedAgent.id) {
    throw new ProtocolError(
      "actor_forbidden",
      403,
      `Authenticated agent '${authenticatedAgent.id}' cannot act as '${actorId}'.`
    );
  }

  return authenticatedAgent.id;
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

    if (
      options.requireIdentityForWrites &&
      isWriteMethod(request.method) &&
      !authenticatedIdentity
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
      authenticatedAgent
    };
  });
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
        if (options.requireIdentityForWrites) {
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
        return toJson({ user }, 201);
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
        const actingAgent = context.authenticatedIdentity
          ? yield* getOrRegisterAuthenticatedAgentEffect(
              runtime,
              context.authenticatedIdentity,
              context.authenticatedAgent
            )
          : undefined;
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
        const actingAgent = context.authenticatedIdentity
          ? yield* getOrRegisterAuthenticatedAgentEffect(
              runtime,
              context.authenticatedIdentity,
              context.authenticatedAgent
            )
          : undefined;
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
        const actingAgent = context.authenticatedIdentity
          ? yield* getOrRegisterAuthenticatedAgentEffect(
              runtime,
              context.authenticatedIdentity,
              context.authenticatedAgent
            )
          : undefined;
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
        const actingAgent = context.authenticatedIdentity
          ? yield* getOrRegisterAuthenticatedAgentEffect(
              runtime,
              context.authenticatedIdentity,
              context.authenticatedAgent
            )
          : undefined;
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
        const feed = yield* runtime.getFeed(actorId, limit);
        return toJson({ feed });
      })
    )
  );

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

  server = Bun.serve({
    port: options.port ?? 3000,
    hostname: options.hostname,
    idleTimeout: options.idleTimeout,
    development: options.development,
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
      try {
        const url = new URL(request.url);
        if (options.enableAdminUi && url.pathname === "/admin/ws") {
          const validation = await Effect.runPromise(
            Effect.either(validateIdentityHeaderEffect(request, options))
          );
          if (Either.isLeft(validation)) {
            return HttpServerResponse.toWeb(renderErrorResponse(validation.left));
          }

          if (incomingServer.upgrade(request, { data: { channel: "admin" } })) {
            return;
          }

          return new Response("Failed to upgrade websocket.", { status: 500 });
        }

        const validation = await Effect.runPromise(
          Effect.either(validateIdentityHeaderEffect(request, options))
        );
        if (Either.isLeft(validation)) {
          return HttpServerResponse.toWeb(renderErrorResponse(validation.left));
        }
        return await handler(request);
      } catch (error) {
        return HttpServerResponse.toWeb(renderErrorResponse(error));
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
