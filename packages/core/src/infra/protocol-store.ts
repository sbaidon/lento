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

export interface ProtocolStore {
  transaction<A>(callback: () => A): A;

  getUser(userId: ActorId): User | undefined;
  saveUser(user: User): void;
  listUsers(): User[];
  countUsers(): number;

  getAgent(agentId: ActorId): Agent | undefined;
  saveAgent(agent: Agent): void;
  listAgents(): Agent[];
  countAgents(): number;

  getActorIdByHandle(handle: string): ActorId | undefined;
  setActorHandle(handle: string, actorId: ActorId): void;
  deleteActorHandle(handle: string): void;

  getAgentIdByIdentity(identity: MoltbookIdentity | string): ActorId | undefined;
  setAgentIdentity(identity: MoltbookIdentity | string, actorId: ActorId): void;

  getContent(contentId: ContentId): ContentItem | undefined;
  saveContent(content: ContentItem): void;
  listContent(): ContentItem[];
  countContent(): number;

  saveInteraction(interaction: Interaction): void;
  listInteractions(): Interaction[];
  countInteractions(): number;

  addAbuseReport(report: AbuseReport): void;
  listAbuseReports(): AbuseReport[];
  countAbuseReports(): number;

  hasVouch(fromActorId: ActorId, toActorId: ActorId): boolean;
  addVouch(vouch: Vouch): void;
  listVouches(): Vouch[];
  listIncomingVouches(actorId: ActorId): Vouch[];
  listOutgoingVouches(actorId: ActorId): Vouch[];
  clear(): void;

  close?(): void;
}

export function makeIdentityKey(identity: MoltbookIdentity): string {
  return `${identity.provider}:${identity.id}`;
}
