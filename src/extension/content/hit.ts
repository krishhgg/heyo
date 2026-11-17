// Classifies where a press landed: on a control, on an opaque region, on text,
// or on empty space.
import type { HitKind } from '../../core/types';
import { closestClickable, type Clickable, type HasListener } from './clickable';
import { flatChildren } from './dom';

/** How deep into inline children the text test looks, and how many text nodes it reads. */
const INLINE_DEPTH = 4;
const MAX_TEXT_NODES = 500;

/** True when `child`, or something between it and `ancestor`, is a control. */
function isControlWithin(child: Element, ancestor: Element, hasListener: HasListener): boolean {
  const clickable = closestClickable(child, hasListener);
  return (
    clickable !== null && clickable.element !== ancestor && !clickable.element.contains(ancestor)
  );
}

/**
 * True when the point is on a line of the target's text. A click on text is
 * delivered to the element that holds it, so only the target's own lines
 * matter: its own text nodes, those slotted into it, and those inside inline
 * children such as a bold or highlighted run. A press between two lines goes
 * to the paragraph, whose words may all sit inside such children. An inline
 * child that is a control, such as a link, is left out, so the gap beside a
 * link stays empty space. This also works inside shadow roots.
 *
 * A glyph box is as tall as the font, not the line. The space between two
 * lines of a paragraph belongs to the text, so each box is grown to the line's
 * full height.
 */
export function isOverText(
  target: Element,
  x: number,
  y: number,
  hasListener: HasListener,
): boolean {
  const lineHeight = Number.parseFloat(getComputedStyle(target).lineHeight);
  const range = document.createRange();
  let read = 0;

  const onLine = (node: Node): boolean => {
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      const grow = Number.isFinite(lineHeight) ? Math.max(0, (lineHeight - rect.height) / 2) : 0;
      if (x >= rect.left && x <= rect.right && y >= rect.top - grow && y <= rect.bottom + grow) {
        return true;
      }
    }
    return false;
  };

  // Each text node is tested as the walk reaches it, and the walk stops at a limit,
  // so a block with thousands of runs cannot hold up the page's own handlers.
  const walk = (element: Element, depth: number): boolean => {
    for (const child of flatChildren(element)) {
      if (read >= MAX_TEXT_NODES) return false;
      if (child.nodeType === Node.TEXT_NODE) {
        read++;
        if (onLine(child)) return true;
      } else if (!(child instanceof Element) || depth === 0) {
        continue;
      } else if (child instanceof HTMLSlotElement) {
        if (walk(child, depth)) return true;
      } else if (
        getComputedStyle(child).display === 'inline' &&
        !isControlWithin(child, element, hasListener)
      ) {
        if (walk(child, depth - 1)) return true;
      }
    }
    return false;
  };
  return walk(target, INLINE_DEPTH);
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
  if (isOverText(target, x, y, hasListener)) return { kind: 'text', clickable: null };
  return { kind: 'empty', clickable: null };
}
