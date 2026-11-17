import { describe, expect, it } from 'vitest';
import { candidate, record } from '../../../core/testing';
import type { Decide } from '../../../core/types';
import {
  beside,
  firesOf,
  kindOf,
  nameOf,
  percentBeside,
  plural,
  reviewKey,
  verdictsOf,
} from './data';

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

describe('percentBeside', () => {
  it('shows the usual decimals when the value is clear of the limit', () => {
    expect(percentBeside(0.0058, 0.01)).toBe('0.58%');
    expect(percentBeside(0.0153, 0.01)).toBe('1.53%');
    expect(percentBeside(0.62, 0.5, 0)).toBe('62%');
    expect(percentBeside(null, 0.01)).toBe('none yet');
  });

  it('adds decimals until a value right beside the limit can be told from it', () => {
    // 299 marks with none wrong: the bound is just under the 1% it has to stay under.
    expect(percentBeside(0.009969, 0.01)).toBe('0.997%');
    // 124 recovered of 250 is a fail, and must not read as the 50% it needs.
    expect(percentBeside(124 / 250, 0.5, 0)).toBe('49.6%');
    expect(percentBeside(0.00496, 0.005)).toBe('0.496%');
    expect(percentBeside(0.01, 0.01)).toBe('1.00%');
  });
});

describe('beside', () => {
  it('tells 2.96 misses a day from the 3 it needs', () => {
    expect(beside(2.96, 3, 1)).toBe('2.96');
    expect(beside(3.4, 3, 1)).toBe('3.4');
    expect(beside(3, 3, 1)).toBe('3.0');
  });
});

describe('the words for a control', () => {
  it('calls button-like inputs buttons and names the other kinds', () => {
    const input = (type: string) => kindOf(candidate(0, 3, { tag: 'input', type }));
    expect(input('submit')).toBe('button');
    expect(input('checkbox')).toBe('checkbox');
    expect(input('radio')).toBe('radio button');
    expect(input('email')).toBe('email field');
    expect(input('text')).toBe('text field');
  });

  it('uses plain words for ARIA roles', () => {
    const role = (name: string) => kindOf(candidate(0, 3, { tag: 'div', role: name }));
    expect(role('menuitem')).toBe('menu item');
    expect(role('combobox')).toBe('dropdown');
    expect(role('tab')).toBe('tab');
  });

  it('counts one thing in the singular', () => {
    expect(plural(1, 'click')).toBe('1 click');
    expect(plural(4, 'click')).toBe('4 clicks');
    expect(plural(1234, 'review mark')).toBe('1,234 review marks');
  });
});
