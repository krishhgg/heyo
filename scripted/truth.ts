// What the scripted run knows about each click that the log does not: which
// control the user aimed at. It stands in for the hand review, as the
// generator's own marks do for a synthetic log.
import { addDays } from '../src/core/days';
import type { Point } from '../src/core/geometry';
import type { ClickRecord, LogExport, Review } from '../src/core/types';
import type { Plan } from '../synth/generate';

const DAY_MS = 86_400_000;

/** How far a logged box may be from the drawn one and still be the same control, in px. */
const SAME_BOX_PX = 1.5;

/**
 * Review marks for one logged click. The control the user aimed at is right
 * and any other is wrong. A click meant for empty space has no right target.
 */
export function marksFor(record: ClickRecord, plan: Plan, origin: Point): Review[] {
  const { point } = record.features;
  const target = plan.intent === 'aim' ? plan.target : null;
  const near = (a: number, b: number) => Math.abs(a - b) <= SAME_BOX_PX;
  return record.features.candidates
    .filter((candidate) => candidate.kind === 'control')
    .map((candidate) => {
      const isTarget =
        target !== null &&
        near(point.x + candidate.rect.x, origin.x + target.rect.x) &&
        near(point.y + candidate.rect.y, origin.y + target.rect.y) &&
        near(candidate.rect.w, target.rect.w) &&
        near(candidate.rect.h, target.rect.h);
      return {
        recordId: record.id,
        candidate: candidate.id,
        verdict: isTarget ? ('right' as const) : ('wrong' as const),
        t: record.t,
      };
    });
}

/**
 * Moves a log a whole number of days into the past. The extension stamps
 * clicks with the real clock, and a scripted run plays weeks of use in
 * minutes, so each simulated day is moved back to where it belongs.
 */
export function moveBack<T extends Pick<LogExport, 'records' | 'reviews' | 'counts'>>(
  log: T,
  days: number,
): T {
  return {
    ...log,
    records: log.records.map((record) => ({ ...record, t: record.t - days * DAY_MS })),
    reviews: log.reviews.map((review) => ({ ...review, t: review.t - days * DAY_MS })),
    counts: log.counts.map((count) => ({ ...count, day: addDays(count.day, -days) })),
  };
}
