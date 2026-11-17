// What the review page shows, derived from the stored log and the bundled decision.
import type {
  Candidate,
  ClickRecord,
  Decide,
  LogExport,
  Review,
  Verdict,
} from '../../../core/types';
import type { GateStatus } from '../../../core/gates';
import type { Point, Rect } from '../../../core/geometry';
import type { Log } from '../../db';

/** A click the decision would retarget, with the control it picked. */
export interface Fire {
  record: ClickRecord;
  picked: Candidate;
}

/** A stable 32-bit hash of a record id (FNV-1a). */
function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Every would-be fire, in review order. The order is the hash of the record id,
 * so it is random with respect to time and site, and it stays the same between
 * visits. Reviewing from the front is reviewing a random sample of all fires.
 */
export function firesOf(records: ClickRecord[], decide: Decide): Fire[] {
  const fires: Fire[] = [];
  for (const record of records) {
    const decision = decide(record.features);
    if (decision.action !== 'retarget') continue;
    const picked = record.features.candidates.find((c) => c.id === decision.candidate);
    if (picked) fires.push({ record, picked });
  }
  return fires.sort((a, b) => hash(a.record.id) - hash(b.record.id));
}

export function reviewKey(fire: Fire): string {
  return `${fire.record.id}:${fire.picked.id}`;
}

/** The latest verdict for each reviewed pair of click and control. */
export function verdictsOf(reviews: Review[]): Map<string, Verdict> {
  const latest = new Map<string, Review>();
  for (const review of reviews) {
    const key = `${review.recordId}:${review.candidate}`;
    const seen = latest.get(key);
    if (!seen || review.t >= seen.t) latest.set(key, review);
  }
  return new Map([...latest].map(([key, review]) => [key, review.verdict]));
}

export function toExport(log: Log, extensionVersion: string, decisionVersion: string): LogExport {
  return {
    format: 'heyo-log',
    v: 1,
    exportedAt: Date.now(),
    extensionVersion,
    decisionVersion,
    records: log.records,
    reviews: log.reviews,
    counts: log.counts,
  };
}

/** Input types that are a kind of control with a name of their own. */
const INPUT_KINDS: Record<string, string> = {
  submit: 'button',
  button: 'button',
  reset: 'button',
  image: 'button',
  checkbox: 'checkbox',
  radio: 'radio button',
  range: 'slider',
  file: 'file picker',
};

/** ARIA role names that are not plain words. */
const ROLE_KINDS: Record<string, string> = {
  menuitem: 'menu item',
  menuitemcheckbox: 'menu item',
  menuitemradio: 'menu item',
  treeitem: 'tree item',
  gridcell: 'grid cell',
  combobox: 'dropdown',
  textbox: 'text field',
  searchbox: 'search field',
  spinbutton: 'number field',
  radio: 'radio button',
};

/** A plain-words name for the kind of control a candidate is. */
export function kindOf(candidate: Candidate): string {
  const { tag, role, type, signals } = candidate;
  if (role) return ROLE_KINDS[role] ?? role;
  if (tag === 'a') return 'link';
  if (tag === 'input') {
    if (!type || type === 'text') return 'text field';
    return INPUT_KINDS[type] ?? `${type} field`;
  }
  if (tag === 'textarea') return 'text field';
  if (tag === 'select') return 'dropdown';
  if (tag === 'button' || tag === 'summary' || tag === 'label') return tag;
  if (signals.includes('listener')) return `${tag} with a click handler`;
  if (signals.includes('cursor')) return `${tag} with a pointer cursor`;
  return tag;
}

/** A count with its noun, singular for one: "1 click", "4 clicks". */
export function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}

export function nameOf(candidate: Candidate): string {
  return candidate.label || `unnamed ${kindOf(candidate)}`;
}

/**
 * A number with as many decimals as it takes to tell it from a limit it sits
 * right beside, starting from `digits`. Rounded to one decimal, 2.96 misses a
 * day would read as the 3.0 it falls short of.
 */
export function beside(value: number, limit: number, digits: number): string {
  for (let d = digits; d < digits + 4; d++) {
    if (value.toFixed(d) !== limit.toFixed(d) || value === limit) return value.toFixed(d);
  }
  return value.toFixed(digits + 4);
}

/**
 * A share as a percentage, told apart from its limit in the same way. With 299
 * marks and none wrong the bound is 0.997%, which two decimals would show as
 * the 1.00% it has to stay under.
 */
export function percentBeside(value: number | null, limit: number, digits = 2): string {
  return value === null ? 'none yet' : `${beside(100 * value, 100 * limit, digits)}%`;
}

/** Where the drawing's distance label goes, relative to the click point. */
export interface LabelSpot {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

/**
 * A spot for the distance label in the drawing. `toward` is the unit vector
 * from the click to the picked control. The label goes on the far side of the
 * click, so it never covers the gap. If a neighbour sits there it goes to one
 * side instead, so it never covers a neighbour's name. With neighbours on every
 * side there is no clear spot, and the distance is in the text beside the drawing.
 */
export function gapLabelSpot(
  toward: Point,
  width: number,
  height: number,
  others: Candidate[],
): LabelSpot | null {
  const spots = [
    { x: -toward.x * 6, y: -toward.y * 7 },
    { x: -toward.y * 9, y: toward.x * 9 },
    { x: toward.y * 9, y: -toward.x * 9 },
  ];
  for (const at of spots) {
    const anchor = at.x < -2 ? 'end' : at.x > 2 ? 'start' : 'middle';
    const left = anchor === 'end' ? at.x - width : anchor === 'start' ? at.x : at.x - width / 2;
    const top = at.y - height / 2;
    const covers = (r: Rect) =>
      left < r.x + r.w + 1 &&
      r.x < left + width + 1 &&
      top < r.y + r.h + 1 &&
      r.y < top + height + 1;
    // Adding 0 turns a negative zero into a plain one.
    if (!others.some((c) => covers(c.rect))) return { x: at.x + 0, y: at.y + 0, anchor };
  }
  return null;
}

/**
 * True when a failing wrong-target gate can still be turned around. The plan
 * asks for a sample of fires with none wrong. Before that many are marked, a
 * bound over the limit rests on a handful of marks. After it, the fail stands.
 */
export function failsSoFar(status: GateStatus, reviewed: number, sample: number): boolean {
  return status === 'fail' && reviewed < sample;
}
