// Classifies where a press landed: on a control, on an opaque region, on text,
// or on empty space.
import type { HitKind } from '../../core/types';
import { closestClickable, type Clickable, type HasListener } from './clickable';

/**
 * True when the point is on a glyph box of the target's own text. A click on
 * text is delivered to the element that holds the text node, so only the
 * target's direct text children matter. This also works inside shadow roots.
 */
export function isOverText(target: Element, x: number, y: number): boolean {
  const range = document.createRange();
  for (const child of target.childNodes) {
    if (child.nodeType !== Node.TEXT_NODE) continue;
    range.selectNodeContents(child);
    for (const rect of range.getClientRects()) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
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

/** Classifies a press from the deepest element under it and its position. */
export function classifyHit(target: Element, x: number, y: number, hasListener: HasListener): Hit {
  const clickable = closestClickable(target, hasListener);
  if (clickable) return { kind: clickable.kind, clickable };
  // A scrollbar is the browser's own control. Count it as an opaque region.
  if (isOnScrollbar(target, x, y)) return { kind: 'opaque', clickable: null };
  if (isOverText(target, x, y)) return { kind: 'text', clickable: null };
  return { kind: 'empty', clickable: null };
}
