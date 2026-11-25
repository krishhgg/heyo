// Puts a practice run's two logs together. The extension logged each click
// that landed on empty space near a control. The practice page logged every
// press and which control was lit at the time. A record and a press are the
// same click when they share a time and a point, and the lit control is then
// the one the click was for.
import { marksAt } from '../scripted/truth';
import type { Rect } from '../src/core/geometry';
import { isLabeledMiss, proxyTarget } from '../src/core/labels';
import type { ClickRecord, LogExport, Review } from '../src/core/types';

/** One press on the practice page, as the page logged it. */
export interface PracticePress {
  /** Epoch ms. The page and the extension read the same clock in the same press. */
  t: number;
  x: number;
  y: number;
  /** What the press landed on: the lit control, another control, or neither. */
  on: 'target' | 'control' | 'empty';
  /** The lit control's box at the time of the press, in viewport px. */
  target: Rect;
  scene: string;
}

/** What the practice page hands over. */
export interface PracticeLog {
  format: 'heyo-practice';
  v: 1;
  /** Hits the run asked for. */
  trials: number;
  /** Hits on the lit control so far. */
  hits: number;
  /** The run reached its end, or the person stopped it from the page. */
  done: boolean;
  presses: PracticePress[];
}

/** A record and a press this many ms apart can still be the same click. */
const SAME_TIME_MS = 100;

/** The record keeps the point to a tenth of a px. */
const SAME_POINT_PX = 0.5;

export interface Tally {
  trials: number;
  hits: number;
  presses: number;
  onTarget: number;
  onOther: number;
  onEmpty: number;
  /** Records the extension logged, and how many of them matched a press. */
  records: number;
  matched: number;
  /** Matched records with the lit control among the logged candidates. */
  beside: number;
  /** Records the decision in the build acted on, and how many picked the lit control. */
  fires: number;
  right: number;
  /** Labeled misses, and how many of them name the lit control as the target. */
  labeled: number;
  labeledRight: number;
}

function sameClick(record: ClickRecord, press: PracticePress): boolean {
  const { point } = record.features;
  return (
    Math.abs(record.t - press.t) <= SAME_TIME_MS &&
    Math.abs(point.x - press.x) <= SAME_POINT_PX &&
    Math.abs(point.y - press.y) <= SAME_POINT_PX
  );
}

/**
 * Keeps the records that match a press and marks each of their candidates:
 * right for the lit control, wrong for any other. A record that matches no
 * press came from somewhere the page does not log, such as its start screen,
 * and is left out, since nobody knows what it was aimed at.
 */
export function join(exported: LogExport, practice: PracticeLog): { log: LogExport; tally: Tally } {
  const tally: Tally = {
    trials: practice.trials,
    hits: practice.hits,
    presses: practice.presses.length,
    onTarget: practice.presses.filter((press) => press.on === 'target').length,
    onOther: practice.presses.filter((press) => press.on === 'control').length,
    onEmpty: practice.presses.filter((press) => press.on === 'empty').length,
    records: exported.records.length,
    matched: 0,
    beside: 0,
    fires: 0,
    right: 0,
    labeled: 0,
    labeledRight: 0,
  };
  const used = new Set<PracticePress>();
  const records: ClickRecord[] = [];
  const reviews: Review[] = [];
  for (const record of exported.records) {
    const press = practice.presses.find((p) => !used.has(p) && sameClick(record, p));
    if (!press) continue;
    used.add(press);
    records.push(record);
    tally.matched++;
    const marks = marksAt(record, press.target);
    reviews.push(...marks);
    const lit = marks.find((mark) => mark.verdict === 'right')?.candidate ?? null;
    if (lit !== null) tally.beside++;
    if (record.decision.action === 'retarget') {
      tally.fires++;
      if (record.decision.candidate === lit) tally.right++;
    }
    if (isLabeledMiss(record)) {
      tally.labeled++;
      if (lit !== null && proxyTarget(record) === lit) tally.labeledRight++;
    }
  }
  return { log: { ...exported, records, reviews }, tally };
}
