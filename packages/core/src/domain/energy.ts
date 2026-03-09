import { ProtocolError } from "./errors";
import type { EnergyState } from "./types";
import { clamp } from "./utils";

export class EnergyEngine {
  createInitial(trustScore: number, now: number): EnergyState {
    const { max, regenPerHour } = this.profileFromTrust(trustScore);
    return {
      current: max,
      max,
      regenPerHour,
      updatedAt: now
    };
  }

  refresh(state: EnergyState, now: number): EnergyState {
    if (now <= state.updatedAt) {
      return state;
    }

    const elapsedHours = (now - state.updatedAt) / (60 * 60 * 1000);
    const regenerated = elapsedHours * state.regenPerHour;
    return {
      ...state,
      current: clamp(state.current + regenerated, 0, state.max),
      updatedAt: now
    };
  }

  spend(state: EnergyState, amount: number, now: number): EnergyState {
    if (amount <= 0) {
      return this.refresh(state, now);
    }

    const refreshed = this.refresh(state, now);
    if (refreshed.current < amount) {
      throw new ProtocolError(
        "insufficient_energy",
        402,
        `Insufficient energy. Required ${amount}, available ${refreshed.current.toFixed(2)}.`
      );
    }

    return {
      ...refreshed,
      current: refreshed.current - amount,
      updatedAt: now
    };
  }

  rebalanceForTrust(state: EnergyState, trustScore: number, now: number): EnergyState {
    const refreshed = this.refresh(state, now);
    const { max, regenPerHour } = this.profileFromTrust(trustScore);
    const fillRatio = refreshed.max <= 0 ? 0 : refreshed.current / refreshed.max;

    return {
      current: clamp(fillRatio * max, 0, max),
      max,
      regenPerHour,
      updatedAt: now
    };
  }

  private profileFromTrust(trustScore: number): { max: number; regenPerHour: number } {
    const normalizedTrust = clamp(trustScore, 0, 1);
    return {
      max: Math.round(100 + normalizedTrust * 80),
      regenPerHour: 12 + normalizedTrust * 10
    };
  }
}
