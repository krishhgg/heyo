// Finds the controls and opaque regions near an empty-space click.
import type { Rect } from '../../core/geometry';
import { distanceToRect } from '../../core/geometry';
import type { Candidate } from '../../core/types';
import { closestClickable, isDisabled, roleOf, tagOf, type HasListener } from './clickable';
import { labelOf } from './describe';
import { elementAt } from './dom';

/** The log keeps candidates out to the labeled-miss radius. */
const RADII = [2, 4, 6, 8, 10, 12, 15, 18, 21, 24, 27, 30];

/** Px between neighboring sample points along a ring. */
const SPACING = 4;

const MAX_CANDIDATES = 8;

/** Sample offsets on rings around the click point, nearest ring first. */
const OFFSETS: { dx: number; dy: number }[] = RADII.flatMap((radius) => {
  const count = Math.max(8, Math.ceil((2 * Math.PI * radius) / SPACING));
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count;
    return { dx: radius * Math.cos(angle), dy: radius * Math.sin(angle) };
  });
});

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** An element's box nearest a point, relative to that point, and its distance. */
function nearestBox(element: Element, x: number, y: number): { rect: Rect; dist: number } | null {
  let best: { rect: Rect; dist: number } | null = null;
  for (const box of element.getClientRects()) {
    if (box.width === 0 || box.height === 0) continue;
    const rect = { x: box.left - x, y: box.top - y, w: box.width, h: box.height };
    const dist = distanceToRect({ x: 0, y: 0 }, rect);
    if (!best || dist < best.dist) best = { rect, dist };
  }
  return best;
}

function roundRect(rect: Rect): Rect {
  return { x: round(rect.x), y: round(rect.y), w: round(rect.w), h: round(rect.h) };
}

/**
 * The box of a control nearest a point. A control can have no box of its own,
 * such as a link whose only content is absolutely positioned. Then the box of
 * the element inside it that the click would land on stands in.
 */
export function boxOf(
  control: Element,
  inside: Element,
  x: number,
  y: number,
): { rect: Rect; dist: number } | null {
  const box = nearestBox(control, x, y) ?? nearestBox(inside, x, y);
  return box ? { rect: roundRect(box.rect), dist: round(box.dist) } : null;
}

export interface Found {
  candidates: Candidate[];
  /** The element behind each candidate, in the same order. */
  elements: Element[];
}

/**
 * Samples rings of points around the click and collects what a click at each
 * point would reach. Only the topmost element at a point counts, because a
 * click there would go to it and nothing beneath it.
 */
export function findCandidates(
  x: number,
  y: number,
  hasListener: HasListener,
  typed: string[],
): Found {
  const seen = new Set<Element>();
  const found = new Map<Element, Candidate>();
  for (const { dx, dy } of OFFSETS) {
    const px = x + dx;
    const py = y + dy;
    if (px < 0 || py < 0 || px >= window.innerWidth || py >= window.innerHeight) continue;
    const top = elementAt(px, py);
    if (!top || seen.has(top)) continue;
    seen.add(top);
    const clickable = closestClickable(top, hasListener);
    if (!clickable || found.has(clickable.element)) continue;
    const { element, kind, signals } = clickable;
    const box = boxOf(element, top, x, y);
    if (!box) continue;
    const label = kind === 'control' ? labelOf(element, typed) : { text: '', redacted: false };
    found.set(element, {
      id: 0,
      kind,
      dist: box.dist,
      rect: box.rect,
      tag: tagOf(element),
      role: roleOf(element),
      type: element.getAttribute('type'),
      signals,
      label: label.text,
      redacted: label.redacted,
      disabled: isDisabled(element),
    });
  }
  // Nearest first. Equal distances go top to bottom, then left to right, so the order is stable.
  const nearest = [...found.entries()]
    .sort(([, a], [, b]) => a.dist - b.dist || a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    .slice(0, MAX_CANDIDATES);
  return {
    candidates: nearest.map(([, candidate], id) => ({ ...candidate, id })),
    elements: nearest.map(([element]) => element),
  };
}
