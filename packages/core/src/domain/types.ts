export type ActorId = string;
export type UserId = ActorId;
export type AgentId = ActorId;
export type ContentId = string;
export type VouchId = string;
export type InteractionId = string;

export type ActorKind = "user" | "agent";
export type InteractionKind = "react" | "comment" | "share" | "dm";

export interface EnergyState {
  current: number;
  max: number;
  regenPerHour: number;
  updatedAt: number;
}

export interface ActorStats {
  interactions: number;
  abuseReports: number;
  vouchesGiven: number;
  vouchesReceived: number;
}

export type UserStats = ActorStats;

interface ActorBase {
  id: ActorId;
  kind: ActorKind;
  handle: string;
  trustScore: number;
  createdAt: number;
  energy: EnergyState;
  stats: ActorStats;
}

export interface User extends ActorBase {
  kind: "user";
}

export interface MoltbookOwnerProfile {
  xHandle?: string;
  xName?: string;
  xVerified?: boolean;
  xFollowerCount?: number;
}

export interface MoltbookIdentity {
  provider: "moltbook";
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  karma?: number;
  isClaimed?: boolean;
  createdAt?: string;
  followerCount?: number;
  owner?: MoltbookOwnerProfile;
}

export interface Agent extends ActorBase {
  kind: "agent";
  identity: MoltbookIdentity;
  verifiedAt: number;
}

export type Actor = User | Agent;

export interface ContentItem {
  id: ContentId;
  authorId: ActorId;
  body: string;
  createdAt: number;
}

export interface Vouch {
  id: VouchId;
  fromActorId: ActorId;
  toActorId: ActorId;
  stake: number;
  createdAt: number;
}

export interface AbuseReport {
  reporterActorId: ActorId;
  targetActorId: ActorId;
  severity: 1 | 2 | 3 | 4 | 5;
  createdAt: number;
}

export interface Interaction {
  id: InteractionId;
  actorId: ActorId;
  targetContentId: ContentId;
  kind: InteractionKind;
  appliedCost: number;
  baseCost: number;
  roll: number;
  multiplier: number;
  proof: string;
  pulseBucket: number;
  createdAt: number;
}

export interface FeedItem {
  content: ContentItem;
  authorTrust: number;
  score: number;
}
