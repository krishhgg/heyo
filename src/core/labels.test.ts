import { describe, expect, it } from 'vitest';
import { isDoublePress, isLabeledMiss, proxyTarget } from './labels';
import { candidate, hit, record } from './testing';

const near = { candidates: [candidate(0, 4)] };

describe('isLabeledMiss', () => {
  it('is an ignored click followed quickly by a hit on a nearby control', () => {
    expect(isLabeledMiss(record(near, hit(0, 4)))).toBe(true);
  });

  it('needs a follow-up', () => {
    expect(isLabeledMiss(record(near))).toBe(false);
  });

  it('rejects a follow-up after 1.5 seconds', () => {
    expect(isLabeledMiss(record(near, hit(0, 4, 1500)))).toBe(true);
    expect(isLabeledMiss(record(near, hit(0, 4, 1501)))).toBe(false);
  });

  it('rejects a follow-up on a control more than 30 px away', () => {
    expect(isLabeledMiss(record(near, hit(0, 30)))).toBe(true);
    expect(isLabeledMiss(record(near, hit(0, 30.5)))).toBe(false);
  });

  it('rejects a follow-up that hit empty space, text or an opaque region', () => {
    for (const kind of ['empty', 'text', 'opaque'] as const) {
      const followUp = { dt: 500, dx: 6, dy: 0, kind, candidate: null, dist: null };
      expect(isLabeledMiss(record(near, followUp))).toBe(false);
    }
  });

  it('rejects a click the page reacted to', () => {
    expect(isLabeledMiss(record({ ...near, reacted: true }, hit(0, 4)))).toBe(false);
  });

  it('counts a follow-up on a nearby control that was not logged as a candidate', () => {
    const followUp = { ...hit(0, 20), candidate: null };
    const miss = record(near, followUp);
    expect(isLabeledMiss(miss)).toBe(true);
    expect(proxyTarget(miss)).toBe(null);
  });
});

describe('proxyTarget', () => {
  it('is the candidate the user then clicked', () => {
    expect(proxyTarget(record(near, hit(0, 4)))).toBe(0);
  });

  it('is null when the record is not a labeled miss', () => {
    expect(proxyTarget(record(near, hit(0, 4, 5000)))).toBe(null);
  });
});

describe('isDoublePress', () => {
  it('is a second press in the same spot within 500 ms', () => {
    const second = { dt: 300, dx: 1, dy: -2, kind: 'empty' as const, candidate: null, dist: null };
    expect(isDoublePress(record(near, second))).toBe(true);
    expect(isDoublePress(record(near, { ...second, dt: 501 }))).toBe(false);
    expect(isDoublePress(record(near, { ...second, dx: 6 }))).toBe(false);
    expect(isDoublePress(record(near))).toBe(false);
  });
});
