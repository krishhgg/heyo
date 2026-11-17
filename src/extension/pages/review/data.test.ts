import { describe, expect, it } from 'vitest';
import { candidate, record } from '../../../core/testing';
import type { Decide } from '../../../core/types';
import { firesOf, kindOf, nameOf, reviewKey, verdictsOf } from './data';

const pickFirst: Decide = (f) =>
  f.candidates[0]
    ? { action: 'retarget', candidate: f.candidates[0].id }
    : { action: 'refuse', reason: 'no-candidate' };

describe('firesOf', () => {
  it('keeps only the clicks the decision would retarget', () => {
    const fired = record({ candidates: [candidate(0, 3)] });
    const refused = record({ candidates: [] });
    const fires = firesOf([fired, refused], pickFirst);
    expect(fires.map((f) => f.record.id)).toEqual([fired.id]);
    expect(fires[0]!.picked.id).toBe(0);
  });

  it('orders fires the same way every time, and not by time', () => {
    const records = Array.from({ length: 40 }, (_, i) =>
      record({ candidates: [candidate(0, 3)] }, null, { id: `click-${i}`, t: i }),
    );
    const order = firesOf(records, pickFirst).map((f) => f.record.id);
    expect(firesOf([...records].reverse(), pickFirst).map((f) => f.record.id)).toEqual(order);
    expect(order).not.toEqual(records.map((r) => r.id));
    expect([...order].sort()).toEqual(records.map((r) => r.id).sort());
  });
});

describe('verdictsOf', () => {
  it('keeps the latest mark for each click and control', () => {
    const fire = firesOf([record({ candidates: [candidate(0, 3)] })], pickFirst)[0]!;
    const recordId = fire.record.id;
    const verdicts = verdictsOf([
      { recordId, candidate: 0, verdict: 'wrong', t: 1 },
      { recordId, candidate: 0, verdict: 'right', t: 2 },
      { recordId, candidate: 1, verdict: 'unsure', t: 3 },
    ]);
    expect(verdicts.get(reviewKey(fire))).toBe('right');
    expect(verdicts.size).toBe(2);
  });
});

describe('kindOf and nameOf', () => {
  it('names controls in plain words', () => {
    expect(kindOf(candidate(0, 1))).toBe('button');
    expect(kindOf(candidate(0, 1, { tag: 'a' }))).toBe('link');
    expect(kindOf(candidate(0, 1, { tag: 'span', role: 'tab' }))).toBe('tab');
    expect(kindOf(candidate(0, 1, { tag: 'input', type: 'password' }))).toBe('password field');
    expect(kindOf(candidate(0, 1, { tag: 'input', type: 'text' }))).toBe('text field');
    expect(kindOf(candidate(0, 1, { tag: 'div', signals: ['cursor'] }))).toBe(
      'div with a pointer cursor',
    );
    expect(kindOf(candidate(0, 1, { tag: 'div', signals: ['listener'] }))).toBe(
      'div with a click handler',
    );
  });

  it('falls back to the kind when a control has no label', () => {
    expect(nameOf(candidate(0, 1, { label: 'Save' }))).toBe('Save');
    expect(nameOf(candidate(0, 1, { label: '' }))).toBe('unnamed button');
  });
});
