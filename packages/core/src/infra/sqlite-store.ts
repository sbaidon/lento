import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type {
  AbuseReport,
  ActorId,
  ActorStats,
  Agent,
  ContentId,
  ContentItem,
  EnergyState,
  Interaction,
  MoltbookIdentity,
  MoltbookOwnerProfile,
  User,
  Vouch
} from "../domain/types";
import { ProtocolError } from "../domain/errors";
import { makeIdentityKey, type ProtocolStore } from "./protocol-store";

interface SqliteStoreOptions {
  readonly path: string;
}

interface ActorRow {
  id: string;
  kind: "user" | "agent";
  handle: string;
  trust_score: number;
  created_at: number;
  energy_current: number;
  energy_max: number;
  energy_regen_per_hour: number;
  energy_updated_at: number;
  stats_interactions: number;
  stats_abuse_reports: number;
  stats_vouches_given: number;
  stats_vouches_received: number;
  verified_at: number | null;
}

interface AgentIdentityRow {
  actor_id: string;
  provider: "moltbook";
  external_id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  karma: number | null;
  is_claimed: number | null;
  identity_created_at: string | null;
  follower_count: number | null;
  owner_x_handle: string | null;
  owner_x_name: string | null;
  owner_x_verified: number | null;
  owner_x_follower_count: number | null;
}

interface ContentRow {
  id: string;
  author_id: string;
  body: string;
  created_at: number;
}

interface InteractionRow {
  id: string;
  actor_id: string;
  target_content_id: string;
  kind: "react" | "comment" | "share" | "dm";
  applied_cost: number;
  base_cost: number;
  roll: number;
  multiplier: number;
  proof: string;
  pulse_bucket: number;
  created_at: number;
}

interface AbuseReportRow {
  reporter_actor_id: string;
  target_actor_id: string;
  severity: 1 | 2 | 3 | 4 | 5;
  created_at: number;
}

interface VouchRow {
  id: string;
  from_actor_id: string;
  to_actor_id: string;
  stake: number;
  created_at: number;
}

function toEnergyState(row: ActorRow): EnergyState {
  return {
    current: row.energy_current,
    max: row.energy_max,
    regenPerHour: row.energy_regen_per_hour,
    updatedAt: row.energy_updated_at
  };
}

function toActorStats(row: ActorRow): ActorStats {
  return {
    interactions: row.stats_interactions,
    abuseReports: row.stats_abuse_reports,
    vouchesGiven: row.stats_vouches_given,
    vouchesReceived: row.stats_vouches_received
  };
}

function toOwnerProfile(row: AgentIdentityRow): MoltbookOwnerProfile | undefined {
  if (
    row.owner_x_handle === null &&
    row.owner_x_name === null &&
    row.owner_x_verified === null &&
    row.owner_x_follower_count === null
  ) {
    return undefined;
  }

  return {
    xHandle: row.owner_x_handle ?? undefined,
    xName: row.owner_x_name ?? undefined,
    xVerified: row.owner_x_verified === null ? undefined : Boolean(row.owner_x_verified),
    xFollowerCount: row.owner_x_follower_count ?? undefined
  };
}

function toIdentity(row: AgentIdentityRow): MoltbookIdentity {
  return {
    provider: row.provider,
    id: row.external_id,
    name: row.name,
    description: row.description ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    karma: row.karma ?? undefined,
    isClaimed: row.is_claimed === null ? undefined : Boolean(row.is_claimed),
    createdAt: row.identity_created_at ?? undefined,
    followerCount: row.follower_count ?? undefined,
    owner: toOwnerProfile(row)
  };
}

function ensureDirectory(dbPath: string): void {
  if (dbPath === ":memory:") {
    return;
  }

  mkdirSync(dirname(dbPath), { recursive: true });
}

export class SqliteStore implements ProtocolStore {
  private readonly db: Database;

  constructor(options: SqliteStoreOptions) {
    ensureDirectory(options.path);
    this.db = new Database(options.path, { create: true, strict: true });
    this.configure();
    this.migrate();
  }

  transaction<A>(callback: () => A): A {
    return this.db.transaction(callback)();
  }

  getUser(userId: ActorId): User | undefined {
    const row = this.db
      .query<ActorRow, [string]>("select * from actors where id = ?1 and kind = 'user' limit 1")
      .get(userId);
    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      kind: "user",
      handle: row.handle,
      trustScore: row.trust_score,
      createdAt: row.created_at,
      energy: toEnergyState(row),
      stats: toActorStats(row)
    };
  }

  saveUser(user: User): void {
    this.db
      .query(
        `
          insert into actors (
            id, kind, handle, trust_score, created_at,
            energy_current, energy_max, energy_regen_per_hour, energy_updated_at,
            stats_interactions, stats_abuse_reports, stats_vouches_given, stats_vouches_received,
            verified_at
          ) values (?1, 'user', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, null)
          on conflict(id) do update set
            handle = excluded.handle,
            trust_score = excluded.trust_score,
            created_at = excluded.created_at,
            energy_current = excluded.energy_current,
            energy_max = excluded.energy_max,
            energy_regen_per_hour = excluded.energy_regen_per_hour,
            energy_updated_at = excluded.energy_updated_at,
            stats_interactions = excluded.stats_interactions,
            stats_abuse_reports = excluded.stats_abuse_reports,
            stats_vouches_given = excluded.stats_vouches_given,
            stats_vouches_received = excluded.stats_vouches_received,
            verified_at = null
        `
      )
      .run(
        user.id,
        user.handle,
        user.trustScore,
        user.createdAt,
        user.energy.current,
        user.energy.max,
        user.energy.regenPerHour,
        user.energy.updatedAt,
        user.stats.interactions,
        user.stats.abuseReports,
        user.stats.vouchesGiven,
        user.stats.vouchesReceived
      );
  }

  listUsers(): User[] {
    return this.db
      .query<ActorRow, []>("select * from actors where kind = 'user'")
      .all()
      .map((row) => ({
        id: row.id,
        kind: "user",
        handle: row.handle,
        trustScore: row.trust_score,
        createdAt: row.created_at,
        energy: toEnergyState(row),
        stats: toActorStats(row)
      }));
  }

  countUsers(): number {
    const row = this.db
      .query<{ count: number }, []>("select count(*) as count from actors where kind = 'user'")
      .get();
    return row?.count ?? 0;
  }

  getAgent(agentId: ActorId): Agent | undefined {
    const actorRow = this.db
      .query<ActorRow, [string]>("select * from actors where id = ?1 and kind = 'agent' limit 1")
      .get(agentId);
    if (!actorRow) {
      return undefined;
    }

    const identityRow = this.db
      .query<
        AgentIdentityRow,
        [string]
      >("select * from agent_identities where actor_id = ?1 limit 1")
      .get(agentId);
    if (!identityRow) {
      throw new ProtocolError(
        "identity_missing",
        500,
        `Agent '${agentId}' is missing its identity record.`
      );
    }

    return {
      id: actorRow.id,
      kind: "agent",
      handle: actorRow.handle,
      trustScore: actorRow.trust_score,
      createdAt: actorRow.created_at,
      verifiedAt: actorRow.verified_at ?? actorRow.created_at,
      energy: toEnergyState(actorRow),
      stats: toActorStats(actorRow),
      identity: toIdentity(identityRow)
    };
  }

  saveAgent(agent: Agent): void {
    this.db
      .query(
        `
          insert into actors (
            id, kind, handle, trust_score, created_at,
            energy_current, energy_max, energy_regen_per_hour, energy_updated_at,
            stats_interactions, stats_abuse_reports, stats_vouches_given, stats_vouches_received,
            verified_at
          ) values (?1, 'agent', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
          on conflict(id) do update set
            handle = excluded.handle,
            trust_score = excluded.trust_score,
            created_at = excluded.created_at,
            energy_current = excluded.energy_current,
            energy_max = excluded.energy_max,
            energy_regen_per_hour = excluded.energy_regen_per_hour,
            energy_updated_at = excluded.energy_updated_at,
            stats_interactions = excluded.stats_interactions,
            stats_abuse_reports = excluded.stats_abuse_reports,
            stats_vouches_given = excluded.stats_vouches_given,
            stats_vouches_received = excluded.stats_vouches_received,
            verified_at = excluded.verified_at
        `
      )
      .run(
        agent.id,
        agent.handle,
        agent.trustScore,
        agent.createdAt,
        agent.energy.current,
        agent.energy.max,
        agent.energy.regenPerHour,
        agent.energy.updatedAt,
        agent.stats.interactions,
        agent.stats.abuseReports,
        agent.stats.vouchesGiven,
        agent.stats.vouchesReceived,
        agent.verifiedAt
      );

    this.db
      .query(
        `
          insert into agent_identities (
            actor_id, provider, external_id, name, description, avatar_url, karma,
            is_claimed, identity_created_at, follower_count,
            owner_x_handle, owner_x_name, owner_x_verified, owner_x_follower_count
          ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
          on conflict(actor_id) do update set
            provider = excluded.provider,
            external_id = excluded.external_id,
            name = excluded.name,
            description = excluded.description,
            avatar_url = excluded.avatar_url,
            karma = excluded.karma,
            is_claimed = excluded.is_claimed,
            identity_created_at = excluded.identity_created_at,
            follower_count = excluded.follower_count,
            owner_x_handle = excluded.owner_x_handle,
            owner_x_name = excluded.owner_x_name,
            owner_x_verified = excluded.owner_x_verified,
            owner_x_follower_count = excluded.owner_x_follower_count
        `
      )
      .run(
        agent.id,
        agent.identity.provider,
        agent.identity.id,
        agent.identity.name,
        agent.identity.description ?? null,
        agent.identity.avatarUrl ?? null,
        agent.identity.karma ?? null,
        agent.identity.isClaimed === undefined ? null : Number(agent.identity.isClaimed),
        agent.identity.createdAt ?? null,
        agent.identity.followerCount ?? null,
        agent.identity.owner?.xHandle ?? null,
        agent.identity.owner?.xName ?? null,
        agent.identity.owner?.xVerified === undefined
          ? null
          : Number(agent.identity.owner.xVerified),
        agent.identity.owner?.xFollowerCount ?? null
      );
  }

  listAgents(): Agent[] {
    const actorRows = this.db
      .query<ActorRow, []>("select * from actors where kind = 'agent'")
      .all();
    return actorRows.map((row) => {
      const identityRow = this.db
        .query<
          AgentIdentityRow,
          [string]
        >("select * from agent_identities where actor_id = ?1 limit 1")
        .get(row.id);
      if (!identityRow) {
        throw new ProtocolError(
          "identity_missing",
          500,
          `Agent '${row.id}' is missing its identity record.`
        );
      }

      return {
        id: row.id,
        kind: "agent",
        handle: row.handle,
        trustScore: row.trust_score,
        createdAt: row.created_at,
        verifiedAt: row.verified_at ?? row.created_at,
        energy: toEnergyState(row),
        stats: toActorStats(row),
        identity: toIdentity(identityRow)
      };
    });
  }

  countAgents(): number {
    const row = this.db
      .query<{ count: number }, []>("select count(*) as count from actors where kind = 'agent'")
      .get();
    return row?.count ?? 0;
  }

  getActorIdByHandle(handle: string): ActorId | undefined {
    const row = this.db
      .query<{ id: string }, [string]>("select id from actors where handle = ?1 limit 1")
      .get(handle);
    return row?.id;
  }

  setActorHandle(_handle: string, _actorId: ActorId): void {}

  deleteActorHandle(_handle: string): void {}

  getAgentIdByIdentity(identity: MoltbookIdentity | string): ActorId | undefined {
    const key = typeof identity === "string" ? identity : makeIdentityKey(identity);
    const separatorIndex = key.indexOf(":");
    if (separatorIndex === -1) {
      return undefined;
    }
    const provider = key.slice(0, separatorIndex);
    const externalId = key.slice(separatorIndex + 1);
    const row = this.db
      .query<
        { actor_id: string },
        [string, string]
      >("select actor_id from agent_identities where provider = ?1 and external_id = ?2 limit 1")
      .get(provider, externalId);
    return row?.actor_id;
  }

  setAgentIdentity(_identity: MoltbookIdentity | string, _actorId: ActorId): void {}

  getContent(contentId: ContentId): ContentItem | undefined {
    const row = this.db
      .query<ContentRow, [string]>("select * from content where id = ?1 limit 1")
      .get(contentId);
    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      authorId: row.author_id,
      body: row.body,
      createdAt: row.created_at
    };
  }

  saveContent(content: ContentItem): void {
    this.db
      .query(
        `
          insert into content (id, author_id, body, created_at)
          values (?1, ?2, ?3, ?4)
          on conflict(id) do update set
            author_id = excluded.author_id,
            body = excluded.body,
            created_at = excluded.created_at
        `
      )
      .run(content.id, content.authorId, content.body, content.createdAt);
  }

  listContent(): ContentItem[] {
    return this.db
      .query<ContentRow, []>("select * from content")
      .all()
      .map((row) => ({
        id: row.id,
        authorId: row.author_id,
        body: row.body,
        createdAt: row.created_at
      }));
  }

  countContent(): number {
    const row = this.db.query<{ count: number }, []>("select count(*) as count from content").get();
    return row?.count ?? 0;
  }

  saveInteraction(interaction: Interaction): void {
    this.db
      .query(
        `
          insert into interactions (
            id, actor_id, target_content_id, kind, applied_cost, base_cost,
            roll, multiplier, proof, pulse_bucket, created_at
          ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
          on conflict(id) do update set
            actor_id = excluded.actor_id,
            target_content_id = excluded.target_content_id,
            kind = excluded.kind,
            applied_cost = excluded.applied_cost,
            base_cost = excluded.base_cost,
            roll = excluded.roll,
            multiplier = excluded.multiplier,
            proof = excluded.proof,
            pulse_bucket = excluded.pulse_bucket,
            created_at = excluded.created_at
        `
      )
      .run(
        interaction.id,
        interaction.actorId,
        interaction.targetContentId,
        interaction.kind,
        interaction.appliedCost,
        interaction.baseCost,
        interaction.roll,
        interaction.multiplier,
        interaction.proof,
        interaction.pulseBucket,
        interaction.createdAt
      );
  }

  listInteractions(): Interaction[] {
    return this.db
      .query<InteractionRow, []>("select * from interactions")
      .all()
      .map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        targetContentId: row.target_content_id,
        kind: row.kind,
        appliedCost: row.applied_cost,
        baseCost: row.base_cost,
        roll: row.roll,
        multiplier: row.multiplier,
        proof: row.proof,
        pulseBucket: row.pulse_bucket,
        createdAt: row.created_at
      }));
  }

  countInteractions(): number {
    const row = this.db
      .query<{ count: number }, []>("select count(*) as count from interactions")
      .get();
    return row?.count ?? 0;
  }

  addAbuseReport(report: AbuseReport): void {
    this.db
      .query(
        `
          insert into abuse_reports (reporter_actor_id, target_actor_id, severity, created_at)
          values (?1, ?2, ?3, ?4)
        `
      )
      .run(report.reporterActorId, report.targetActorId, report.severity, report.createdAt);
  }

  listAbuseReports(): AbuseReport[] {
    return this.db
      .query<AbuseReportRow, []>("select * from abuse_reports")
      .all()
      .map((row) => ({
        reporterActorId: row.reporter_actor_id,
        targetActorId: row.target_actor_id,
        severity: row.severity,
        createdAt: row.created_at
      }));
  }

  countAbuseReports(): number {
    const row = this.db
      .query<{ count: number }, []>("select count(*) as count from abuse_reports")
      .get();
    return row?.count ?? 0;
  }

  hasVouch(fromActorId: ActorId, toActorId: ActorId): boolean {
    const row = this.db
      .query<
        { found: number },
        [string, string]
      >("select 1 as found from vouches where from_actor_id = ?1 and to_actor_id = ?2 limit 1")
      .get(fromActorId, toActorId);
    return row?.found === 1;
  }

  addVouch(vouch: Vouch): void {
    if (this.hasVouch(vouch.fromActorId, vouch.toActorId)) {
      throw new ProtocolError("duplicate_vouch", 409, "Vouch already exists for this pair.");
    }

    this.db
      .query(
        `
          insert into vouches (id, from_actor_id, to_actor_id, stake, created_at)
          values (?1, ?2, ?3, ?4, ?5)
        `
      )
      .run(vouch.id, vouch.fromActorId, vouch.toActorId, vouch.stake, vouch.createdAt);
  }

  listVouches(): Vouch[] {
    return this.db
      .query<VouchRow, []>("select * from vouches")
      .all()
      .map((row) => ({
        id: row.id,
        fromActorId: row.from_actor_id,
        toActorId: row.to_actor_id,
        stake: row.stake,
        createdAt: row.created_at
      }));
  }

  listIncomingVouches(actorId: ActorId): Vouch[] {
    return this.db
      .query<VouchRow, [string]>("select * from vouches where to_actor_id = ?1")
      .all(actorId)
      .map((row) => ({
        id: row.id,
        fromActorId: row.from_actor_id,
        toActorId: row.to_actor_id,
        stake: row.stake,
        createdAt: row.created_at
      }));
  }

  listOutgoingVouches(actorId: ActorId): Vouch[] {
    return this.db
      .query<VouchRow, [string]>("select * from vouches where from_actor_id = ?1")
      .all(actorId)
      .map((row) => ({
        id: row.id,
        fromActorId: row.from_actor_id,
        toActorId: row.to_actor_id,
        stake: row.stake,
        createdAt: row.created_at
      }));
  }

  close(): void {
    this.db.close();
  }

  clear(): void {
    this.db.exec(`
      delete from interactions;
      delete from abuse_reports;
      delete from vouches;
      delete from content;
      delete from agent_identities;
      delete from actors;
    `);
  }

  private configure(): void {
    this.db.exec("pragma journal_mode = WAL;");
    this.db.exec("pragma foreign_keys = ON;");
    this.db.exec("pragma synchronous = NORMAL;");
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists actors (
        id text primary key,
        kind text not null check (kind in ('user', 'agent')),
        handle text not null unique,
        trust_score real not null,
        created_at integer not null,
        energy_current real not null,
        energy_max real not null,
        energy_regen_per_hour real not null,
        energy_updated_at integer not null,
        stats_interactions integer not null,
        stats_abuse_reports integer not null,
        stats_vouches_given integer not null,
        stats_vouches_received integer not null,
        verified_at integer
      );

      create table if not exists agent_identities (
        actor_id text primary key references actors(id) on delete cascade,
        provider text not null,
        external_id text not null,
        name text not null,
        description text,
        avatar_url text,
        karma integer,
        is_claimed integer,
        identity_created_at text,
        follower_count integer,
        owner_x_handle text,
        owner_x_name text,
        owner_x_verified integer,
        owner_x_follower_count integer,
        unique(provider, external_id)
      );

      create table if not exists content (
        id text primary key,
        author_id text not null references actors(id) on delete restrict,
        body text not null,
        created_at integer not null
      );
      create index if not exists idx_content_author_created_at on content(author_id, created_at desc);

      create table if not exists vouches (
        id text primary key,
        from_actor_id text not null references actors(id) on delete restrict,
        to_actor_id text not null references actors(id) on delete restrict,
        stake integer not null,
        created_at integer not null,
        unique(from_actor_id, to_actor_id)
      );
      create index if not exists idx_vouches_to_actor_id on vouches(to_actor_id);
      create index if not exists idx_vouches_from_actor_id on vouches(from_actor_id);

      create table if not exists abuse_reports (
        reporter_actor_id text not null references actors(id) on delete restrict,
        target_actor_id text not null references actors(id) on delete restrict,
        severity integer not null,
        created_at integer not null
      );
      create index if not exists idx_abuse_reports_target_created_at on abuse_reports(target_actor_id, created_at desc);

      create table if not exists interactions (
        id text primary key,
        actor_id text not null references actors(id) on delete restrict,
        target_content_id text not null references content(id) on delete restrict,
        kind text not null check (kind in ('react', 'comment', 'share', 'dm')),
        applied_cost real not null,
        base_cost real not null,
        roll real not null,
        multiplier real not null,
        proof text not null,
        pulse_bucket integer not null,
        created_at integer not null
      );
      create index if not exists idx_interactions_actor_created_at on interactions(actor_id, created_at desc);
      create index if not exists idx_interactions_content_created_at on interactions(target_content_id, created_at desc);
    `);
  }
}
