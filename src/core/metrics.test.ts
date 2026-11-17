import { describe, expect, it } from 'vitest';
import { missRate, score } from './metrics';
import { candidate, hit, record } from './testing';
import type { Decide, DayCount, Review } from './types';

/** Picks the nearest candidate within 12 px. */
const nearest: Decide = (f) => {
  const first = f.candidates[0];
  return first && first.dist <= 12
    ? { action: 'retarget', candidate: first.id }
    : { action: 'refuse', reason: 'too-far' };
};

const two = { candidates: [candidate(0, 4), candidate(1, 9)] };

describe('score', () => {
  it('counts a labeled miss as recovered when the decision picks the control the user then clicked', () => {
    const result = score([record(two, hit(0, 4))], [], nearest);
    expect(result).toMatchObject({ misses: 1, recovered: 1, recovery: 1, fires: 1, proxyWrong: 0 });
  });

  it('counts a fire on a different control than the user then clicked as a proxy wrong', () => {
    const result = score([record(two, hit(1, 9))], [], nearest);
    expect(result).toMatchObject({ misses: 1, recovered: 0, recovery: 0, fires: 1, proxyWrong: 1 });
  });

  it('does not recover a miss the decision refused', () => {
    const far = { candidates: [candidate(0, 20)] };
    const result = score([record(far, hit(0, 20))], [], nearest);
    expect(result).toMatchObject({ misses: 1, recovered: 0, fires: 0, proxyWrong: 0 });
  });

  it('counts fires with no retry, which are not labeled misses', () => {
    const result = score([record(two)], [], nearest);
    expect(result).toMatchObject({ misses: 0, recovery: null, fires: 1 });
  });

  it('applies a review only to the control it judged', () => {
    const fired = record(two);
    const reviews: Review[] = [
      { recordId: fired.id, candidate: 1, verdict: 'wrong', t: 1 },
      { recordId: 'another', candidate: 0, verdict: 'wrong', t: 1 },
    ];
    expect(score([fired], reviews, nearest)).toMatchObject({ reviewed: 0, wrong: 0 });
  });

  it('counts right and wrong reviews and bounds the wrong-target rate', () => {
    const records = Array.from({ length: 300 }, () => record(two));
    const reviews: Review[] = records.map((r) => ({
      recordId: r.id,
      candidate: 0,
      verdict: 'right',
      t: 1,
    }));
    const clean = score(records, reviews, nearest);
    expect(clean).toMatchObject({ fires: 300, reviewed: 300, wrong: 0 });
    expect(clean.wrongUpper).toBeLessThan(0.01);

    reviews[0] = { ...reviews[0]!, verdict: 'wrong' };
    const one = score(records, reviews, nearest);
    expect(one).toMatchObject({ reviewed: 300, wrong: 1 });
    expect(one.wrongUpper).toBeGreaterThan(0.01);
  });

  it('keeps the latest review of a pair and leaves unsure out of the reviewed count', () => {
    const fired = record(two);
    const reviews: Review[] = [
      { recordId: fired.id, candidate: 0, verdict: 'wrong', t: 1 },
      { recordId: fired.id, candidate: 0, verdict: 'unsure', t: 2 },
    ];
    expect(score([fired], reviews, nearest)).toMatchObject({
      reviewed: 0,
      wrong: 0,
      unsure: 1,
      wrongUpper: null,
    });
  });

  it('counts fires followed by a second press in the same spot', () => {
    const second = { dt: 250, dx: 0, dy: 1, kind: 'empty' as const, candidate: null, dist: null };
    expect(score([record(two, second), record(two)], [], nearest).doublePress).toBe(1);
  });
});

describe('missRate', () => {
  const day = (d: string, clicks: number): DayCount => ({
    day: d,
    site: 'example.test',
    clicks,
    hits: clicks,
    emptyReacted: 0,
    emptyIgnored: 0,
  });

  it('divides labeled misses by all clicks and by active days', () => {
    const records = [record(two, hit(0, 4)), record(two, hit(0, 4)), record(two)];
    const counts = [day('2026-11-02', 300), day('2026-11-03', 100), day('2026-11-04', 0)];
    expect(missRate(records, counts, '2026-11-04')).toEqual({
      elapsedDays: 3,
      activeDays: 2,
      clicks: 400,
      misses: 2,
      masked: 0,
      rate: 0.005,
      perDay: 1,
    });
  });

  it('counts elapsed calendar days through today, including days with no clicks', () => {
    const counts = [day('2026-11-02', 10), day('2026-11-05', 10)];
    expect(missRate([], counts, '2026-11-15')).toMatchObject({ elapsedDays: 14, activeDays: 2 });
    expect(missRate([], counts, '2026-11-05')).toMatchObject({ elapsedDays: 4, activeDays: 2 });
  });

  it('counts a retried click on a page that changes on its own as masked, not as a miss', () => {
    const mutation = {
      mutation: true,
      focus: false,
      selection: false,
      scroll: false,
      navigation: false,
    };
    const churned = { ...two, reacted: true, reaction: mutation, churn: true };
    const records = [
      record(churned, hit(0, 4)),
      record({ ...churned, churn: false }, hit(0, 4)),
      record({ ...churned, reaction: { ...mutation, focus: true } }, hit(0, 4)),
      record(churned),
    ];
    expect(missRate(records, [day('2026-11-02', 50)], '2026-11-02')).toMatchObject({
      misses: 0,
      masked: 1,
    });
  });

  it('has no rate without clicks', () => {
    expect(missRate([], [], '2026-11-04')).toEqual({
      elapsedDays: 0,
      activeDays: 0,
      clicks: 0,
      misses: 0,
      masked: 0,
      rate: null,
      perDay: null,
    });
  });
});
