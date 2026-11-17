import { describe, expect, it } from 'vitest';
import { candidate, record } from '../src/core/testing';
import { clicks, DEFAULT_OPTIONS, type Plan } from '../synth/generate';
import { marksFor, moveBack } from './truth';

/** The first planned miss aimed at a control, from the generator itself. */
function aimedMiss(): Plan {
  for (const { plan } of clicks({ ...DEFAULT_OPTIONS, days: 1 })) {
    if (plan.intent === 'aim' && !plan.hit && plan.target) return plan;
  }
  throw new Error('no aimed miss in a day of clicks');
}

describe('marksFor', () => {
  const plan = aimedMiss();
  const origin = { x: 500, y: 300 };
  const point = { x: 640, y: 380 };
  // The target as the extension logs it: its box relative to the press.
  const { rect } = plan.target!;
  const target = candidate(0, 3, {
    rect: { x: origin.x + rect.x - point.x, y: origin.y + rect.y - point.y, w: rect.w, h: rect.h },
  });
  const other = candidate(1, 9);

  it('marks the control the user aimed at right and any other wrong', () => {
    const logged = record({ point, candidates: [target, other] });
    expect(marksFor(logged, plan, origin)).toEqual([
      { recordId: logged.id, candidate: 0, verdict: 'right', t: logged.t },
      { recordId: logged.id, candidate: 1, verdict: 'wrong', t: logged.t },
    ]);
  });

  it('allows the logged box to be a pixel off the drawn one, and no more', () => {
    const nudged = { ...target, rect: { ...target.rect, x: target.rect.x + 1 } };
    const moved = { ...target, rect: { ...target.rect, x: target.rect.x + 3 } };
    expect(marksFor(record({ point, candidates: [nudged] }), plan, origin)[0]!.verdict).toBe(
      'right',
    );
    expect(marksFor(record({ point, candidates: [moved] }), plan, origin)[0]!.verdict).toBe(
      'wrong',
    );
  });

  it('has no right target for a click meant for empty space', () => {
    const deliberate: Plan = { ...plan, intent: 'deliberate' };
    const marks = marksFor(record({ point, candidates: [target, other] }), deliberate, origin);
    expect(marks.map((mark) => mark.verdict)).toEqual(['wrong', 'wrong']);
  });

  it('leaves out regions heyo cannot see into, which are never fired at', () => {
    const canvas = candidate(1, 9, { kind: 'opaque', tag: 'canvas' });
    const marks = marksFor(record({ point, candidates: [target, canvas] }), plan, origin);
    expect(marks.map((mark) => mark.candidate)).toEqual([0]);
  });
});

describe('moveBack', () => {
  it('moves records, marks and day counts the same whole number of days', () => {
    const t = new Date(2026, 10, 3, 9, 30).getTime();
    const log = {
      records: [record({}, null, { t })],
      reviews: [{ recordId: 'r', candidate: 0, verdict: 'right' as const, t }],
      counts: [
        { day: '2026-11-03', site: 'a.test', clicks: 4, hits: 3, emptyReacted: 0, emptyIgnored: 1 },
      ],
    };
    const moved = moveBack(log, 5);
    expect(moved.records[0]!.t).toBe(t - 5 * 86_400_000);
    expect(moved.reviews[0]!.t).toBe(t - 5 * 86_400_000);
    expect(moved.counts[0]).toMatchObject({ day: '2026-10-29', clicks: 4 });
    expect(moveBack(log, 0)).toEqual(log);
  });
});
