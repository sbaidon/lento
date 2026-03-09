import type {
  AbuseReport,
  ActorId,
  Agent,
  ContentId,
  ContentItem,
  Interaction,
  MoltbookIdentity,
  User,
  Vouch
} from "../domain/types";
import { SocialGraph } from "../domain/social-graph";
import { makeIdentityKey, type ProtocolStore } from "./protocol-store";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryStore implements ProtocolStore {
  private readonly users = new Map<string, User>();
  private readonly agents = new Map<string, Agent>();
  private readonly actorIdsByHandle = new Map<string, ActorId>();
  private readonly agentsByIdentity = new Map<string, string>();
  private readonly content = new Map<string, ContentItem>();
  private readonly interactions = new Map<string, Interaction>();
  private readonly abuseReports: AbuseReport[] = [];
  private readonly socialGraph = new SocialGraph();

  transaction<A>(callback: () => A): A {
    return callback();
  }

  getUser(userId: ActorId): User | undefined {
    const user = this.users.get(userId);
    return user ? clone(user) : undefined;
  }

  saveUser(user: User): void {
    this.users.set(user.id, clone(user));
  }

  listUsers(): User[] {
    return [...this.users.values()].map(clone);
  }

  countUsers(): number {
    return this.users.size;
  }

  getAgent(agentId: ActorId): Agent | undefined {
    const agent = this.agents.get(agentId);
    return agent ? clone(agent) : undefined;
  }

  saveAgent(agent: Agent): void {
    this.agents.set(agent.id, clone(agent));
  }

  listAgents(): Agent[] {
    return [...this.agents.values()].map(clone);
  }

  countAgents(): number {
    return this.agents.size;
  }

  getActorIdByHandle(handle: string): ActorId | undefined {
    return this.actorIdsByHandle.get(handle);
  }

  setActorHandle(handle: string, actorId: ActorId): void {
    this.actorIdsByHandle.set(handle, actorId);
  }

  deleteActorHandle(handle: string): void {
    this.actorIdsByHandle.delete(handle);
  }

  getAgentIdByIdentity(identity: MoltbookIdentity | string): ActorId | undefined {
    const key = typeof identity === "string" ? identity : makeIdentityKey(identity);
    return this.agentsByIdentity.get(key);
  }

  setAgentIdentity(identity: MoltbookIdentity | string, actorId: ActorId): void {
    const key = typeof identity === "string" ? identity : makeIdentityKey(identity);
    this.agentsByIdentity.set(key, actorId);
  }

  getContent(contentId: ContentId): ContentItem | undefined {
    const content = this.content.get(contentId);
    return content ? clone(content) : undefined;
  }

  saveContent(content: ContentItem): void {
    this.content.set(content.id, clone(content));
  }

  listContent(): ContentItem[] {
    return [...this.content.values()].map(clone);
  }

  countContent(): number {
    return this.content.size;
  }

  saveInteraction(interaction: Interaction): void {
    this.interactions.set(interaction.id, clone(interaction));
  }

  listInteractions(): Interaction[] {
    return [...this.interactions.values()].map(clone);
  }

  countInteractions(): number {
    return this.interactions.size;
  }

  addAbuseReport(report: AbuseReport): void {
    this.abuseReports.push(clone(report));
  }

  listAbuseReports(): AbuseReport[] {
    return this.abuseReports.map(clone);
  }

  countAbuseReports(): number {
    return this.abuseReports.length;
  }

  hasVouch(fromActorId: ActorId, toActorId: ActorId): boolean {
    return this.socialGraph.hasVouch(fromActorId, toActorId);
  }

  addVouch(vouch: Vouch): void {
    this.socialGraph.addVouch(clone(vouch));
  }

  listVouches(): Vouch[] {
    return this.socialGraph.listAll().map(clone);
  }

  listIncomingVouches(actorId: ActorId): Vouch[] {
    return this.socialGraph.listIncoming(actorId).map(clone);
  }

  listOutgoingVouches(actorId: ActorId): Vouch[] {
    return this.socialGraph.listOutgoing(actorId).map(clone);
  }

  clear(): void {
    this.users.clear();
    this.agents.clear();
    this.actorIdsByHandle.clear();
    this.agentsByIdentity.clear();
    this.content.clear();
    this.interactions.clear();
    this.abuseReports.length = 0;
    this.socialGraph.clear();
  }
}
