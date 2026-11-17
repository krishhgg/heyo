import { describe, expect, it } from 'vitest';
import { distanceToRect, nearestPointInRect } from './geometry';

const rect = { x: 10, y: 20, w: 100, h: 30 };

describe('distanceToRect', () => {
  it('is 0 inside the rect and on its edge', () => {
    expect(distanceToRect({ x: 50, y: 30 }, rect)).toBe(0);
    expect(distanceToRect({ x: 10, y: 20 }, rect)).toBe(0);
    expect(distanceToRect({ x: 110, y: 50 }, rect)).toBe(0);
  });

  it('measures straight out from an edge', () => {
    expect(distanceToRect({ x: 4, y: 30 }, rect)).toBe(6);
    expect(distanceToRect({ x: 115, y: 30 }, rect)).toBe(5);
    expect(distanceToRect({ x: 50, y: 12 }, rect)).toBe(8);
    expect(distanceToRect({ x: 50, y: 57 }, rect)).toBe(7);
  });

  it('measures to the corner when the point is diagonal to the rect', () => {
    expect(distanceToRect({ x: 7, y: 16 }, rect)).toBe(5);
    expect(distanceToRect({ x: 113, y: 54 }, rect)).toBe(5);
  });
});

describe('nearestPointInRect', () => {
  it('returns the point itself when it is inside', () => {
    expect(nearestPointInRect({ x: 50, y: 30 }, rect)).toEqual({ x: 50, y: 30 });
  });

  it('clamps an outside point to the nearest edge or corner', () => {
    expect(nearestPointInRect({ x: 0, y: 30 }, rect)).toEqual({ x: 10, y: 30 });
    expect(nearestPointInRect({ x: 200, y: 100 }, rect)).toEqual({ x: 110, y: 50 });
  });
});
