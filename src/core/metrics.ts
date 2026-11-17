// The numbers the plan steers by, computed from a log and a decision function.
import { isDoublePress, isLabeledMiss } from './labels';
import { upperBound } from './stats';
import type { ClickRecord, DayCount, Decide, Review } from './types';

export interface Score {
  /** Empty-space click records scored. */
  records: number;
  /** Labeled misses among them. */
  misses: number;
  /** Labeled misses where the decision picked the control the user then clicked. */
  recovered: number;
  /** recovered / misses. Null with no labeled misses. */
  recovery: number | null;
  /** Records the decision would retarget. */
  fires: number;
  /** Fires on a labeled miss that picked a different control than the user then clicked. */
  proxyWrong: number;
  /** Fires whose picked control a reviewer marked right or wrong. */
  reviewed: number;
  /** Reviewed fires marked wrong. */
  wrong: number;
  /** Fires a reviewer marked unsure. They count as neither reviewed nor wrong. */
  unsure: number;
  /** One-sided 95% upper bound on the wrong-target rate. Null with no reviewed fires. */
  wrongUpper: number | null;
  /** Fires followed by a second press within the double-click interval. */
  doublePress: number;
}

function reviewKey(recordId: string, candidate: number): string {
  return `${recordId}:${candidate}`;
}

/**
 * Runs the decision over every record and scores it.
 * A review applies to a fire only when it judged the same control the decision picked.
 * When a pair was reviewed more than once, the latest review wins.
 */
export function score(records: ClickRecord[], reviews: Review[], decide: Decide): Score {
  const verdicts = new Map<string, Review>();
  for (const review of reviews) {
    const key = reviewKey(review.recordId, review.candidate);
    const seen = verdicts.get(key);
    if (!seen || review.t >= seen.t) verdicts.set(key, review);
  }

  const result: Score = {
    records: records.length,
    misses: 0,
    recovered: 0,
    recovery: null,
    fires: 0,
    proxyWrong: 0,
    reviewed: 0,
    wrong: 0,
    unsure: 0,
    wrongUpper: null,
    doublePress: 0,
  };

  for (const record of records) {
    const decision = decide(record.features);
    const picked = decision.action === 'retarget' ? decision.candidate : null;
    const miss = isLabeledMiss(record);
    if (miss) {
      result.misses++;
      if (picked !== null && picked === record.followUp?.candidate) result.recovered++;
      else if (picked !== null) result.proxyWrong++;
    }
    if (picked === null) continue;
    result.fires++;
    if (isDoublePress(record)) result.doublePress++;
    const verdict = verdicts.get(reviewKey(record.id, picked))?.verdict;
    if (verdict === 'unsure') result.unsure++;
    else if (verdict) {
      result.reviewed++;
      if (verdict === 'wrong') result.wrong++;
    }
  }

  if (result.misses > 0) result.recovery = result.recovered / result.misses;
  if (result.reviewed > 0) result.wrongUpper = upperBound(result.wrong, result.reviewed);
  return result;
}

export interface MissRate {
  /** Days on which heyo saw at least one click. */
  days: number;
  clicks: number;
  misses: number;
  /** misses / clicks. Null with no clicks. */
  rate: number | null;
  /** misses / days. Null with no days. */
  perDay: number | null;
}

/** The numbers behind the plan's first stop condition. */
export function missRate(records: ClickRecord[], counts: DayCount[]): MissRate {
  const days = new Set(counts.filter((c) => c.clicks > 0).map((c) => c.day)).size;
  const clicks = counts.reduce((sum, c) => sum + c.clicks, 0);
  const misses = records.filter(isLabeledMiss).length;
  return {
    days,
    clicks,
    misses,
    rate: clicks > 0 ? misses / clicks : null,
    perDay: days > 0 ? misses / days : null,
  };
}
