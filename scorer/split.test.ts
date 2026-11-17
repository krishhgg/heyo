import { describe, expect, it } from 'vitest';
import { candidate, record } from '../src/core/testing';
import { splitter } from './split';

const WEEK = 7 * 86_400_000;
const start = Date.UTC(2026, 7, 3);

function at(week: number, site: string) {
  return record({ candidates: [candidate(0, 3)] }, null, { t: start + week * WEEK + 1000, site });
}

describe('splitter', () => {
  const sites = Array.from({ length: 200 }, (_, i) => `site-${i}.example`);
  const records = sites.flatMap((site) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((w) => at(w, site)));
  const split = splitter(records);

  it('holds out the latest weeks', () => {
    expect(split.weeks).toBe(10);
    expect(split.testWeeks).toBe(3);
    for (const record of records.filter((r) => r.t >= start + 7 * WEEK)) {
      expect(split.of(record)).toBe('test');
    }
  });

  it('holds out about a quarter of the sites, whole', () => {
    const early = records.filter((r) => r.t < start + 7 * WEEK);
    const testSites = new Set(early.filter((r) => split.of(r) === 'test').map((r) => r.site));
    const trainSites = new Set(early.filter((r) => split.of(r) === 'train').map((r) => r.site));
    expect(testSites.size).toBeGreaterThan(30);
    expect(testSites.size).toBeLessThan(70);
    for (const site of testSites) expect(trainSites.has(site)).toBe(false);
  });

  it('puts a record in the same split every time', () => {
    const again = splitter([...records].reverse());
    for (const record of records) expect(again.of(record)).toBe(split.of(record));
  });

  it('splits by site alone when the log covers one week', () => {
    const oneWeek = sites.map((site) => at(0, site));
    const single = splitter(oneWeek);
    expect(single.testWeeks).toBe(0);
    const test = oneWeek.filter((r) => single.of(r) === 'test').length;
    expect(test).toBeGreaterThan(30);
    expect(test).toBeLessThan(70);
  });
});

describe('a very large log', () => {
  it('is split without running out of call arguments', () => {
    // More records than a single call can take as arguments.
    const many = Array.from({ length: 200_000 }, (_, i) => at(i % 10, `site-${i % 50}.example`));
    const split = splitter(many);
    expect(split.weeks).toBe(10);
    expect(split.of(many.at(-1)!)).toBe('test');
  });
});
