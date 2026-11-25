// What the scripted run knows about each click that the log does not: which
// control the user aimed at. It stands in for the hand review, as the
// generator's own marks do for a synthetic log.
import type { Point, Rect } from '../src/core/geometry';
import type { ClickRecord, DayCount, LogExport, Review } from '../src/core/types';
import type { Plan } from '../synth/generate';

/** How far a logged box may be from the drawn one and still be the same control, in px. */
const SAME_BOX_PX = 1.5;

/**
 * Review marks for one logged click. The control the user aimed at is right
 * and any other is wrong. A click meant for empty space has no right target.
 */
export function marksFor(record: ClickRecord, plan: Plan, origin: Point): Review[] {
  if (plan.intent !== 'aim' || !plan.target) return marksAt(record, null);
  const { rect } = plan.target;
  return marksAt(record, { ...rect, x: origin.x + rect.x, y: origin.y + rect.y });
}

/**
 * Review marks for one logged click, given the box of the control the user
 * aimed at in viewport px, or null when the click was meant for empty space.
 * The control with that box is right and any other is wrong.
 */
export function marksAt(record: ClickRecord, target: Rect | null): Review[] {
  const { point } = record.features;
  const near = (a: number, b: number) => Math.abs(a - b) <= SAME_BOX_PX;
  return record.features.candidates
    .filter((candidate) => candidate.kind === 'control')
    .map((candidate) => {
      const isTarget =
        target !== null &&
        near(point.x + candidate.rect.x, target.x) &&
        near(point.y + candidate.rect.y, target.y) &&
        near(candidate.rect.w, target.w) &&
        near(candidate.rect.h, target.h);
      return {
        recordId: record.id,
        candidate: candidate.id,
        verdict: isTarget ? ('right' as const) : ('wrong' as const),
        t: record.t,
      };
    });
}

/**
 * Puts one simulated day's log on the calendar day it stands for. The
 * extension stamps clicks with the real clock, and a scripted run plays weeks
 * of use in minutes, so each simulated day is moved to a date of its own. A
 * day played across midnight has clicks on two real dates. They all go to the
 * one date, each click keeping its time of day, and their counts are added.
 * Two simulated days can then never share a date.
 */
export function placeOn<T extends Pick<LogExport, 'records' | 'reviews' | 'counts'>>(
  log: T,
  day: string,
): T {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  // The same time of day on the given date, by the local clock, whatever the
  // clocks did in between.
  const move = (t: number) => {
    const at = new Date(t);
    return new Date(
      year,
      month - 1,
      date,
      at.getHours(),
      at.getMinutes(),
      at.getSeconds(),
      at.getMilliseconds(),
    ).getTime();
  };
  const counts = new Map<string, DayCount>();
  for (const count of log.counts) {
    const sum = counts.get(count.site);
    counts.set(count.site, {
      day,
      site: count.site,
      clicks: (sum?.clicks ?? 0) + count.clicks,
      hits: (sum?.hits ?? 0) + count.hits,
      emptyReacted: (sum?.emptyReacted ?? 0) + count.emptyReacted,
      emptyIgnored: (sum?.emptyIgnored ?? 0) + count.emptyIgnored,
    });
  }
  return {
    ...log,
    records: log.records.map((record) => ({ ...record, t: move(record.t) })),
    reviews: log.reviews.map((review) => ({ ...review, t: move(review.t) })),
    counts: [...counts.values()],
  };
}
