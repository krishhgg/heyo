// The plan's stop conditions and the gates in front of retargeting.
import { HELD_SHARE } from './labels';
import type { MissRate, Score } from './metrics';
import { lowerBound, trialsNeeded } from './stats';

export const GATES = {
  /** Proxy recovery must reach this share of labeled misses. */
  minRecovery: 0.5,
  /** Recovery measured on fewer labeled misses than this is noise, so the gate stays open. */
  minMisses: 30,
  /** The verified wrong-target rate must sit under this, with 95% confidence. */
  maxWrongRate: 0.01,
  /** Shadow mode must run this many calendar days before the miss rate is judged. */
  shadowDays: 14,
  /** Stop if labeled misses are under this share of clicks. */
  minMissRate: 0.005,
  /** Stop if labeled misses are under this many a day. */
  minMissesPerDay: 3,
  /** Narrow the allowlist if pages ignore more than this share of the clicks heyo sends. */
  maxIgnoredShare: 0.1,
  /** Turn retargeting off after more than this many wrong clicks noticed in a week. */
  maxWrongPerWeek: 1,
  /** Share of fires held back as a control once retargeting is on. */
  heldShare: HELD_SHARE,
} as const;

/** Inconclusive means there is not enough evidence yet. It is never a pass. */
export type GateStatus = 'pass' | 'fail' | 'inconclusive';

export interface RecoveryGate {
  status: GateStatus;
  recovery: number | null;
  misses: number;
}

export function recoveryGate(score: Score): RecoveryGate {
  const { recovery, misses } = score;
  let status: GateStatus = 'inconclusive';
  if (recovery !== null && misses >= GATES.minMisses) {
    status = recovery >= GATES.minRecovery ? 'pass' : 'fail';
  }
  return { status, recovery, misses };
}

export interface WrongTargetGate {
  status: GateStatus;
  reviewed: number;
  wrong: number;
  /** One-sided 95% upper bound on the wrong-target rate. */
  upper: number | null;
  /** Reviewed fires needed to pass with the wrong targets found so far. */
  needed: number;
}

export function wrongTargetGate(score: Score): WrongTargetGate {
  const { reviewed, wrong, wrongUpper: upper } = score;
  const needed = trialsNeeded(wrong, GATES.maxWrongRate);
  let status: GateStatus = 'inconclusive';
  if (upper !== null && upper < GATES.maxWrongRate) status = 'pass';
  else if (lowerBound(wrong, reviewed) >= GATES.maxWrongRate) status = 'fail';
  return { status, reviewed, wrong, upper, needed };
}

export interface RetargetGates {
  recovery: RecoveryGate;
  wrongTarget: WrongTargetGate;
  /** True only when both gates pass. */
  pass: boolean;
}

/** The two data gates in front of retargeting. The per-site replay test is separate. */
export function retargetGates(score: Score): RetargetGates {
  const recovery = recoveryGate(score);
  const wrongTarget = wrongTargetGate(score);
  return {
    recovery,
    wrongTarget,
    pass: recovery.status === 'pass' && wrongTarget.status === 'pass',
  };
}

export interface MissRateGate {
  status: GateStatus;
  rate: number | null;
  perDay: number | null;
  elapsedDays: number;
}

/** The go or no-go after two weeks of shadow mode. Two weeks are calendar days, used or not. */
export function missRateGate(rate: MissRate): MissRateGate {
  let status: GateStatus = 'inconclusive';
  if (rate.elapsedDays >= GATES.shadowDays) {
    const enough =
      rate.rate !== null &&
      rate.perDay !== null &&
      rate.rate >= GATES.minMissRate &&
      rate.perDay >= GATES.minMissesPerDay;
    status = enough ? 'pass' : 'fail';
  }
  return { status, rate: rate.rate, perDay: rate.perDay, elapsedDays: rate.elapsedDays };
}
