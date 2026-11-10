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

  /**
   * Undo steps for the transaction in progress. Without this, an operation
   * that failed halfway would keep its earlier writes, which SQLite rolls
   * back. The two stores must agree.
   */
  private journal: Array<() => void> | undefined;

  transaction<A>(callback: () => A): A {
    if (this.journal) {
      // Nested call: the outermost transaction owns commit and rollback.
      return callback();
    }

    const journal: Array<() => void> = [];
    this.journal = journal;
    try {
      return callback();
    } catch (error) {
      for (let index = journal.length - 1; index >= 0; index -= 1) {
        journal[index]!();
      }
      throw error;
    } finally {
      this.journal = undefined;
    }
  }

  private put<V>(map: Map<string, V>, key: string, value: V): void {
    if (this.journal) {
      const had = map.has(key);
      const previous = map.get(key);
      this.journal.push(() => {
        if (had) {
          map.set(key, previous as V);
        } else {
          map.delete(key);
        }
      });
    }
    map.set(key, value);
  }

  private remove<V>(map: Map<string, V>, key: string): void {
    if (this.journal && map.has(key)) {
      const previous = map.get(key) as V;
      this.journal.push(() => map.set(key, previous));
    }
    map.delete(key);
  }

  getUser(userId: ActorId): User | undefined {
    const user = this.users.get(userId);
    return user ? clone(user) : undefined;
  }

  saveUser(user: User): void {
    this.put(this.users, user.id, clone(user));
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
    this.put(this.agents, agent.id, clone(agent));
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
    this.put(this.actorIdsByHandle, handle, actorId);
  }

  deleteActorHandle(handle: string): void {
    this.remove(this.actorIdsByHandle, handle);
  }

  getAgentIdByIdentity(identity: MoltbookIdentity | string): ActorId | undefined {
    const key = typeof identity === "string" ? identity : makeIdentityKey(identity);
    return this.agentsByIdentity.get(key);
  }

  setAgentIdentity(identity: MoltbookIdentity | string, actorId: ActorId): void {
    const key = typeof identity === "string" ? identity : makeIdentityKey(identity);
    this.put(this.agentsByIdentity, key, actorId);
  }

  getContent(contentId: ContentId): ContentItem | undefined {
    const content = this.content.get(contentId);
    return content ? clone(content) : undefined;
  }

  saveContent(content: ContentItem): void {
    this.put(this.content, content.id, clone(content));
  }

  listContent(): ContentItem[] {
    return [...this.content.values()].map(clone);
  }

  countContent(): number {
    return this.content.size;
  }

  saveInteraction(interaction: Interaction): void {
    this.put(this.interactions, interaction.id, clone(interaction));
  }

  listInteractions(): Interaction[] {
    return [...this.interactions.values()].map(clone);
  }

  countInteractions(): number {
    return this.interactions.size;
  }

  addAbuseReport(report: AbuseReport): void {
    this.abuseReports.push(clone(report));
    this.journal?.push(() => {
      this.abuseReports.pop();
    });
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
    this.journal?.push(() => this.socialGraph.removeVouch(vouch.fromActorId, vouch.toActorId));
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
    if (this.journal) {
      const maps = [
        this.users,
        this.agents,
        this.actorIdsByHandle,
        this.agentsByIdentity,
        this.content,
        this.interactions
      ] as Array<Map<string, unknown>>;
      const saved = maps.map((map) => new Map(map));
      const reports = [...this.abuseReports];
      const vouches = this.socialGraph.listAll();
      this.journal.push(() => {
        maps.forEach((map, index) => {
          map.clear();
          for (const [key, value] of saved[index]!) {
            map.set(key, value);
          }
        });
        this.abuseReports.length = 0;
        this.abuseReports.push(...reports);
        this.socialGraph.clear();
        for (const vouch of vouches) {
          this.socialGraph.addVouch(vouch);
        }
      });
    }

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
