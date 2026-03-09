import type { AbuseReport, Agent, ContentItem, Interaction, User, Vouch } from "../domain/types";
import type { ProtocolStore } from "./protocol-store";

export interface ProtocolStoreSnapshot {
  version: 1;
  exportedAt: string;
  users: User[];
  agents: Agent[];
  content: ContentItem[];
  interactions: Interaction[];
  abuseReports: AbuseReport[];
  vouches: Vouch[];
}

export interface ImportProtocolStoreOptions {
  replaceExisting?: boolean;
}

export function exportProtocolStore(store: ProtocolStore): ProtocolStoreSnapshot {
  return store.transaction(() => ({
    version: 1,
    exportedAt: new Date().toISOString(),
    users: store.listUsers(),
    agents: store.listAgents(),
    content: store.listContent(),
    interactions: store.listInteractions(),
    abuseReports: store.listAbuseReports(),
    vouches: store.listVouches()
  }));
}

export function importProtocolStore(
  store: ProtocolStore,
  snapshot: ProtocolStoreSnapshot,
  options: ImportProtocolStoreOptions = {}
): void {
  if (snapshot.version !== 1) {
    throw new Error(`Unsupported snapshot version '${snapshot.version}'.`);
  }

  store.transaction(() => {
    if (options.replaceExisting !== false) {
      store.clear();
    }

    for (const user of snapshot.users) {
      store.saveUser(user);
      store.setActorHandle(user.handle, user.id);
    }

    for (const agent of snapshot.agents) {
      store.saveAgent(agent);
      store.setActorHandle(agent.handle, agent.id);
      store.setAgentIdentity(agent.identity, agent.id);
    }

    for (const content of snapshot.content) {
      store.saveContent(content);
    }

    for (const interaction of snapshot.interactions) {
      store.saveInteraction(interaction);
    }

    for (const report of snapshot.abuseReports) {
      store.addAbuseReport(report);
    }

    for (const vouch of snapshot.vouches) {
      store.addVouch(vouch);
    }
  });
}
