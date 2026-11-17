// The proxy label from the plan. A labeled miss is an ignored empty-space click
// followed within 1.5 seconds by a real hit on a clickable element within 30 px.
import { SEARCH_RADIUS_PX, type ClickRecord } from './types';

/** A follow-up press counts only if it comes this soon after the first press. */
export const FOLLOW_UP_WINDOW_MS = 1500;

/** The control the follow-up hit must be this close to the first click point. */
export const MISS_RADIUS_PX = SEARCH_RADIUS_PX;

/** A second press this soon and this close is the second half of a double-click. */
export const DOUBLE_PRESS_MS = 500;
export const DOUBLE_PRESS_PX = 5;

/**
 * True when heyo sent this click on. The user then has nothing to retry, so
 * the press that follows is not a correction and the record cannot be a miss.
 */
export function wasSent(record: ClickRecord): boolean {
  return record.fire?.outcome === 'sent';
}

export function isLabeledMiss(record: ClickRecord): boolean {
  return !record.features.reacted && !wasSent(record) && retriedNearby(record);
}

/** Share of fires held back as a control once retargeting is on. */
export const HELD_SHARE = 0.1;

/**
 * How many labeled misses a record stands for. In shadow mode that is one or
 * none. With retargeting on, nine fires in ten are sent on and can no longer
 * be labeled, and the tenth is held back. A held miss stands for itself and
 * for the nine that were sent, or every number built on misses would sink the
 * moment retargeting started to work.
 */
export function missWeight(record: ClickRecord): number {
  if (!isLabeledMiss(record)) return 0;
  return record.fire?.outcome === 'held' ? 1 / HELD_SHARE : 1;
}

/** True when a follow-up press is a real hit on a control within the miss radius, soon enough. */
function retriedNearby(record: ClickRecord): boolean {
  const next = record.followUp;
  return (
    next !== null &&
    next.dt <= FOLLOW_UP_WINDOW_MS &&
    next.kind === 'control' &&
    next.dist !== null &&
    next.dist <= MISS_RADIUS_PX
  );
}

/**
 * A click that may be a miss the label cannot see. The user retried nearby, but
 * the only reaction was a DOM change on a page whose DOM was already changing
 * before the press. Such a page makes every click look reacted to.
 */
export function isMaskedMiss(record: ClickRecord): boolean {
  const { reaction, churn } = record.features;
  const onlyMutation =
    reaction.mutation &&
    !reaction.focus &&
    !reaction.selection &&
    !reaction.scroll &&
    !reaction.navigation;
  return onlyMutation && churn === true && retriedNearby(record);
}

/** The candidate the user went on to click, which stands in for the true target. Null when it was not logged. */
export function proxyTarget(record: ClickRecord): number | null {
  return isLabeledMiss(record) ? (record.followUp?.candidate ?? null) : null;
}

/** The user pressed again in the same spot within the double-click interval. */
export function isDoublePress(record: ClickRecord): boolean {
  const next = record.followUp;
  return (
    next !== null && next.dt <= DOUBLE_PRESS_MS && Math.hypot(next.dx, next.dy) <= DOUBLE_PRESS_PX
  );
}
