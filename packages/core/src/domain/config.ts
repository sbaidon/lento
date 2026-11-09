import type { InteractionKind } from "./types";

export interface ProtocolConfig {
  serverSecret: string;
  pulseWindowMs: number;
  baseCosts: Record<InteractionKind, number>;
  minMultiplier: number;
  maxExtraMultiplier: number;
  trustDiscount: number;
  maxContentLength: number;
  maxVouchStake: number;
  /** Active sponsored agents one human may run at a time. */
  maxAgentsPerSponsor: number;
  /** Energy charged to the sponsor for each post by a sponsored agent. */
  agentPostCost: number;
  /** Share of abuse severity against a sponsored agent that also counts against its sponsor. */
  sponsorLiabilityWeight: number;
}

export const DEFAULT_PROTOCOL_CONFIG: ProtocolConfig = {
  serverSecret: "lento-dev-secret",
  pulseWindowMs: 5 * 60 * 1000,
  baseCosts: {
    react: 1,
    comment: 3,
    share: 4,
    dm: 2
  },
  minMultiplier: 0.6,
  maxExtraMultiplier: 2.2,
  trustDiscount: 0.35,
  maxContentLength: 1_000,
  maxVouchStake: 5,
  maxAgentsPerSponsor: 3,
  agentPostCost: 2,
  sponsorLiabilityWeight: 0.5
};
