import { Effect } from "effect";
import { DEFAULT_PROTOCOL_CONFIG, type ProtocolConfig } from "../domain/config";
import type {
  AbuseReport,
  Actor,
  ActorId,
  Agent,
  ContentId,
  ContentItem,
  FeedItem,
  Interaction,
  InteractionKind,
  MoltbookIdentity,
  User,
  Vouch
} from "../domain/types";
import { InMemoryStore } from "../infra/in-memory-store";
import type { ProtocolStore } from "../infra/protocol-store";
import { ProtocolService } from "../services/protocol-service";

function fromService<A>(thunk: () => A): Effect.Effect<A, unknown> {
  return Effect.try({
    try: thunk,
    catch: (error) => error
  });
}

export interface CreateProtocolRuntimeOptions {
  config?: ProtocolConfig;
  store?: ProtocolStore;
}

export interface ProtocolRuntime {
  readonly service: ProtocolService;
  health(): Effect.Effect<{ ok: true }>;
  createUser(handle: string, now?: number): Effect.Effect<User, unknown>;
  getUser(userId: string, now?: number): Effect.Effect<User, unknown>;
  registerAgent(
    identity: MoltbookIdentity,
    handle?: string,
    now?: number
  ): Effect.Effect<Agent, unknown>;
  getAgent(agentId: string, now?: number): Effect.Effect<Agent, unknown>;
  getActor(actorId: string, now?: number): Effect.Effect<Actor, unknown>;
  findAgentByIdentity(
    identity: MoltbookIdentity,
    now?: number
  ): Effect.Effect<Agent | undefined, unknown>;
  getOrRegisterAgent(
    identity: MoltbookIdentity,
    handle?: string,
    now?: number
  ): Effect.Effect<Agent, unknown>;
  createContent(authorId: ActorId, body: string, now?: number): Effect.Effect<ContentItem, unknown>;
  getContent(contentId: ContentId): Effect.Effect<ContentItem, unknown>;
  listContent(authorId?: ActorId): Effect.Effect<ContentItem[], unknown>;
  createVouch(
    fromActorId: ActorId,
    toActorId: ActorId,
    stake?: number,
    now?: number
  ): Effect.Effect<{ vouch: Vouch; trustScore: number }, unknown>;
  createAbuseReport(
    reporterActorId: ActorId,
    targetActorId: ActorId,
    severity: 1 | 2 | 3 | 4 | 5,
    now?: number
  ): Effect.Effect<
    {
      report: AbuseReport;
      trustScore: number;
    },
    unknown
  >;
  createInteraction(
    actorId: ActorId,
    targetContentId: ContentId,
    kind: InteractionKind,
    clientNonce?: string,
    now?: number
  ): Effect.Effect<Interaction, unknown>;
  getFeed(actorId: ActorId, limit?: number): Effect.Effect<FeedItem[], unknown>;
  listActors(now?: number): Effect.Effect<Actor[], unknown>;
  listAbuseReports(limit?: number): Effect.Effect<AbuseReport[], unknown>;
  listInteractions(limit?: number): Effect.Effect<Interaction[], unknown>;
  getNetworkSummary(now?: number): Effect.Effect<
    {
      totalActors: number;
      totalUsers: number;
      totalAgents: number;
      totalContent: number;
      totalInteractions: number;
      totalAbuseReports: number;
      averageTrust: number;
    },
    unknown
  >;
}

export function makeProtocolRuntime(service: ProtocolService): ProtocolRuntime {
  return {
    service,
    health: () => Effect.succeed({ ok: true as const }),
    createUser: (handle, now) => fromService(() => service.createUser({ handle, now })),
    getUser: (userId, now) => fromService(() => service.getUser(userId, now)),
    registerAgent: (identity, handle, now) =>
      fromService(() => service.registerAgent({ identity, handle, now })),
    getAgent: (agentId, now) => fromService(() => service.getAgent(agentId, now)),
    getActor: (actorId, now) => fromService(() => service.getActor(actorId, now)),
    findAgentByIdentity: (identity, now) =>
      fromService(() => service.findAgentByIdentity(identity, now)),
    getOrRegisterAgent: (identity, handle, now) =>
      Effect.flatMap(
        fromService(() => service.findAgentByIdentity(identity, now)),
        (existing) =>
          existing
            ? Effect.succeed(existing)
            : fromService(() => service.registerAgent({ identity, handle, now }))
      ),
    createContent: (authorId, body, now) =>
      fromService(() => service.createContent({ authorId, body, now })),
    getContent: (contentId) => fromService(() => service.getContent(contentId)),
    listContent: (authorId) => fromService(() => service.listContent(authorId)),
    createVouch: (fromActorId, toActorId, stake, now) =>
      fromService(() => service.createVouch({ fromActorId, toActorId, stake, now })),
    createAbuseReport: (reporterActorId, targetActorId, severity, now) =>
      fromService(() =>
        service.createAbuseReport({
          reporterActorId,
          targetActorId,
          severity,
          now
        })
      ),
    createInteraction: (actorId, targetContentId, kind, clientNonce, now) =>
      fromService(() =>
        service.createInteraction({
          actorId,
          targetContentId,
          kind,
          clientNonce,
          now
        })
      ),
    getFeed: (actorId, limit) => fromService(() => service.getFeed(actorId, limit)),
    listActors: (now) => fromService(() => service.listActors(now)),
    listAbuseReports: (limit) => fromService(() => service.listAbuseReports(limit)),
    listInteractions: (limit) => fromService(() => service.listInteractions(limit)),
    getNetworkSummary: (now) => fromService(() => service.getNetworkSummary(now))
  };
}

export function createProtocolRuntime(options: CreateProtocolRuntimeOptions = {}): ProtocolRuntime {
  const service = new ProtocolService(
    options.config ?? DEFAULT_PROTOCOL_CONFIG,
    options.store ?? new InMemoryStore()
  );
  return makeProtocolRuntime(service);
}
