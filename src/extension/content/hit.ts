// Classifies where a press landed: on a control, on an opaque region, on text,
// or on empty space.
import type { HitKind } from '../../core/types';
import { closestClickable, type Clickable, type HasListener } from './clickable';
import { flatChildren } from './dom';

/** The text nodes a press on an element can land on: its own, and those slotted into it. */
function ownTextNodes(target: Element): Node[] {
  const nodes: Node[] = [];
  for (const child of flatChildren(target)) {
    if (child.nodeType === Node.TEXT_NODE) nodes.push(child);
    else if (child instanceof HTMLSlotElement) {
      nodes.push(...flatChildren(child).filter((node) => node.nodeType === Node.TEXT_NODE));
    }
  }
  return nodes;
}

/**
 * True when the point is on a line of the target's own text. A click on text
 * is delivered to the element that holds the text node, so only the target's
 * direct text matters. This also works inside shadow roots and for slotted text.
 *
 * A glyph box is as tall as the font, not the line. The space between two
 * lines of a paragraph belongs to the text, so each box is grown to the line's
 * full height.
 */
export function isOverText(target: Element, x: number, y: number): boolean {
  const lineHeight = Number.parseFloat(getComputedStyle(target).lineHeight);
  const range = document.createRange();
  for (const node of ownTextNodes(target)) {
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      const grow = Number.isFinite(lineHeight) ? Math.max(0, (lineHeight - rect.height) / 2) : 0;
      if (x >= rect.left && x <= rect.right && y >= rect.top - grow && y <= rect.bottom + grow) {
        return true;
      }
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
