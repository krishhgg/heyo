// Classifies where a press landed: on a control, on an opaque region, on text,
// or on empty space.
import type { HitKind } from '../../core/types';
import { closestClickable, type Clickable, type HasListener } from './clickable';

/** True when the point is on a rendered glyph box, not merely near some text. */
export function isOverText(x: number, y: number): boolean {
  const range = document.caretRangeFromPoint(x, y);
  if (!range) return false;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;
  const length = (node as Text).length;
  const probe = document.createRange();
  probe.setStart(node, Math.max(0, range.startOffset - 1));
  probe.setEnd(node, Math.min(length, range.startOffset + 1));
  for (const rect of probe.getClientRects()) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
  }
  return false;
}

/** True when the point is on an element's own scrollbar. */
function isOnScrollbar(target: Element, x: number, y: number): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const rect = target.getBoundingClientRect();
  const right = rect.left + target.clientLeft + target.clientWidth;
  const bottom = rect.top + target.clientTop + target.clientHeight;
  const hasVertical = target.offsetWidth - target.clientWidth - 2 * target.clientLeft > 0;
  const hasHorizontal = target.offsetHeight - target.clientHeight - 2 * target.clientTop > 0;
  return (hasVertical && x >= right) || (hasHorizontal && y >= bottom);
}

export interface Hit {
  kind: HitKind;
  /** The control or opaque region the press reached. Null for text and empty space. */
  clickable: Clickable | null;
}

/** Classifies a press from its event target and position. */
export function classifyHit(
  target: EventTarget | null,
  x: number,
  y: number,
  hasListener: HasListener,
): Hit {
  if (!(target instanceof Element)) return { kind: 'empty', clickable: null };
  const clickable = closestClickable(target, hasListener);
  if (clickable) return { kind: clickable.kind, clickable };
  // A scrollbar is the browser's own control. Count it as an opaque region.
  if (isOnScrollbar(target, x, y)) return { kind: 'opaque', clickable: null };
  if (isOverText(x, y)) return { kind: 'text', clickable: null };
  return { kind: 'empty', clickable: null };
}
