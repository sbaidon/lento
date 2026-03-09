import { ProtocolError } from "./errors";
import type { ActorId, Vouch } from "./types";

function makeKey(fromActorId: ActorId, toActorId: ActorId): string {
  return `${fromActorId}::${toActorId}`;
}

export class SocialGraph {
  private readonly edges = new Map<string, Vouch>();

  addVouch(vouch: Vouch): void {
    const key = makeKey(vouch.fromActorId, vouch.toActorId);
    if (this.edges.has(key)) {
      throw new ProtocolError("duplicate_vouch", 409, "Vouch already exists for this pair.");
    }
    this.edges.set(key, vouch);
  }

  hasVouch(fromActorId: ActorId, toActorId: ActorId): boolean {
    return this.edges.has(makeKey(fromActorId, toActorId));
  }

  listIncoming(actorId: ActorId): Vouch[] {
    return [...this.edges.values()].filter((edge) => edge.toActorId === actorId);
  }

  listOutgoing(actorId: ActorId): Vouch[] {
    return [...this.edges.values()].filter((edge) => edge.fromActorId === actorId);
  }

  listAll(): Vouch[] {
    return [...this.edges.values()];
  }

  clear(): void {
    this.edges.clear();
  }
}
