import { describe, expect, it } from 'vitest';
import { candidate, hit, record } from '../src/core/testing';
import type { ClickRecord, FollowUp, LogExport } from '../src/core/types';
import { join, type PracticeLog, type PracticePress } from './join';

const point = { x: 400, y: 300 };
// Two buttons as the extension logs them: boxes relative to the press.
const near = candidate(0, 3);
const far = candidate(1, 12);
// The near one's box in viewport px.
const nearBox = { x: point.x + near.rect.x, y: point.y + near.rect.y, w: 80, h: 30 };
const farBox = { x: point.x + far.rect.x, y: point.y + far.rect.y, w: 80, h: 30 };

function logged(
  overrides: Partial<ClickRecord> = {},
  followUp: FollowUp | null = hit(0, 3),
): ClickRecord {
  return record({ point, candidates: [near, far] }, followUp, overrides);
}

function press(t: number, overrides: Partial<PracticePress> = {}): PracticePress {
  return { t, x: point.x, y: point.y, on: 'empty', target: nearBox, scene: 'inbox', ...overrides };
}

function practice(presses: PracticePress[]): PracticeLog {
  return { format: 'heyo-practice', v: 1, trials: 10, hits: 10, done: true, presses };
}

function exported(records: ClickRecord[]): LogExport {
  return {
    format: 'heyo-log',
    v: 1,
    exportedAt: 0,
    extensionVersion: 'test',
    decisionVersion: 'test',
    records,
    reviews: [],
    counts: [],
  };
}

describe('join', () => {
  it('marks the lit control right and the others wrong', () => {
    const r = logged();
    const { log, tally } = join(exported([r]), practice([press(r.t)]));
    expect(log.records).toEqual([r]);
    expect(log.reviews).toEqual([
      { recordId: r.id, candidate: 0, verdict: 'right', t: r.t },
      { recordId: r.id, candidate: 1, verdict: 'wrong', t: r.t },
    ]);
    expect(tally.matched).toBe(1);
    expect(tally.beside).toBe(1);
  });

  it('counts a fire on the lit control as right and one on another as not', () => {
    const right = logged({ decision: { action: 'retarget', candidate: 0 } });
    const wrong = logged({ t: right.t + 2000, decision: { action: 'retarget', candidate: 1 } });
    const { tally } = join(exported([right, wrong]), practice([press(right.t), press(wrong.t)]));
    expect(tally.fires).toBe(2);
    expect(tally.right).toBe(1);
  });

  it('checks the retry label against the lit control', () => {
    const onLit = logged({}, hit(0, 3));
    const onOther = logged({ t: onLit.t + 2000 }, hit(1, 12));
    const notRetried = logged({ t: onLit.t + 4000 }, null);
    const { tally } = join(
      exported([onLit, onOther, notRetried]),
      practice([press(onLit.t), press(onOther.t, { target: nearBox }), press(notRetried.t)]),
    );
    expect(tally.labeled).toBe(2);
    expect(tally.labeledRight).toBe(1);
  });

  it('leaves out a record that matches no press, by time or by point', () => {
    const late = logged();
    const moved = logged({ t: late.t + 5000 });
    const { log, tally } = join(
      exported([late, moved]),
      practice([press(late.t - 150), press(moved.t, { x: point.x + 2 })]),
    );
    expect(log.records).toEqual([]);
    expect(log.reviews).toEqual([]);
    expect(tally.records).toBe(2);
    expect(tally.matched).toBe(0);
  });

  it('matches each press to one record only', () => {
    const first = logged();
    const second = logged({ t: first.t + 20 });
    const { tally } = join(exported([first, second]), practice([press(first.t)]));
    expect(tally.matched).toBe(1);
  });

  it('marks every candidate wrong when the lit control was not among them', () => {
    const r = logged();
    const elsewhere = { x: 900, y: 100, w: 30, h: 30 };
    const { log, tally } = join(exported([r]), practice([press(r.t, { target: elsewhere })]));
    expect(log.reviews.map((review) => review.verdict)).toEqual(['wrong', 'wrong']);
    expect(tally.beside).toBe(0);
  });

  it('counts where the presses landed', () => {
    const { tally } = join(
      exported([]),
      practice([press(1, { on: 'target' }), press(2, { on: 'control', target: farBox }), press(3)]),
    );
    expect([tally.presses, tally.onTarget, tally.onOther, tally.onEmpty]).toEqual([3, 1, 1, 1]);
  });
});
