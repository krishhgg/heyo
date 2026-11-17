export interface Point {
  x: number;
  y: number;
}

/** A rectangle given by its top-left corner and its size. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Distance in px from a point to the nearest edge of a rect, or 0 if the point is inside it. */
export function distanceToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** The point of a rect closest to p. It is p itself when p is inside the rect. */
export function nearestPointInRect(p: Point, r: Rect): Point {
  return {
    x: Math.min(Math.max(p.x, r.x), r.x + r.w),
    y: Math.min(Math.max(p.y, r.y), r.y + r.h),
  };
}
