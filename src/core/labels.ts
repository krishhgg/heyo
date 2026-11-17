// The proxy label from the plan. A labeled miss is an ignored empty-space click
// followed within 1.5 seconds by a real hit on a clickable element within 30 px.
import type { ClickRecord } from './types';

/** A follow-up press counts only if it comes this soon after the first press. */
export const FOLLOW_UP_WINDOW_MS = 1500;

/** The control the follow-up hit must be this close to the first click point. */
export const MISS_RADIUS_PX = 30;

/** A second press this soon and this close is the second half of a double-click. */
export const DOUBLE_PRESS_MS = 500;
export const DOUBLE_PRESS_PX = 5;

export function isLabeledMiss(record: ClickRecord): boolean {
  const next = record.followUp;
  return (
    !record.features.reacted &&
    next !== null &&
    next.dt <= FOLLOW_UP_WINDOW_MS &&
    next.kind === 'control' &&
    next.dist !== null &&
    next.dist <= MISS_RADIUS_PX
  );
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
