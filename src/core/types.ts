// The log schema. The extension writes these records, the review view and the
// scorer read them, and the decision module sees only ClickFeatures.
import type { Point, Rect } from './geometry';

/** Why heyo thinks an element is clickable. */
export type ClickSignal = 'native' | 'role' | 'tabindex' | 'cursor' | 'listener';

/**
 * Something near an empty-space click.
 * A control is an element a click can activate.
 * An opaque region is a canvas, video or iframe, where heyo cannot see what the user aimed at.
 */
export interface Candidate {
  /** Index within the record. */
  id: number;
  kind: 'control' | 'opaque';
  /** Px from the click point to the candidate's nearest edge. */
  dist: number;
  /** The candidate's box relative to the click point. */
  rect: Rect;
  tag: string;
  /** The explicit ARIA role, if any. */
  role: string | null;
  /** The type attribute of an input or button. */
  type: string | null;
  signals: ClickSignal[];
  /** Accessible name or visible text, at most 40 characters. Never a field's value. */
  label: string;
  /** Part of the label matched text typed into a field on the page and was blanked. */
  redacted: boolean;
  disabled: boolean;
}

/** One cursor position before the press. */
export interface PathSample {
  /** Ms relative to the press. Zero or negative. */
  t: number;
  /** Position relative to the click point. */
  x: number;
  y: number;
}

/** What the page did between the press and about 50 ms after the click. */
export interface Reaction {
  /** The DOM changed. */
  mutation: boolean;
  /** Focus moved into an element, or out of a field the user can type in. */
  focus: boolean;
  /** The visible text selection changed. */
  selection: boolean;
  scroll: boolean;
  navigation: boolean;
}

/** The short description of what was under the pointer. */
export interface Under {
  tag: string;
  role: string | null;
  label: string;
}

/** Everything the decision module may look at. It holds no site, time or record id. */
export interface ClickFeatures {
  /** Controls and opaque regions within 30 px of the click, nearest first. */
  candidates: Candidate[];
  /** Cursor positions over the 300 ms before the press, oldest first. */
  path: PathSample[];
  press: {
    /** Ms between press and release. */
    ms: number;
    /** Largest distance in px the pointer moved from the press point before release. */
    move: number;
  };
  /** The document had focus at the press. */
  focused: boolean;
  /** True when any field of reaction is true. */
  reacted: boolean;
  reaction: Reaction;
  /**
   * The click moved focus the way Chrome does on its own: off a control that is
   * not a text field, such as the button the user clicked before, or onto a
   * focusable container around the click. This does not count as a reaction.
   */
  blurred: boolean;
  /**
   * Focus left a field the user types in. This counts as a focus reaction. It
   * is logged on its own because typing and then missing the next button is a
   * likely miss, and a later analysis may want to count it.
   */
  leftField: boolean;
  /**
   * How many DOM changes the page made between the press and the settle time,
   * and how many of those touched the element under the pointer, one of its
   * ancestors, or a candidate. A change far from the click is weaker evidence
   * that the page answered it.
   */
  mutations: { total: number; near: number };
  /**
   * The DOM was already changing in the 300 ms before the press, so a mutation
   * after it may be the page's own background activity. Null when heyo was not
   * watching for that whole time.
   */
  churn: boolean | null;
  under: Under;
  /** The click point in viewport coordinates. */
  point: Point;
  viewport: { w: number; h: number };
  /** The click happened in the top frame, not an iframe. */
  topFrame: boolean;
  /** How many nodes on the click's event path, window and document included, have a click-type listener. */
  listenersOnPath: number;
}

export type RefuseReason =
  | 'reacted'
  | 'unfocused'
  | 'drag'
  | 'long-press'
  | 'no-candidate'
  | 'too-far'
  | 'ambiguous'
  | 'disabled'
  | 'unlabeled'
  | 'irreversible'
  | 'path';

export type Decision =
  { action: 'retarget'; candidate: number } | { action: 'refuse'; reason: RefuseReason };

/** The decision module's whole interface. It must be a pure function. */
export type Decide = (features: ClickFeatures) => Decision;

/** Where the user's next press landed. */
export type HitKind = 'control' | 'opaque' | 'text' | 'empty';

/** The user's next press in the same frame, if it came within the follow-up window. */
export interface FollowUp {
  /** Ms from the first press to this press. */
  dt: number;
  /** This press's position relative to the first click point. */
  dx: number;
  dy: number;
  kind: HitKind;
  /** The logged candidate this press hit, or null if it hit none of them. */
  candidate: number | null;
  /** Px from the first click point to the nearest edge of the control this press hit. Null unless kind is control. */
  dist: number | null;
}

/**
 * One empty-space click. It had at least one candidate nearby, or it had none
 * and the user then clicked a control within the miss radius that the search
 * had not seen.
 */
export interface ClickRecord {
  v: 1;
  id: string;
  /** Epoch ms of the press. */
  t: number;
  /** The page's hostname. */
  site: string;
  features: ClickFeatures;
  /** What the decision module said when the click happened. */
  decision: Decision;
  /** Version of the decision module that produced decision. */
  decisionVersion: string;
  followUp: FollowUp | null;
}

export type Verdict = 'right' | 'wrong' | 'unsure';

/** A hand-review mark: is this candidate the right target for this click? */
export interface Review {
  recordId: string;
  candidate: number;
  verdict: Verdict;
  /** Epoch ms of the review. */
  t: number;
}

/** Click counts for one site on one local calendar day. They are the miss rate's denominator. */
export interface DayCount {
  /** Local date as YYYY-MM-DD. */
  day: string;
  site: string;
  /** Plain left clicks seen. */
  clicks: number;
  /** Clicks that hit a control, an opaque region or text. */
  hits: number;
  /** Empty-space clicks the page reacted to. */
  emptyReacted: number;
  /** Empty-space clicks the page ignored. */
  emptyIgnored: number;
}

/** The file the review view exports and the scorer reads. */
export interface LogExport {
  format: 'heyo-log';
  v: 1;
  exportedAt: number;
  extensionVersion: string;
  decisionVersion: string;
  records: ClickRecord[];
  reviews: Review[];
  counts: DayCount[];
}
