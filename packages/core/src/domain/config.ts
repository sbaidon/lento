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
  maxVouchStake: 5
};
