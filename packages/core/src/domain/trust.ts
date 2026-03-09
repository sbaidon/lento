import { clamp, round } from "./utils";

export interface VouchSignal {
  voucherTrust: number;
  stake: number;
}

export class TrustEngine {
  readonly initialScore = 0.5;

  computeFromSignals(vouches: VouchSignal[], abuseSeverityTotal: number): number {
    const base = 0.35;

    const positive = vouches.reduce((sum, vouch) => {
      const boundedStake = clamp(vouch.stake, 1, 5);
      const impact = clamp(vouch.voucherTrust, 0, 1) * boundedStake * 0.06;
      return sum + Math.min(impact, 0.12);
    }, 0);

    const cappedPositive = Math.min(positive, 0.45);
    const penalty = clamp(abuseSeverityTotal, 0, 100) * 0.02;

    return round(clamp(base + cappedPositive - penalty, 0.01, 0.99));
  }

  reconcile(current: number, computed: number): number {
    const blended = current * 0.65 + computed * 0.35;
    return round(clamp(blended, 0.01, 0.99));
  }

  adjustOnSuccessfulInteraction(current: number): number {
    return round(clamp(current + 0.002, 0.01, 0.99));
  }
}
