import { createHash } from "node:crypto";
import type { ProtocolConfig } from "./config";
import { DEFAULT_PROTOCOL_CONFIG } from "./config";
import type { InteractionKind } from "./types";
import { clamp, round } from "./utils";

export interface LentoCostInput {
  kind: InteractionKind;
  actorId: string;
  targetId: string;
  trustScore: number;
  clientNonce: string;
  at: number;
}

export interface LentoCostResult {
  cost: number;
  baseCost: number;
  roll: number;
  multiplier: number;
  pulseBucket: number;
  proof: string;
}

export class LentoCostEngine {
  constructor(private readonly config: ProtocolConfig = DEFAULT_PROTOCOL_CONFIG) {}

  calculate(input: LentoCostInput): LentoCostResult {
    const pulseBucket = Math.floor(input.at / this.config.pulseWindowMs);
    const seed = [
      this.config.serverSecret,
      String(pulseBucket),
      input.actorId,
      input.targetId,
      input.kind,
      input.clientNonce
    ].join(":");

    const proof = createHash("sha256").update(seed).digest("hex");
    const rollSource = Number.parseInt(proof.slice(0, 8), 16);
    const roll = clamp(rollSource / 0xffffffff, 0, 1);

    const baseCost = this.config.baseCosts[input.kind];
    const trustDiscount = this.config.trustDiscount * clamp(input.trustScore, 0, 1);
    const volatility = 1 + roll * this.config.maxExtraMultiplier * (1 - input.trustScore * 0.5);
    const multiplier = Math.max(this.config.minMultiplier, volatility - trustDiscount);
    const cost = Math.max(1, Math.ceil(baseCost * multiplier));

    return {
      cost,
      baseCost,
      roll: round(roll),
      multiplier: round(multiplier),
      pulseBucket,
      proof
    };
  }
}
