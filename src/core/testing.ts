// Builders for records in unit tests. Each takes only the fields a test cares about.
import type { Candidate, ClickFeatures, ClickRecord, FollowUp } from './types';

/** A 80 by 30 px button whose left edge is `dist` px to the right of the click point. */
export function candidate(id: number, dist: number, overrides: Partial<Candidate> = {}): Candidate {
  return {
    id,
    kind: 'control',
    dist,
    rect: { x: dist, y: -15, w: 80, h: 30 },
    tag: 'button',
    role: null,
    type: null,
    signals: ['native'],
    label: `Button ${id}`,
    disabled: false,
    ...overrides,
  };
}

export function features(overrides: Partial<ClickFeatures> = {}): ClickFeatures {
  return {
    candidates: [],
    path: [],
    press: { ms: 80, move: 0 },
    focused: true,
    reacted: false,
    reaction: { mutation: false, focus: false, selection: false, scroll: false, navigation: false },
    under: { tag: 'div', role: null, label: '' },
    point: { x: 400, y: 300 },
    viewport: { w: 1280, h: 800 },
    topFrame: true,
    listenersOnPath: 0,
    ...overrides,
  };
}

let nextId = 0;

export function record(
  f: Partial<ClickFeatures> = {},
  followUp: FollowUp | null = null,
  overrides: Partial<ClickRecord> = {},
): ClickRecord {
  return {
    v: 1,
    id: `r${nextId++}`,
    t: Date.UTC(2026, 10, 2, 12),
    site: 'example.test',
    features: features(f),
    decision: { action: 'refuse', reason: 'no-candidate' },
    decisionVersion: 'test',
    followUp,
    ...overrides,
  };
}

/** A follow-up press that hit the given logged candidate. */
export function hit(candidateId: number, dist: number, dt = 600): FollowUp {
  return { dt, dx: dist + 10, dy: 0, kind: 'control', candidate: candidateId, dist };
}
