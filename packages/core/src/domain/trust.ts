import { clamp, round } from "./utils";

export interface VouchSignal {
  voucherTrust: number;
  /** Successful interactions the voucher has made. Earned trust does not make a vouch heavier. */
  voucherInteractions?: number;
  stake: number;
}

export interface TrustSignals {
  /** Incoming vouches, with each voucher's current trust. */
  vouches: VouchSignal[];
  /** Abuse severity against the actor, already weighted by reporter trust. */
  abuseSeverityTotal: number;
  /** Successful interactions the actor has made. */
  interactions: number;
  /** Genesis accounts are the seeds that trust flows out from. */
  genesis?: boolean;
}

/**
 * Trust is derived, not accumulated: the same signals always give the same
 * score, in any order.
 *
 *   trust = start + earned + vouched - reported
 *
 * - `start` is 0.5 for everyone, 0.9 for genesis accounts.
 * - `earned` grows slowly with the actor's own interactions, which cost
 *   energy and time, up to +0.2.
 * - `vouched` is what incoming vouches are worth, up to +0.3. A vouch is
 *   worth only as much as the voucher's credibility.
 * - `reported` is 0.02 per point of weighted abuse severity.
 *
 * Credibility is standing that other people gave you: trust above the
 * starting score, not counting what you earned through your own activity.
 * It can only come from a genesis account or a chain of vouches leading back
 * to one. So a ring of accounts cannot lift itself, however busy it is, and
 * a vouch can never lower the recipient's trust.
 */
export class TrustEngine {
  readonly initialScore = 0.5;
  readonly genesisScore = 0.9;
  readonly minScore = 0.01;
  readonly maxScore = 0.99;

  private readonly earnedPerInteraction = 0.002;
  private readonly maxEarningInteractions = 100;
  private readonly fullStakeVouchValue = 0.08;
  private readonly maxStake = 5;
  private readonly maxVouched = 0.3;
  private readonly penaltyPerSeverity = 0.02;

  /** Trust an actor earned through their own interactions. */
  earned(interactions: number): number {
    return clamp(interactions, 0, this.maxEarningInteractions) * this.earnedPerInteraction;
  }

  /**
   * How much weight an actor's vouch carries, from 0 (no standing from
   * others) to 1 (genesis level). Self-earned trust is subtracted first.
   */
  credibility(trustScore: number, interactions = 0): number {
    const standing = trustScore - this.earned(interactions);
    return clamp((standing - this.initialScore) / (this.genesisScore - this.initialScore), 0, 1);
  }

  compute(signals: TrustSignals): number {
    const start = signals.genesis ? this.genesisScore : this.initialScore;
    // Genesis accounts start at the top of the scale: their own activity adds nothing.
    const earned = signals.genesis ? 0 : this.earned(signals.interactions);
    const vouched = Math.min(
      this.maxVouched,
      signals.vouches.reduce(
        (sum, vouch) =>
          sum +
          this.credibility(vouch.voucherTrust, vouch.voucherInteractions) *
            (clamp(vouch.stake, 1, this.maxStake) / this.maxStake) *
            this.fullStakeVouchValue,
        0
      )
    );
    const reported = Math.max(0, signals.abuseSeverityTotal) * this.penaltyPerSeverity;

    return round(clamp(start + earned + vouched - reported, this.minScore, this.maxScore));
  }

  /**
   * The cheap path for a successful interaction: the same result `compute`
   * would give for one more interaction, without re-reading every signal.
   */
  adjustOnSuccessfulInteraction(current: number, interactionsAfter: number): number {
    const gain = interactionsAfter <= this.maxEarningInteractions ? this.earnedPerInteraction : 0;
    return round(clamp(current + gain, this.minScore, this.maxScore));
  }
}
