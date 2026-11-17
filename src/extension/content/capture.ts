// Shadow mode. Watches plain left clicks, and for each one that lands on empty
// space logs what was nearby, what the decision would have done, whether the
// page reacted, and where the next press went. It changes nothing on the page.
import { FOLLOW_UP_WINDOW_MS } from '../../core/labels';
import type { ClickFeatures, ClickRecord, FollowUp, PathSample } from '../../core/types';
import { decide } from '../../decision';
import type { WorkerMessage } from '../messages';
import { decisionVersion } from '../version';
import { distanceToElement, findCandidates, type Found } from './candidates';
import type { HasListener } from './clickable';
import { describeUnder } from './describe';
import { classifyHit, type Hit } from './hit';
import { hasListener } from './listeners';
import { reacted, ReactionWatch } from './reaction';

/** The page gets this long after the click to show a reaction. */
const SETTLE_MS = 50;

/** How much cursor path the log keeps before a press. */
const PATH_WINDOW_MS = 300;

const MAX_PATH_SAMPLES = 64;

interface Move {
  t: number;
  x: number;
  y: number;
}

/** A plain left press, from pointerdown until its click has settled. */
interface Press {
  x: number;
  y: number;
  /** Event time of the pointerdown, in the page's monotonic clock. */
  t: number;
  /** Wall-clock time of the pointerdown. */
  epoch: number;
  /** Event time of the release, or null while the button is down. */
  up: number | null;
  /** Largest distance the pointer has moved from the press point. */
  move: number;
  hit: Hit;
  /** Set only for a press on empty space. */
  empty: {
    watch: ReactionWatch;
    found: Found;
    features: Omit<ClickFeatures, 'press' | 'reacted' | 'reaction' | 'blurred'>;
  } | null;
}

/** A logged click that is still waiting for the user's next press. */
interface Pending {
  id: string;
  x: number;
  y: number;
  t: number;
  elements: Element[];
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The hostname of the page the user is on, also when this script runs in an iframe. */
function siteOf(): string {
  const origins = location.ancestorOrigins;
  const top = origins.length > 0 ? origins[origins.length - 1] : undefined;
  if (top) {
    try {
      return new URL(top).hostname;
    } catch {
      // An opaque origin has no hostname. Fall through to this frame's own.
    }
  }
  return location.hostname;
}

export function startCapture(): void {
  const site = siteOf();
  let moves: Move[] = [];
  let press: Press | null = null;
  /** The press whose click is waiting out the settle time. */
  let settling: { press: Press; timer: number } | null = null;
  let pending: Pending | null = null;
  let stopped = false;

  /** Caches listener answers for one press, since rings of sample points share ancestors. */
  function listenerLookup(): HasListener {
    const answers = new Map<EventTarget, boolean>();
    return (node) => {
      let answer = answers.get(node);
      if (answer === undefined) {
        answer = hasListener(node);
        answers.set(node, answer);
      }
      return answer;
    };
  }

  function send(message: WorkerMessage): void {
    try {
      chrome.runtime.sendMessage(message).catch(() => undefined);
    } catch {
      // The extension was reloaded or removed while this page stayed open.
      stop();
    }
  }

  function pathBefore(p: { x: number; y: number; t: number }): PathSample[] {
    return moves
      .filter((m) => m.t >= p.t - PATH_WINDOW_MS && m.t <= p.t)
      .map((m) => ({ t: Math.round(m.t - p.t), x: round(m.x - p.x), y: round(m.y - p.y) }));
  }

  /** Logs a settled empty-space click. Pass true when the page is unloading. */
  function finalize(unloading = false): void {
    if (!settling) return;
    clearTimeout(settling.timer);
    const p = settling.press;
    settling = null;
    if (!p.empty) return;
    const reaction = p.empty.watch.stop(unloading);
    const didReact = reacted(reaction);
    send({ type: 'count', site, field: didReact ? 'emptyReacted' : 'emptyIgnored' });
    if (p.empty.found.candidates.length === 0) return;
    const features: ClickFeatures = {
      ...p.empty.features,
      press: { ms: Math.round((p.up ?? p.t) - p.t), move: round(p.move) },
      reacted: didReact,
      reaction,
      blurred: p.empty.watch.tookFocusOffControl,
    };
    const record: ClickRecord = {
      v: 1,
      id: crypto.randomUUID(),
      t: p.epoch,
      site,
      features,
      decision: decide(features),
      decisionVersion,
      followUp: null,
    };
    send({ type: 'record', record });
    pending = { id: record.id, x: p.x, y: p.y, t: p.t, elements: p.empty.found.elements };
  }

  /** Describes a press that came after a logged click, relative to that click. */
  function followUpOf(event: PointerEvent, hit: Hit, first: Pending): FollowUp {
    const element = hit.kind === 'control' ? hit.clickable?.element : undefined;
    let candidate: number | null = null;
    if (element) {
      const exact = first.elements.indexOf(element);
      const related = first.elements.findIndex((e) => e.contains(element) || element.contains(e));
      candidate = exact >= 0 ? exact : related >= 0 ? related : null;
    }
    return {
      dt: Math.round(event.timeStamp - first.t),
      dx: round(event.clientX - first.x),
      dy: round(event.clientY - first.y),
      kind: hit.kind,
      candidate,
      dist: element ? distanceToElement(element, first.x, first.y) : null,
    };
  }

  function onPointerDown(event: PointerEvent): void {
    if (!event.isTrusted || event.pointerType !== 'mouse' || event.button !== 0) return;
    // A new press ends the previous click's settle time, so the page's reaction
    // to this press is not charged to that click.
    finalize();
    press?.empty?.watch.stop();
    press = null;

    const lookup = listenerLookup();
    const path = event.composedPath();
    const hit = classifyHit(path[0] ?? null, event.clientX, event.clientY, lookup);

    if (pending) {
      if (event.timeStamp - pending.t <= FOLLOW_UP_WINDOW_MS) {
        send({ type: 'followUp', id: pending.id, followUp: followUpOf(event, hit, pending) });
      }
      pending = null;
    }

    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

    const at = { x: event.clientX, y: event.clientY, t: event.timeStamp };
    let empty: Press['empty'] = null;
    if (hit.kind === 'empty' && path[0] instanceof Element) {
      empty = {
        watch: new ReactionWatch(path),
        found: findCandidates(at.x, at.y, lookup),
        features: {
          candidates: [],
          path: pathBefore(at),
          focused: document.hasFocus(),
          under: describeUnder(path[0]),
          point: { x: round(at.x), y: round(at.y) },
          viewport: { w: window.innerWidth, h: window.innerHeight },
          topFrame: window === window.top,
          listenersOnPath: path.filter(lookup).length,
        },
      };
      empty.features.candidates = empty.found.candidates;
    }
    press = { ...at, epoch: Date.now(), up: null, move: 0, hit, empty };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!event.isTrusted || event.pointerType !== 'mouse') return;
    moves.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
    if (moves.length > MAX_PATH_SAMPLES) moves = moves.slice(-MAX_PATH_SAMPLES);
    if (press && press.up === null) {
      press.move = Math.max(
        press.move,
        Math.hypot(event.clientX - press.x, event.clientY - press.y),
      );
    }
  }

  function onPointerUp(event: PointerEvent): void {
    if (!event.isTrusted || event.button !== 0 || !press || press.up !== null) return;
    press.up = event.timeStamp;
    press.move = Math.max(press.move, Math.hypot(event.clientX - press.x, event.clientY - press.y));
  }

  function onClick(event: MouseEvent): void {
    if (!event.isTrusted || event.button !== 0 || !press) return;
    const p = press;
    press = null;
    if (!p.empty) {
      send({ type: 'count', site, field: 'hits' });
      return;
    }
    settling = { press: p, timer: window.setTimeout(() => finalize(), SETTLE_MS) };
  }

  /** A page that unloads during the settle time reacted by navigating. */
  function onPageHide(): void {
    finalize(true);
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('pagehide', onPageHide, true);
    press?.empty?.watch.stop();
    settling?.press.empty?.watch.stop();
    if (settling) clearTimeout(settling.timer);
  }

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('pagehide', onPageHide, true);
}
