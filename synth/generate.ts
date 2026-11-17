// Generates a synthetic log in the extension's export format, with ground truth.
//
// The generator simulates one person clicking through a set of made-up sites.
// Most clicks aim at a control and land on it. Some miss onto empty space and
// are retried. Some are deliberate clicks on empty space. Because the generator
// knows what each click was for, it writes a review mark for every candidate of
// every record, which stands in for the hand review.
//
// Every number in ASSUMPTIONS is a guess about behavior. The synthetic corpus
// proves the pipeline and gives the agent loop something to climb. It says
// nothing about how real people miss. Only a real log does.
import { dayOf } from '../src/core/days';
import { distanceToRect, type Point, type Rect } from '../src/core/geometry';
import type {
  Candidate,
  ClickFeatures,
  ClickRecord,
  ClickSignal,
  DayCount,
  FollowUp,
  LogExport,
  PathSample,
  Reaction,
  Review,
} from '../src/core/types';
import { Random } from './random';

export interface SynthOptions {
  seed: number;
  /** Days of simulated use. */
  days: number;
  sites: number;
  clicksPerDay: number;
  /** Epoch ms of the first day. */
  start: number;
}

export const DEFAULT_OPTIONS: SynthOptions = {
  seed: 1,
  // 24 weeks. The wrong-target gate needs about a thousand held-out fires to
  // tell a rate near 0.25% from 1%, and a shorter log does not hold that many.
  days: 168,
  sites: 40,
  clicksPerDay: 800,
  start: Date.UTC(2026, 7, 3, 16),
};

export const ASSUMPTIONS = {
  /**
   * Aimed endpoints spread with a standard deviation of the target's extent over this.
   * Fitts's law tasks, done for speed, give 4.133 and about 4% misses. Everyday clicking is more careful.
   */
  spreadDivisor: 4.4,
  /** The spread across the direction of travel, relative to the spread along it. */
  crossSpread: 0.75,
  /** Share of aimed clicks that are slips, with the spread multiplied by slipFactor. */
  slipShare: 0.003,
  slipFactor: 3,
  /**
   * Past this many px a bigger target is no easier to miss by more. A hand's
   * aim does not get sloppier without limit, so large targets are missed less.
   */
  spreadCapPx: 60,
  /** Shares of all clicks by what the user meant. The rest are aimed at a control. */
  deliberateShare: 0.05,
  dragShare: 0.01,
  longPressShare: 0.004,
  /** Share of aimed clicks made into a window that did not have focus. */
  unfocusedShare: 0.01,
  /** Share of aimed clicks that are the first half of a double-click. */
  doubleClickShare: 0.02,
  /** After a miss the user retries this often, this many ms later (median), and more carefully. */
  retryShare: 0.88,
  retryMedianMs: 550,
  retryCare: 0.55,
  /**
   * People keep deliberate clicks away from controls. This share still lands
   * within nearPx of one. The wrong-target rate on a synthetic corpus follows
   * almost directly from this number, and nobody has measured it.
   */
  deliberateNearShare: 0.005,
  nearPx: 14,
  /** After a deliberate click, the share followed by a click on some control in view within 1.5 s. */
  deliberateThenClickShare: 0.35,
  /** How a deliberate click arrives: at rest, from afar, or leaving a control just used. */
  deliberateResting: 0.4,
  deliberateLeaving: 0.15,
  /** Median ms the pointer rests on arrival before the press. */
  dwellMedianMs: 110,
  /** Share of aimed movements that end with a small corrective movement. */
  correctionShare: 0.3,
} as const;

const DAY_MS = 86_400_000;
const CANDIDATE_RADIUS = 30;
const MAX_CANDIDATES = 8;
const PATH_WINDOW_MS = 300;

const SAFE_LABELS = [
  'Save',
  'Cancel',
  'Edit',
  'Open',
  'Close',
  'Next',
  'Back',
  'Reply',
  'Share',
  'Copy link',
  'Settings',
  'Search',
  'Refresh',
  'Menu',
  'Help',
  'Filter',
  'Sort',
  'Download',
  'Expand',
  'More',
  'Details',
  'Preview',
  'Rename',
  'Archive',
];
const IRREVERSIBLE_LABELS = [
  'Delete',
  'Send',
  'Pay now',
  'Submit',
  'Sign out',
  'Remove',
  'Buy now',
  'Post',
  'Confirm',
  'Unsubscribe',
];
const LINK_LABELS = [
  'Home',
  'Pricing',
  'Docs',
  'Blog',
  'About',
  'Careers',
  'Contact',
  'Read more',
  'View all',
  'Terms',
];

type Layout = 'lone' | 'toolbar' | 'buttons' | 'links' | 'cards' | 'form' | 'media';
const LAYOUTS: Layout[] = ['lone', 'toolbar', 'buttons', 'links', 'cards', 'form', 'media'];

interface Site {
  name: string;
  /** How often the user is on this site, relative to the others. */
  weight: number;
  /** How likely each layout is on this site, in the order of LAYOUTS. */
  layouts: number[];
  /** Pointer events per second. */
  hz: number;
  /** The page changes its DOM on its own all the time. */
  churn: boolean;
  /** How often the page reacts to a missed click anyway, such as a field losing focus. */
  reactShare: number;
  irreversibleShare: number;
}

interface Control {
  rect: Rect;
  kind: 'control' | 'opaque';
  tag: string;
  role: string | null;
  type: string | null;
  signals: ClickSignal[];
  label: string;
  disabled: boolean;
}

/** What the generator knows about a click and the log does not. */
type Intent = 'aim' | 'deliberate' | 'drag' | 'long-press';

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function contains(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
}

function center(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function makeSites(rng: Random, count: number): Site[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `site-${String(i + 1).padStart(2, '0')}.example`,
    weight: 1 / (i + 1) ** 0.9,
    layouts: LAYOUTS.map(() => rng.uniform(0.2, 1)),
    hz: rng.chance(0.4) ? 120 : 60,
    churn: rng.chance(0.08),
    reactShare: rng.uniform(0.05, 0.3),
    irreversibleShare: rng.uniform(0.05, 0.25),
  }));
}

function buttonLike(rng: Random, site: Site, rect: Rect, label?: string): Control {
  const text =
    label ??
    (rng.chance(site.irreversibleShare) ? rng.pick(IRREVERSIBLE_LABELS) : rng.pick(SAFE_LABELS));
  const style = rng.next();
  const base = {
    rect,
    kind: 'control' as const,
    type: null,
    label: text,
    disabled: rng.chance(0.03),
  };
  if (style < 0.6) return { ...base, tag: 'button', role: null, signals: ['native'] };
  if (style < 0.8) return { ...base, tag: 'div', role: 'button', signals: ['role', 'cursor'] };
  return { ...base, tag: 'div', role: null, signals: ['cursor'] };
}

/** The controls in view around where the user is working. Coordinates are page px. */
function buildScene(rng: Random, site: Site): Control[] {
  const layout = LAYOUTS[rng.weighted(site.layouts)]!;
  const controls: Control[] = [];
  if (layout === 'lone') {
    // One control with nothing else near it: a sign-in button, a close icon, a link in a paragraph.
    const shape = rng.next();
    const rect =
      shape < 0.4
        ? { x: 0, y: 0, w: Math.round(rng.uniform(64, 160)), h: rng.pick([28, 32, 36, 40]) }
        : shape < 0.7
          ? { x: 0, y: 0, w: rng.pick([16, 20, 24, 28, 32]), h: 0 }
          : { x: 0, y: 0, w: Math.round(rng.uniform(40, 200)), h: 18 };
    if (rect.h === 0) rect.h = rect.w;
    if (shape >= 0.7) {
      controls.push({
        rect,
        kind: 'control',
        tag: 'a',
        role: null,
        type: null,
        signals: ['native', 'cursor'],
        label: rng.pick(LINK_LABELS),
        disabled: false,
      });
    } else {
      controls.push(buttonLike(rng, site, rect));
    }
  } else if (layout === 'toolbar') {
    const size = rng.pick([20, 24, 28, 32]);
    // Many toolbars have no gap at all: each button's box touches the next.
    const gap = rng.pick([0, 0, 0, 4, 8, 12, 16, 24]);
    for (let i = 0, n = rng.int(3, 7); i < n; i++) {
      controls.push(buttonLike(rng, site, { x: i * (size + gap), y: 0, w: size, h: size }));
    }
  } else if (layout === 'buttons') {
    const h = rng.pick([28, 32, 36, 40]);
    let x = 0;
    for (let i = 0, n = rng.int(1, 3); i < n; i++) {
      const w = Math.round(rng.uniform(64, 150));
      controls.push(buttonLike(rng, site, { x, y: 0, w, h }));
      x += w + Math.round(rng.uniform(8, 48));
    }
  } else if (layout === 'links') {
    // List rows often touch. Links set in running text have a line's gap between them.
    const gap = rng.pick([0, 0, 6, 10, 14]);
    for (let i = 0, n = rng.int(3, 8); i < n; i++) {
      controls.push({
        rect: { x: 0, y: i * (18 + gap), w: Math.round(rng.uniform(40, 220)), h: 18 },
        kind: 'control',
        tag: 'a',
        role: null,
        type: null,
        signals: ['native', 'cursor'],
        label: rng.pick(LINK_LABELS),
        disabled: false,
      });
    }
  } else if (layout === 'cards') {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const rect = { x: col * 196, y: row * 126, w: 180, h: 110 };
        controls.push({
          rect,
          kind: 'control',
          tag: 'div',
          role: null,
          type: null,
          signals: ['cursor'],
          label: `Project ${'ABCD'[row * 2 + col]}`,
          disabled: false,
        });
        // A small menu button in the card's corner.
        controls.push(
          buttonLike(rng, site, { x: rect.x + 150, y: rect.y + 6, w: 24, h: 24 }, 'More'),
        );
      }
    }
  } else if (layout === 'form') {
    controls.push({
      rect: { x: 0, y: 0, w: 220, h: 32 },
      kind: 'control',
      tag: 'input',
      role: null,
      type: 'text',
      signals: ['native'],
      label: 'Email address',
      disabled: false,
    });
    const gap = Math.round(rng.uniform(8, 16));
    controls.push(buttonLike(rng, site, { x: 220 + gap, y: 0, w: 90, h: 32 }));
  } else {
    controls.push({
      rect: { x: 0, y: 0, w: 320, h: 180 },
      kind: 'opaque',
      tag: rng.pick(['canvas', 'video', 'iframe']),
      role: null,
      type: null,
      signals: [],
      label: '',
      disabled: false,
    });
    const gap = rng.pick([6, 8, 10]);
    for (let i = 0; i < 3; i++) {
      controls.push(buttonLike(rng, site, { x: i * (28 + 8), y: 180 + gap, w: 28, h: 28 }));
    }
  }
  return controls;
}

/** The control a click at p would reach. A control inside another wins. */
function hitAt(scene: Control[], p: Point): Control | null {
  let hit: Control | null = null;
  for (const control of scene) {
    if (!contains(control.rect, p)) continue;
    if (!hit || control.rect.w * control.rect.h < hit.rect.w * hit.rect.h) hit = control;
  }
  return hit;
}

interface Near {
  candidates: Candidate[];
  /** The scene control behind each candidate. */
  controls: Control[];
}

function candidatesAt(scene: Control[], p: Point): Near {
  const near = scene
    .map((control) => ({ control, dist: distanceToRect(p, control.rect) }))
    .filter(({ dist }) => dist <= CANDIDATE_RADIUS)
    .sort(
      (a, b) =>
        a.dist - b.dist ||
        a.control.rect.y - b.control.rect.y ||
        a.control.rect.x - b.control.rect.x,
    )
    .slice(0, MAX_CANDIDATES);
  return {
    controls: near.map(({ control }) => control),
    candidates: near.map(({ control, dist }, id) => ({
      id,
      kind: control.kind,
      dist: round(dist),
      rect: {
        x: round(control.rect.x - p.x),
        y: round(control.rect.y - p.y),
        w: control.rect.w,
        h: control.rect.h,
      },
      tag: control.tag,
      role: control.role,
      type: control.type,
      signals: control.signals,
      label: control.label,
      redacted: false,
      disabled: control.disabled,
    })),
  };
}

/** Distance covered at time fraction x of a minimum-jerk movement. */
function minimumJerk(x: number): number {
  return 10 * x ** 3 - 15 * x ** 4 + 6 * x ** 5;
}

/**
 * Pointer samples for a movement that travels `distance` px along `angle` and
 * arrives at the origin `dwell` ms before the press. Only the last 300 ms are kept.
 */
function arrival(
  rng: Random,
  hz: number,
  angle: number,
  distance: number,
  durationMs: number,
  dwell: number,
  end: Point = { x: 0, y: 0 },
): PathSample[] {
  const samples: PathSample[] = [];
  const step = 1000 / hz;
  for (let elapsed = durationMs; elapsed >= 0; elapsed -= step) {
    const t = -dwell - (durationMs - elapsed);
    if (t < -PATH_WINDOW_MS) break;
    const left = distance * (1 - minimumJerk(elapsed / durationMs));
    samples.push({
      t: Math.round(t),
      x: round(end.x - Math.cos(angle) * left + (left > 0 ? rng.normal(0, 0.3) : 0)),
      y: round(end.y - Math.sin(angle) * left + (left > 0 ? rng.normal(0, 0.3) : 0)),
    });
  }
  return samples.reverse();
}

/** How long an aimed movement takes, by Fitts's law. */
function movementMs(distance: number, width: number): number {
  return 180 + 140 * Math.log2(distance / Math.max(width, 4) + 1);
}

function dwellMs(rng: Random): number {
  return Math.min(900, Math.max(20, rng.logNormal(ASSUMPTIONS.dwellMedianMs, 0.55)));
}

/** The cursor path of an aimed movement that ended at the click point. */
function aimedPath(rng: Random, site: Site, angle: number, distance: number, width: number) {
  const dwell = dwellMs(rng);
  if (!rng.chance(ASSUMPTIONS.correctionShare)) {
    return arrival(rng, site.hz, angle, distance, movementMs(distance, width), dwell);
  }
  // The main movement stops a few px off, and a short second movement closes the gap.
  const offAngle = rng.uniform(0, 2 * Math.PI);
  const off = rng.uniform(3, 12);
  const fixMs = rng.uniform(60, 120);
  const pause = rng.uniform(40, 110);
  const stop = { x: -Math.cos(offAngle) * off, y: -Math.sin(offAngle) * off };
  const main = arrival(
    rng,
    site.hz,
    angle,
    distance,
    movementMs(distance, width),
    dwell + fixMs + pause,
    stop,
  );
  return [...main, ...arrival(rng, site.hz, offAngle, off, fixMs, dwell)];
}

const NO_REACTION: Reaction = {
  mutation: false,
  focus: false,
  selection: false,
  scroll: false,
  navigation: false,
};

interface Simulated {
  /** How the click counts toward the day's totals. */
  count: 'hits' | 'emptyReacted' | 'emptyIgnored';
  record?: ClickRecord;
  /** The candidate the user aimed at, when it is among the record's candidates. */
  target?: number | null;
}

interface Draft {
  p: Point;
  near: Near;
  path: PathSample[];
  press: { ms: number; move: number };
  focused: boolean;
  reaction: Reaction;
  followUp: FollowUp | null;
}

function pressOf(rng: Random): { ms: number; move: number } {
  return {
    ms: Math.round(Math.min(400, Math.max(30, rng.logNormal(85, 0.3)))),
    move: round(Math.min(3, rng.logNormal(0.3, 0.8))),
  };
}

/** What a page does when a click lands on its empty space. */
function reactionTo(rng: Random, site: Site, share: number): Reaction {
  if (site.churn) return { ...NO_REACTION, mutation: true };
  if (!rng.chance(share)) return NO_REACTION;
  return rng.chance(0.6) ? { ...NO_REACTION, mutation: true } : { ...NO_REACTION, focus: true };
}

/** A follow-up press that landed at q, relative to the first click at p. */
function followUpAt(scene: Control[], near: Near, p: Point, q: Point, dt: number): FollowUp {
  const hit = hitAt(scene, q);
  const index = hit ? near.controls.indexOf(hit) : -1;
  return {
    dt: Math.round(dt),
    dx: round(q.x - p.x),
    dy: round(q.y - p.y),
    kind: hit ? hit.kind : 'empty',
    candidate: index >= 0 && hit?.kind === 'control' ? index : null,
    dist: hit?.kind === 'control' ? round(distanceToRect(p, hit.rect)) : null,
  };
}

/** The length of the line through a rect's center at an angle, which is how wide the rect looks from there. */
function chord(rect: Rect, angle: number): number {
  const across = Math.abs(Math.cos(angle));
  const up = Math.abs(Math.sin(angle));
  return Math.min(across > 1e-9 ? rect.w / across : Infinity, up > 1e-9 ? rect.h / up : Infinity);
}

/** An endpoint aimed at a control, arriving along `angle`. */
function aimAt(rng: Random, target: Control, angle: number, care: number): Point {
  const slip = rng.chance(ASSUMPTIONS.slipShare) ? ASSUMPTIONS.slipFactor : 1;
  const sd = (extent: number) =>
    (Math.min(extent, ASSUMPTIONS.spreadCapPx) / ASSUMPTIONS.spreadDivisor) * care * slip;
  const a = rng.normal(0, sd(chord(target.rect, angle)));
  const c = rng.normal(0, sd(chord(target.rect, angle + Math.PI / 2)) * ASSUMPTIONS.crossSpread);
  const mid = center(target.rect);
  return {
    x: mid.x + a * Math.cos(angle) - c * Math.sin(angle),
    y: mid.y + a * Math.sin(angle) + c * Math.cos(angle),
  };
}

/** A point on empty space at about the given clearance from the scene's controls. */
function emptyPoint(rng: Random, scene: Control[], clearance: number): Point {
  let p = { x: -clearance, y: -clearance };
  for (let attempt = 0; attempt < 12; attempt++) {
    const { rect } = rng.pick(scene);
    const side = rng.int(0, 3);
    const along = rng.next();
    p =
      side === 0
        ? { x: rect.x + along * rect.w, y: rect.y - clearance }
        : side === 1
          ? { x: rect.x + rect.w + clearance, y: rect.y + along * rect.h }
          : side === 2
            ? { x: rect.x + along * rect.w, y: rect.y + rect.h + clearance }
            : { x: rect.x - clearance, y: rect.y + along * rect.h };
    const nearest = Math.min(...scene.map((c) => distanceToRect(p, c.rect)));
    if (nearest >= clearance * 0.6) break;
  }
  return p;
}

export function generate(options: SynthOptions = DEFAULT_OPTIONS): LogExport {
  const rng = new Random(options.seed);
  const sites = makeSites(rng, options.sites);
  const weights = sites.map((s) => s.weight);
  const records: ClickRecord[] = [];
  const reviews: Review[] = [];
  const counts = new Map<string, DayCount>();
  let nextId = 0;

  function finish(
    site: Site,
    t: number,
    draft: Draft,
    intent: Intent,
    target: Control | null,
  ): Simulated {
    const didReact = Object.values(draft.reaction).some(Boolean);
    const count = didReact ? 'emptyReacted' : 'emptyIgnored';
    if (draft.near.candidates.length === 0) return { count };
    const features: ClickFeatures = {
      candidates: draft.near.candidates,
      path: draft.path,
      press: draft.press,
      focused: draft.focused,
      reacted: didReact,
      reaction: draft.reaction,
      blurred: rng.chance(0.45),
      leftField: false,
      mutations: { total: draft.reaction.mutation ? 1 : 0, near: 0 },
      churn: site.churn,
      under: {
        tag: rng.pick(['div', 'div', 'section', 'li', 'td', 'body']),
        role: null,
        label: '',
      },
      point: { x: Math.round(rng.uniform(40, 1240)), y: Math.round(rng.uniform(40, 760)) },
      viewport: { w: 1280, h: 800 },
      scale: 2,
      topFrame: !rng.chance(0.05),
      listenersOnPath: rng.int(0, 3),
    };
    const record: ClickRecord = {
      v: 1,
      id: `synth-${options.seed}-${nextId++}`,
      t,
      site: site.name,
      features,
      decision: { action: 'refuse', reason: 'no-candidate' },
      decisionVersion: 'synthetic',
      followUp: draft.followUp,
    };
    const aimed = intent === 'aim' && target ? draft.near.controls.indexOf(target) : -1;
    return { count, record, target: aimed >= 0 ? aimed : null };
  }

  function aimedClick(site: Site, t: number): Simulated {
    const scene = buildScene(rng, site);
    const targets = scene.filter((c) => c.kind === 'control' && !c.disabled);
    const target = rng.pick(targets.length > 0 ? targets : scene);
    const angle = rng.uniform(0, 2 * Math.PI);
    const distance = Math.min(900, Math.max(30, rng.logNormal(240, 0.6)));
    const p = aimAt(rng, target, angle, 1);
    if (hitAt(scene, p)) return { count: 'hits' };

    const near = candidatesAt(scene, p);
    const width = Math.min(target.rect.w, target.rect.h);
    let followUp: FollowUp | null = null;
    if (rng.chance(ASSUMPTIONS.doubleClickShare)) {
      const q = { x: p.x + rng.normal(0, 0.6), y: p.y + rng.normal(0, 0.6) };
      followUp = followUpAt(scene, near, p, q, rng.uniform(110, 320));
    } else if (rng.chance(ASSUMPTIONS.retryShare)) {
      const dt = Math.max(160, rng.logNormal(ASSUMPTIONS.retryMedianMs, 0.45));
      if (dt <= 1500) {
        const q = aimAt(rng, target, rng.uniform(0, 2 * Math.PI), ASSUMPTIONS.retryCare);
        followUp = followUpAt(scene, near, p, q, dt);
      }
    }
    const draft: Draft = {
      p,
      near,
      path: aimedPath(rng, site, angle, distance, width),
      press: pressOf(rng),
      focused: !rng.chance(ASSUMPTIONS.unfocusedShare),
      reaction: reactionTo(rng, site, site.reactShare),
      followUp,
    };
    return finish(site, t, draft, 'aim', target);
  }

  function deliberateClick(site: Site, t: number, intent: Intent): Simulated {
    const scene = buildScene(rng, site);
    const near14 = rng.chance(ASSUMPTIONS.deliberateNearShare);
    const clearance = near14
      ? rng.uniform(1, ASSUMPTIONS.nearPx)
      : rng.uniform(ASSUMPTIONS.nearPx, 220);
    const p = emptyPoint(rng, scene, clearance);
    if (hitAt(scene, p)) return { count: 'hits' };
    const near = candidatesAt(scene, p);

    let path: PathSample[] = [];
    const how = rng.next();
    if (how >= ASSUMPTIONS.deliberateResting + ASSUMPTIONS.deliberateLeaving) {
      const distance = Math.min(900, Math.max(30, rng.logNormal(240, 0.6)));
      path = arrival(
        rng,
        site.hz,
        rng.uniform(0, 2 * Math.PI),
        distance,
        movementMs(distance, 20),
        dwellMs(rng),
      );
    } else if (how >= ASSUMPTIONS.deliberateResting && near.controls.length > 0) {
      // The pointer was on a control and moves off it to click beside it.
      const from = center(near.controls[0]!.rect);
      const distance = Math.hypot(from.x - p.x, from.y - p.y);
      const angle = Math.atan2(p.y - from.y, p.x - from.x);
      path = arrival(rng, site.hz, angle, distance, rng.uniform(150, 300), dwellMs(rng));
    }

    let followUp: FollowUp | null = null;
    if (rng.chance(ASSUMPTIONS.deliberateThenClickShare)) {
      const dt = Math.max(200, rng.logNormal(700, 0.4));
      const next = rng.pick(scene);
      if (dt <= 1500) followUp = followUpAt(scene, near, p, center(next.rect), dt);
    }

    let press = pressOf(rng);
    let reaction = reactionTo(rng, site, 0.6);
    if (intent === 'drag') {
      press = { ms: Math.round(rng.uniform(250, 1200)), move: round(rng.uniform(12, 300)) };
      if (rng.chance(0.5)) reaction = { ...reaction, selection: true };
    } else if (intent === 'long-press') {
      press = { ms: Math.round(rng.uniform(600, 2000)), move: press.move };
    }
    return finish(
      site,
      t,
      { p, near, path, press, focused: true, reaction, followUp },
      intent,
      null,
    );
  }

  for (let day = 0; day < options.days; day++) {
    for (let i = 0; i < options.clicksPerDay; i++) {
      const site = sites[rng.weighted(weights)]!;
      const t = options.start + day * DAY_MS + Math.floor(rng.uniform(0, 10 * 3_600_000));
      const roll = rng.next();
      const { deliberateShare, dragShare, longPressShare } = ASSUMPTIONS;
      const result =
        roll < deliberateShare
          ? deliberateClick(site, t, 'deliberate')
          : roll < deliberateShare + dragShare
            ? deliberateClick(site, t, 'drag')
            : roll < deliberateShare + dragShare + longPressShare
              ? deliberateClick(site, t, 'long-press')
              : aimedClick(site, t);

      const key = `${dayOf(t)}|${site.name}`;
      const count = counts.get(key) ?? {
        day: dayOf(t),
        site: site.name,
        clicks: 0,
        hits: 0,
        emptyReacted: 0,
        emptyIgnored: 0,
      };
      count.clicks++;
      count[result.count]++;
      counts.set(key, count);

      if (!result.record) continue;
      records.push(result.record);
      // The stand-in for hand review: the control the user aimed at is right, any other is wrong.
      for (const candidate of result.record.features.candidates) {
        if (candidate.kind !== 'control') continue;
        reviews.push({
          recordId: result.record.id,
          candidate: candidate.id,
          verdict: candidate.id === result.target ? 'right' : 'wrong',
          t: result.record.t,
        });
      }
    }
  }

  records.sort((a, b) => a.t - b.t);
  return {
    format: 'heyo-log',
    v: 1,
    exportedAt: options.start + options.days * DAY_MS,
    extensionVersion: 'synthetic',
    decisionVersion: 'synthetic',
    records,
    reviews,
    counts: [...counts.values()],
  };
}
