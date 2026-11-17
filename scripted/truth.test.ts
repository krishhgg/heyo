import { describe, expect, it } from 'vitest';
import { candidate, record } from '../src/core/testing';
import { clicks, DEFAULT_OPTIONS, type Plan } from '../synth/generate';
import { marksFor, placeOn } from './truth';

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

describe('placeOn', () => {
  const count = (day: string, site: string, clicks: number) => ({
    day,
    site,
    clicks,
    hits: clicks - 1,
    emptyReacted: 0,
    emptyIgnored: 1,
  });

  it('moves records, marks and day counts to the day', () => {
    const t = new Date(2026, 10, 3, 9, 30).getTime();
    const log = {
      records: [record({}, null, { t })],
      reviews: [{ recordId: 'r', candidate: 0, verdict: 'right' as const, t }],
      counts: [count('2026-11-03', 'a.test', 4)],
    };
    const moved = placeOn(log, '2026-10-29');
    expect(moved.records[0]!.t).toBe(new Date(2026, 9, 29, 9, 30).getTime());
    expect(moved.reviews[0]!.t).toBe(moved.records[0]!.t);
    expect(moved.counts).toEqual([count('2026-10-29', 'a.test', 4)]);
    expect(placeOn(log, '2026-11-03')).toEqual(log);
  });

  it('puts a day played across midnight on one date, and adds its counts', () => {
    const before = new Date(2026, 10, 3, 23, 58).getTime();
    const after = new Date(2026, 10, 4, 0, 3).getTime();
    const log = {
      records: [record({}, null, { t: before }), record({}, null, { t: after })],
      reviews: [],
      counts: [
        count('2026-11-03', 'a.test', 4),
        count('2026-11-04', 'a.test', 6),
        count('2026-11-04', 'b.test', 2),
      ],
    };
    const moved = placeOn(log, '2026-10-01');
    expect(moved.records.map((r) => new Date(r.t).getDate())).toEqual([1, 1]);
    expect(moved.records.map((r) => new Date(r.t).getHours())).toEqual([23, 0]);
    expect(moved.counts).toEqual([
      { day: '2026-10-01', site: 'a.test', clicks: 10, hits: 8, emptyReacted: 0, emptyIgnored: 2 },
      count('2026-10-01', 'b.test', 2),
    ]);
  });
});
