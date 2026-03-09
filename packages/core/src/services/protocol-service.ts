import type { ProtocolConfig } from "../domain/config";
import { DEFAULT_PROTOCOL_CONFIG } from "../domain/config";
import { ContentPolicy } from "../domain/content";
import { EnergyEngine } from "../domain/energy";
import { ProtocolError } from "../domain/errors";
import { LentoCostEngine } from "../domain/lento";
import { TrustEngine } from "../domain/trust";
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
  UserId,
  Vouch
} from "../domain/types";
import { round } from "../domain/utils";
import { createId } from "../infra/id";
import { InMemoryStore } from "../infra/in-memory-store";
import type { ProtocolStore } from "../infra/protocol-store";

interface CreateUserInput {
  handle: string;
  now?: number;
}

interface RegisterAgentInput {
  identity: MoltbookIdentity;
  handle?: string;
  now?: number;
}

interface CreateContentInput {
  authorId: ActorId;
  body: string;
  now?: number;
}

interface CreateVouchInput {
  fromActorId: ActorId;
  toActorId: ActorId;
  stake?: number;
  now?: number;
}

interface CreateAbuseReportInput {
  reporterActorId: ActorId;
  targetActorId: ActorId;
  severity: 1 | 2 | 3 | 4 | 5;
  now?: number;
}

interface CreateInteractionInput {
  actorId: ActorId;
  targetContentId: ContentId;
  kind: InteractionKind;
  clientNonce?: string;
  now?: number;
}

function slugifyHandleCandidate(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  return normalized.slice(0, 32);
}

function createActorStats() {
  return {
    interactions: 0,
    abuseReports: 0,
    vouchesGiven: 0,
    vouchesReceived: 0
  };
}

export class ProtocolService {
  private readonly trustEngine = new TrustEngine();
  private readonly energyEngine = new EnergyEngine();
  private readonly contentPolicy: ContentPolicy;
  private readonly lentoCostEngine: LentoCostEngine;

  constructor(
    private readonly config: ProtocolConfig = DEFAULT_PROTOCOL_CONFIG,
    private readonly store: ProtocolStore = new InMemoryStore()
  ) {
    this.contentPolicy = new ContentPolicy(config);
    this.lentoCostEngine = new LentoCostEngine(config);
  }

  createUser(input: CreateUserInput): User {
    return this.store.transaction(() => {
      const now = input.now ?? Date.now();
      const handle = this.normalizeHandle(input.handle);
      this.assertHandleAvailable(handle);

      const user: User = {
        id: createId("usr"),
        kind: "user",
        handle,
        trustScore: this.trustEngine.initialScore,
        createdAt: now,
        energy: this.energyEngine.createInitial(this.trustEngine.initialScore, now),
        stats: createActorStats()
      };

      this.store.saveUser(user);
      this.store.setActorHandle(handle, user.id);

      return user;
    });
  }

  registerAgent(input: RegisterAgentInput): Agent {
    return this.store.transaction(() => {
      const now = input.now ?? Date.now();
      const existing = this.findAgentByIdentity(input.identity, now);
      if (existing) {
        if (input.handle) {
          const nextHandle = this.normalizeHandle(input.handle);
          if (nextHandle !== existing.handle) {
            this.assertHandleAvailable(nextHandle);
            this.store.deleteActorHandle(existing.handle);
            existing.handle = nextHandle;
            this.store.setActorHandle(nextHandle, existing.id);
          }
        }
        existing.identity = input.identity;
        existing.verifiedAt = now;
        this.store.saveAgent(existing);
        this.store.setAgentIdentity(input.identity, existing.id);
        return existing;
      }

      const handle = this.allocateHandle(
        input.handle ??
          (slugifyHandleCandidate(input.identity.name) || `agent_${input.identity.id}`)
      );
      const agent: Agent = {
        id: createId("agt"),
        kind: "agent",
        handle,
        trustScore: this.trustEngine.initialScore,
        createdAt: now,
        verifiedAt: now,
        identity: input.identity,
        energy: this.energyEngine.createInitial(this.trustEngine.initialScore, now),
        stats: createActorStats()
      };

      this.store.saveAgent(agent);
      this.store.setActorHandle(handle, agent.id);
      this.store.setAgentIdentity(input.identity, agent.id);

      return agent;
    });
  }

  getUser(userId: UserId, now = Date.now()): User {
    const user = this.requireUser(userId);
    this.refreshActorEnergy(user, now);
    this.saveActor(user);
    return user;
  }

  getAgent(agentId: ActorId, now = Date.now()): Agent {
    const agent = this.requireAgent(agentId);
    this.refreshActorEnergy(agent, now);
    this.saveActor(agent);
    return agent;
  }

  getActor(actorId: ActorId, now = Date.now()): Actor {
    const actor = this.requireActor(actorId);
    this.refreshActorEnergy(actor, now);
    this.saveActor(actor);
    return actor;
  }

  findAgentByIdentity(identity: MoltbookIdentity, now = Date.now()): Agent | undefined {
    const agentId = this.store.getAgentIdByIdentity(identity);
    if (!agentId) {
      return undefined;
    }

    return this.getAgent(agentId, now);
  }

  createContent(input: CreateContentInput): ContentItem {
    return this.store.transaction(() => {
      const now = input.now ?? Date.now();
      const author = this.requireActor(input.authorId);
      this.refreshActorEnergy(author, now);
      this.saveActor(author);

      const body = this.contentPolicy.validateBody(input.body);
      const content: ContentItem = {
        id: createId("cnt"),
        authorId: author.id,
        body,
        createdAt: now
      };

      this.store.saveContent(content);
      return content;
    });
  }

  getContent(contentId: ContentId): ContentItem {
    const content = this.store.getContent(contentId);
    if (!content) {
      throw new ProtocolError("content_not_found", 404, `Content '${contentId}' does not exist.`);
    }
    return content;
  }

  listContent(authorId?: ActorId): ContentItem[] {
    const items = this.store.listContent();
    const filtered = authorId ? items.filter((item) => item.authorId === authorId) : items;
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }

  createVouch(input: CreateVouchInput): { vouch: Vouch; trustScore: number } {
    return this.store.transaction(() => {
      const now = input.now ?? Date.now();

      if (input.fromActorId === input.toActorId) {
        throw new ProtocolError("invalid_vouch", 400, "Self-vouching is not allowed.");
      }

      const fromActor = this.requireActor(input.fromActorId);
      const toActor = this.requireActor(input.toActorId);
      this.refreshActorEnergy(fromActor, now);
      this.refreshActorEnergy(toActor, now);

      const stake = this.normalizeStake(input.stake ?? 1);
      const vouch: Vouch = {
        id: createId("vch"),
        fromActorId: fromActor.id,
        toActorId: toActor.id,
        stake,
        createdAt: now
      };

      this.store.addVouch(vouch);

      fromActor.stats.vouchesGiven += 1;
      toActor.stats.vouchesReceived += 1;
      this.saveActor(fromActor);
      this.saveActor(toActor);

      const trustScore = this.recomputeTrust(toActor.id, now);
      return { vouch, trustScore };
    });
  }

  createAbuseReport(input: CreateAbuseReportInput): { report: AbuseReport; trustScore: number } {
    return this.store.transaction(() => {
      const now = input.now ?? Date.now();

      this.requireActor(input.reporterActorId);
      const target = this.requireActor(input.targetActorId);

      const severity = this.normalizeSeverity(input.severity);
      const report: AbuseReport = {
        reporterActorId: input.reporterActorId,
        targetActorId: target.id,
        severity,
        createdAt: now
      };

      this.store.addAbuseReport(report);
      target.stats.abuseReports += 1;
      this.saveActor(target);

      const trustScore = this.recomputeTrust(target.id, now);
      return { report, trustScore };
    });
  }

  createInteraction(input: CreateInteractionInput): Interaction {
    return this.store.transaction(() => {
      const now = input.now ?? Date.now();
      const actor = this.requireActor(input.actorId);
      const target = this.getContent(input.targetContentId);
      this.refreshActorEnergy(actor, now);

      const clientNonce = input.clientNonce ?? createId("nonce");
      const cost = this.lentoCostEngine.calculate({
        kind: input.kind,
        actorId: actor.id,
        targetId: target.id,
        trustScore: actor.trustScore,
        clientNonce,
        at: now
      });

      actor.energy = this.energyEngine.spend(actor.energy, cost.cost, now);
      actor.stats.interactions += 1;
      actor.trustScore = this.trustEngine.adjustOnSuccessfulInteraction(actor.trustScore);
      actor.energy = this.energyEngine.rebalanceForTrust(actor.energy, actor.trustScore, now);
      this.saveActor(actor);

      const interaction: Interaction = {
        id: createId("int"),
        actorId: actor.id,
        targetContentId: target.id,
        kind: input.kind,
        appliedCost: cost.cost,
        baseCost: cost.baseCost,
        roll: cost.roll,
        multiplier: cost.multiplier,
        proof: cost.proof,
        pulseBucket: cost.pulseBucket,
        createdAt: now
      };

      this.store.saveInteraction(interaction);
      return interaction;
    });
  }

  getFeed(actorId: ActorId, limit = 20): FeedItem[] {
    this.requireActor(actorId);

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 100)) : 20;
    const outgoing = new Set(this.store.listOutgoingVouches(actorId).map((edge) => edge.toActorId));

    const now = Date.now();
    return this.store
      .listContent()
      .map((content) => {
        const author = this.requireActor(content.authorId);
        const relationBonus = outgoing.has(author.id) ? 0.2 : 0;
        const ageHours = Math.max(0, (now - content.createdAt) / (60 * 60 * 1000));
        const freshness = 1 / (1 + ageHours / 12);
        const score = round(author.trustScore * 0.7 + freshness * 0.2 + relationBonus, 6);

        return {
          content,
          authorTrust: round(author.trustScore, 6),
          score
        };
      })
      .sort((a, b) => b.score - a.score || b.content.createdAt - a.content.createdAt)
      .slice(0, safeLimit);
  }

  listActors(now = Date.now()): Actor[] {
    const actors = [...this.store.listUsers(), ...this.store.listAgents()];
    for (const actor of actors) {
      this.refreshActorEnergy(actor, now);
      this.saveActor(actor);
    }

    return actors.sort((left, right) => {
      if (right.trustScore !== left.trustScore) {
        return right.trustScore - left.trustScore;
      }
      return right.createdAt - left.createdAt;
    });
  }

  listAbuseReports(limit = 50): AbuseReport[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 200)) : 50;
    return this.store
      .listAbuseReports()
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, safeLimit);
  }

  listInteractions(limit = 50): Interaction[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 200)) : 50;
    return this.store
      .listInteractions()
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, safeLimit);
  }

  getNetworkSummary(now = Date.now()): {
    totalActors: number;
    totalUsers: number;
    totalAgents: number;
    totalContent: number;
    totalInteractions: number;
    totalAbuseReports: number;
    averageTrust: number;
  } {
    const actors = this.listActors(now);
    const totalActors = actors.length;
    const averageTrust =
      totalActors === 0
        ? this.trustEngine.initialScore
        : round(actors.reduce((sum, actor) => sum + actor.trustScore, 0) / totalActors, 6);

    return {
      totalActors,
      totalUsers: this.store.countUsers(),
      totalAgents: this.store.countAgents(),
      totalContent: this.store.countContent(),
      totalInteractions: this.store.countInteractions(),
      totalAbuseReports: this.store.countAbuseReports(),
      averageTrust
    };
  }

  private recomputeTrust(actorId: ActorId, now: number): number {
    const actor = this.requireActor(actorId);

    const incomingSignals = this.store.listIncomingVouches(actor.id).map((vouch) => {
      const voucher = this.requireActor(vouch.fromActorId);
      return {
        voucherTrust: voucher.trustScore,
        stake: vouch.stake
      };
    });

    const abuseSeverityTotal = this.store
      .listAbuseReports()
      .filter((report) => report.targetActorId === actor.id)
      .reduce((total, report) => total + report.severity, 0);

    const computed = this.trustEngine.computeFromSignals(incomingSignals, abuseSeverityTotal);
    actor.trustScore = this.trustEngine.reconcile(actor.trustScore, computed);
    actor.energy = this.energyEngine.rebalanceForTrust(actor.energy, actor.trustScore, now);
    this.saveActor(actor);

    return actor.trustScore;
  }

  private refreshActorEnergy(actor: Actor, now: number): void {
    actor.energy = this.energyEngine.refresh(actor.energy, now);
  }

  private allocateHandle(raw: string): string {
    const base = this.normalizeHandle(raw);

    if (!this.store.getActorIdByHandle(base)) {
      return base;
    }

    for (let index = 2; index <= 99; index += 1) {
      const suffix = `_${index}`;
      const candidate = `${base.slice(0, Math.max(3, 32 - suffix.length))}${suffix}`;
      if (!this.store.getActorIdByHandle(candidate)) {
        return candidate;
      }
    }

    throw new ProtocolError("duplicate_handle", 409, `Handle '${base}' is already taken.`);
  }

  private assertHandleAvailable(handle: string): void {
    if (this.store.getActorIdByHandle(handle)) {
      throw new ProtocolError("duplicate_handle", 409, `Handle '${handle}' is already taken.`);
    }
  }

  private normalizeHandle(raw: string): string {
    const handle = raw.trim().toLowerCase();

    if (!/^[a-z0-9_]{3,32}$/.test(handle)) {
      throw new ProtocolError(
        "invalid_handle",
        400,
        "Handle must match /^[a-z0-9_]{3,32}$/ (lowercase letters, numbers, underscore)."
      );
    }

    return handle;
  }

  private normalizeStake(value: number): number {
    if (!Number.isFinite(value)) {
      throw new ProtocolError("invalid_stake", 400, "Stake must be a finite number.");
    }

    const normalized = Math.floor(value);
    if (normalized < 1 || normalized > this.config.maxVouchStake) {
      throw new ProtocolError(
        "invalid_stake",
        400,
        `Stake must be an integer between 1 and ${this.config.maxVouchStake}.`
      );
    }

    return normalized;
  }

  private normalizeSeverity(value: number): 1 | 2 | 3 | 4 | 5 {
    if (!Number.isFinite(value)) {
      throw new ProtocolError("invalid_severity", 400, "Severity must be a finite number.");
    }

    const normalized = Math.floor(value);
    if (normalized < 1 || normalized > 5) {
      throw new ProtocolError(
        "invalid_severity",
        400,
        "Severity must be an integer between 1 and 5."
      );
    }

    return normalized as 1 | 2 | 3 | 4 | 5;
  }

  private requireUser(userId: UserId): User {
    const user = this.store.getUser(userId);
    if (!user) {
      throw new ProtocolError("user_not_found", 404, `User '${userId}' does not exist.`);
    }
    return user;
  }

  private requireAgent(agentId: ActorId): Agent {
    const agent = this.store.getAgent(agentId);
    if (!agent) {
      throw new ProtocolError("agent_not_found", 404, `Agent '${agentId}' does not exist.`);
    }
    return agent;
  }

  private requireActor(actorId: ActorId): Actor {
    return (
      this.store.getUser(actorId) ??
      this.store.getAgent(actorId) ??
      this.throwActorNotFound(actorId)
    );
  }

  private saveActor(actor: Actor): void {
    if (actor.kind === "user") {
      this.store.saveUser(actor);
      return;
    }

    this.store.saveAgent(actor);
  }

  private throwActorNotFound(actorId: ActorId): never {
    throw new ProtocolError("actor_not_found", 404, `Actor '${actorId}' does not exist.`);
  }
}
