import { describe, expect, it } from 'vitest';
import { distanceToRect } from '../src/core/geometry';
import { isLabeledMiss } from '../src/core/labels';
import { missRate, score } from '../src/core/metrics';
import { decide } from '../src/decision';
import { DEFAULT_OPTIONS, generate } from './generate';

const small = { ...DEFAULT_OPTIONS, days: 14, clicksPerDay: 600 };
const log = generate(small);

describe('generate', () => {
  it('gives the same log for the same seed and a different one for another seed', () => {
    expect(generate(small)).toEqual(log);
    expect(generate({ ...small, seed: 2 }).records).not.toEqual(log.records);
  });

  it('counts every simulated click once', () => {
    const clicks = log.counts.reduce((sum, c) => sum + c.clicks, 0);
    expect(clicks).toBe(small.days * small.clicksPerDay);
    for (const c of log.counts) expect(c.hits + c.emptyReacted + c.emptyIgnored).toBe(c.clicks);
  });

  it('writes records the way the extension does', () => {
    expect(log.records.length).toBeGreaterThan(100);
    for (const record of log.records) {
      const { candidates, path, reaction, reacted } = record.features;
      expect(candidates.length).toBeGreaterThan(0);
      candidates.forEach((candidate, i) => {
        expect(candidate.id).toBe(i);
        expect(candidate.dist).toBeLessThanOrEqual(30);
        expect(candidate.dist).toBeCloseTo(distanceToRect({ x: 0, y: 0 }, candidate.rect), 0);
        if (i > 0) expect(candidate.dist).toBeGreaterThanOrEqual(candidates[i - 1]!.dist);
      });
      for (const sample of path) {
        expect(sample.t).toBeLessThanOrEqual(0);
        expect(sample.t).toBeGreaterThanOrEqual(-300);
      }
      expect(reacted).toBe(Object.values(reaction).some(Boolean));
    }
  });

  it('reviews every control of every record, with at most one right', () => {
    const byRecord = new Map<string, string[]>();
    for (const review of log.reviews) {
      byRecord.set(review.recordId, [...(byRecord.get(review.recordId) ?? []), review.verdict]);
    }
    for (const record of log.records) {
      const controls = record.features.candidates.filter((c) => c.kind === 'control');
      const verdicts = byRecord.get(record.id) ?? [];
      expect(verdicts).toHaveLength(controls.length);
      expect(verdicts.filter((v) => v === 'right').length).toBeLessThanOrEqual(1);
    }
  });

  it('has a miss rate in the range the plan cares about', () => {
    const rate = missRate(log.records, log.counts, '2026-08-17');
    expect(rate.rate).toBeGreaterThan(0.005);
    expect(rate.rate).toBeLessThan(0.06);
    expect(log.records.filter(isLabeledMiss).length).toBeGreaterThan(50);
  });

  it('can be scored by the shipped decision', () => {
    const result = score(log.records, log.reviews, decide);
    expect(result.fires).toBeGreaterThan(0);
    expect(result.reviewed).toBe(result.fires);
    expect(result.recovery).toBeGreaterThan(0.2);
  });
});
