import { describe, expect, it } from 'vitest';
import { lowerBound, trialsNeeded, upperBound } from './stats';

describe('upperBound', () => {
  it('matches the closed form for zero events', () => {
    for (const n of [10, 100, 300, 5000]) {
      expect(upperBound(0, n)).toBeCloseTo(1 - 0.05 ** (1 / n), 10);
    }
  });

  it('matches reference values from exact integer arithmetic', () => {
    // Computed outside this module by solving the binomial sum with Python's math.comb.
    expect(upperBound(1, 10)).toBeCloseTo(0.394163, 5);
    expect(upperBound(5, 50)).toBeCloseTo(0.198833, 5);
    expect(upperBound(3, 300)).toBeCloseTo(0.025641, 5);
    expect(upperBound(12, 200)).toBeCloseTo(0.095401, 5);
  });

  it('is 1 with no trials or all events', () => {
    expect(upperBound(0, 0)).toBe(1);
    expect(upperBound(7, 7)).toBe(1);
  });

  it('stays finite for a large sample', () => {
    expect(upperBound(0, 100000)).toBeCloseTo(1 - 0.05 ** (1 / 100000), 9);
    expect(upperBound(900, 100000)).toBeGreaterThan(0.009);
    expect(upperBound(900, 100000)).toBeLessThan(0.0096);
  });
});

describe('lowerBound', () => {
  it('is 0 with no events', () => {
    expect(lowerBound(0, 50)).toBe(0);
  });

  it('matches reference values from exact integer arithmetic', () => {
    expect(lowerBound(1, 10)).toBeCloseTo(0.005116, 5);
    expect(lowerBound(5, 50)).toBeCloseTo(0.040237, 5);
    expect(lowerBound(12, 200)).toBeCloseTo(0.034982, 5);
  });

  it('sits below the observed rate, which sits below the upper bound', () => {
    expect(lowerBound(12, 200)).toBeLessThan(12 / 200);
    expect(upperBound(12, 200)).toBeGreaterThan(12 / 200);
  });
});

describe('trialsNeeded', () => {
  it('needs 299 clean trials for a 1% ceiling', () => {
    expect(trialsNeeded(0, 0.01)).toBe(299);
    expect(upperBound(0, 299)).toBeLessThan(0.01);
    expect(upperBound(0, 298)).toBeGreaterThanOrEqual(0.01);
  });

  it('needs more trials for each event found', () => {
    const one = trialsNeeded(1, 0.01);
    const two = trialsNeeded(2, 0.01);
    expect(one).toBe(473);
    expect(two).toBeGreaterThan(one);
    expect(upperBound(1, one)).toBeLessThan(0.01);
    expect(upperBound(1, one - 1)).toBeGreaterThanOrEqual(0.01);
  });
});
