// Shadow mode. Watches plain left clicks, and for each one that lands on empty
// space logs what was nearby, what the decision would have done, whether the
// page reacted, and where the next press went. It changes nothing on the page.
import {
  DOUBLE_PRESS_MS,
  DOUBLE_PRESS_PX,
  FOLLOW_UP_WINDOW_MS,
  MISS_RADIUS_PX,
} from '../../core/labels';
import type { ClickFeatures, ClickRecord, Fire, FollowUp, PathSample } from '../../core/types';
import { decide } from '../../decision';
import type { WorkerMessage } from '../messages';
import { mayAct, planFire } from '../plan';
import { DEFAULT_SETTINGS, readSettings, watchSettings, type Settings } from '../settings';
import { decisionVersion } from '../version';
import { boxOf, findCandidates, isLabelPair, type Found } from './candidates';
import { isDisabled, tagOf, type HasListener } from './clickable';
import { describeUnder, labelOf, typedText } from './describe';
import { allShadowRoots, deepestAt, isWithin } from './dom';
import { deepActiveElement } from './fields';
import { classifyHit, type Hit } from './hit';
import { hasListener } from './listeners';
import { BackgroundWatch, reacted, ReactionWatch } from './reaction';
import { sendClick } from './replay';
import { uuid } from './uuid';

/** The page gets this long after the click to show a reaction. */
const SETTLE_MS = 50;

/** How much cursor path the log keeps before a press. */
const PATH_WINDOW_MS = 300;

/** A replaced control matches a logged candidate when its box moved by at most this many px. */
const SAME_BOX_PX = 2;

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
  /**
   * True for a press in the same spot as the one before it, within the
   * double-click interval: the second click of a double-click, or a retry so
   * quick that the first click may still be acted on.
   */
  repeat: boolean;
  hit: Hit;
  /** Set only for a press on empty space. */
  empty: {
    watch: ReactionWatch;
    found: Found;
    /** Null in a cross-origin iframe, where focus is read at the click instead. */
    focused: boolean | null;
    features: Omit<
      ClickFeatures,
      'press' | 'focused' | 'reacted' | 'reaction' | 'blurred' | 'leftField' | 'mutations'
    >;
  } | null;
}

/** A logged click that is still waiting for the user's next press. */
interface Pending {
  id: string;
  x: number;
  y: number;
  t: number;
  found: Found;
  /** The page scrolled after the click, so positions no longer line up with it. */
  scrolled: boolean;
  /**
   * Set for a click with nothing found nearby. It is logged only if the next
   * press shows it was a miss on a control the search did not see.
   */
  unsent: ClickRecord | null;
}

/** True for an element that embeds another page, whose input this script never sees. */
function isFrame(element: Element | null): boolean {
  return (
    element instanceof HTMLIFrameElement ||
    element instanceof HTMLFrameElement ||
    element instanceof HTMLObjectElement ||
    element instanceof HTMLEmbedElement
  );
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

/**
 * Whether the tab had focus at the press. An iframe's own document gains focus
 * only after the press, so it asks the top page. A cross-origin iframe cannot,
 * and returns null.
 */
function tabFocused(): boolean | null {
  if (window === window.top) return document.hasFocus();
  try {
    return window.top?.document.hasFocus() ?? null;
  } catch {
    return null;
  }
}

export function startCapture(): void {
  const site = siteOf();
  const background = new BackgroundWatch();
  const moves: Move[] = [];
  let press: Press | null = null;
  /**
   * The press whose click is waiting out the settle time. `acted` is set when
   * the user did something else in that time.
   */
  let settling: { press: Press; timer: number; acted: boolean } | null = null;
  /** True while key presses are listened for, which is only while a click may be sent on. */
  let keys = false;
  let pending: Pending | null = null;
  /** The last plain left press, to tell a double-click's second press. */
  let lastPress: { t: number; x: number; y: number } | null = null;
  /**
   * A click heyo is about to send on, once the double-click interval has
   * passed. `watch` sees what the page does in the meantime.
   */
  let waiting: { id: string; timer: number; watch: ReactionWatch } | null = null;
  let stopped = false;

  // Until the settings load, and whenever they cannot be read, heyo only logs.
  let settings: Settings = DEFAULT_SETTINGS;
  void readSettings().then((loaded) => (settings = loaded));
  watchSettings((changed) => {
    settings = changed;
    // Turning retargeting off also stops a click that is waiting to go out.
    if (!mayAct(settings, site)) cancelWaiting('off');
  });

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

  function dropPress(): void {
    press?.empty?.watch.stop();
    press = null;
  }

  /**
   * Logs an empty-space click. `cause` says why now: its settle time ran out,
   * the user pressed again before that, or the page is unloading.
   */
  function finalize(cause: 'settled' | 'pressed' | 'unloading' = 'settled'): void {
    if (!settling) return;
    clearTimeout(settling.timer);
    const { press: p, acted } = settling;
    settling = null;
    if (!waiting) listenForKeys(false);
    if (!p.empty) return;
    const reaction = p.empty.watch.stop(cause === 'unloading');
    const didReact = reacted(reaction);
    send({ type: 'count', site, field: didReact ? 'emptyReacted' : 'emptyIgnored' });
    // The send found the extension gone, reloaded or removed. Nothing more can be logged.
    if (stopped) return;
    const lone = p.empty.found.candidates.length === 0;
    if (lone && didReact) return;
    const features: ClickFeatures = {
      ...p.empty.features,
      press: { ms: Math.round((p.up ?? p.t) - p.t), move: round(p.move) },
      focused: p.empty.focused ?? document.hasFocus(),
      reacted: didReact,
      reaction,
      blurred: p.empty.watch.movedFocusByDefault,
      leftField: p.empty.watch.leftField,
      mutations: p.empty.watch.mutations,
    };
    const record: ClickRecord = {
      v: 1,
      id: uuid(),
      t: p.epoch,
      site,
      features,
      decision: decide(features),
      decisionVersion,
      extensionVersion: chrome.runtime.getManifest().version,
      followUp: null,
    };
    const plan = lone ? 'log' : planFire(settings, site, record, Math.random());
    if (plan === 'hold') record.fire = { outcome: 'held' };
    // A click is sent on only once its settle time has run out in peace. If the
    // user is already pressing again, sending it would act twice. If the user
    // has done anything else, the click is no longer the last thing they did.
    // The second click of a double-click is never sent on. The first one was, or
    // was not for a reason, and a second send would act twice.
    const inPeace = cause === 'settled' && !acted && !p.repeat;
    if (plan === 'send' && !inPeace) record.fire = { outcome: 'failed', failure: 'second-press' };
    if (!lone) send({ type: 'record', record });
    if (plan === 'send' && inPeace) sendOn(record, p);
    pending = {
      id: record.id,
      x: p.x,
      y: p.y,
      t: p.t,
      found: p.empty.found,
      scrolled: false,
      unsent: lone ? record : null,
    };
  }

  /**
   * Key presses matter only between a click and the moment heyo sends it on,
   * so they are listened for only then, and never in shadow mode.
   */
  function listenForKeys(on: boolean): void {
    if (on === keys) return;
    keys = on;
    if (on) window.addEventListener('keydown', onKey, true);
    else window.removeEventListener('keydown', onKey, true);
  }

  /**
   * The user did something after the click: pressed a button or a key, or took
   * the window's focus elsewhere, as a press in an iframe or another window
   * does. A click heyo was going to send on is dropped, since it is no longer
   * the last thing the user did.
   */
  function userActed(): void {
    if (settling) settling.acted = true;
    cancelWaiting('second-press');
  }

  function onKey(event: Event): void {
    if (event.isTrusted) userActed();
  }

  /** Ends the wait before a click goes out, and says whether the page did anything during it. */
  function endWaiting(): { id: string; reacted: boolean } | null {
    if (!waiting) return null;
    const { id, timer, watch } = waiting;
    waiting = null;
    clearTimeout(timer);
    listenForKeys(false);
    window.removeEventListener('beforeunload', onLeaveWhileWaiting, true);
    return { id, reacted: reacted(watch.stop()) };
  }

  /** Drops the click that is waiting to go out, and logs why. */
  function cancelWaiting(failure: NonNullable<Fire['failure']>): void {
    const ended = endWaiting();
    if (ended) send({ type: 'fire', id: ended.id, fire: { outcome: 'failed', failure } });
  }

  /** A page that starts to leave has reacted, also when its unload takes a while. */
  function onLeaveWhileWaiting(): void {
    cancelWaiting('reacted');
  }

  /** Sends the click on to the decision's target, now or after the double-click interval. */
  function sendOn(record: ClickRecord, p: Press): void {
    if (record.decision.action !== 'retarget' || !p.empty) return;
    const { candidate: index } = record.decision;
    const control = p.empty.found.elements[index];
    const candidate = record.features.candidates[index];
    const report = (fire: Fire) => send({ type: 'fire', id: record.id, fire });
    if (!control || !candidate) return report({ outcome: 'failed', failure: 'gone' });
    const go = () => {
      // heyo may have been turned off or removed in chrome://extensions during the wait.
      if (!chrome.runtime?.id) return stop();
      // Retargeting may have been turned off since the click was planned.
      if (!mayAct(settings, site)) return report({ outcome: 'failed', failure: 'off' });
      // The user may have gone to another window in a way this script did not
      // see. And while an embedded frame holds focus, a press or a key in it
      // never shows here, not even as the window losing focus.
      if (!document.hasFocus() || isFrame(deepActiveElement())) {
        return report({ outcome: 'failed', failure: 'second-press' });
      }
      sendClick(control, candidate, { x: p.x, y: p.y }, report);
    };
    if (!settings.waitForDoubleClick) return go();
    // The page is watched through the wait, as it was through the click's own
    // settle time. If it does anything, the click it ignored was not ignored after all.
    const watch = p.empty.watch.again();
    const wait = Math.max(0, DOUBLE_PRESS_MS - (performance.now() - p.t));
    const timer = window.setTimeout(() => {
      const ended = endWaiting();
      if (!ended) return;
      if (ended.reacted) return report({ outcome: 'failed', failure: 'reacted' });
      go();
    }, wait);
    waiting = { id: record.id, timer, watch };
    listenForKeys(true);
    window.addEventListener('beforeunload', onLeaveWhileWaiting, true);
  }

  /**
   * True when the page no longer lines up with the first click: the window
   * scrolled, or a logged candidate has moved. A scroll inside a shadow root
   * or a scrolling box sends no event this script is sure to see, so the
   * candidates' own boxes are checked too.
   */
  function hasShifted(first: Pending): boolean {
    if (first.scrolled) return true;
    const { elements, candidates } = first.found;
    return elements.some((element, i) => {
      const logged = candidates[i]?.rect;
      const now = element.isConnected ? boxOf(element, element, first.x, first.y)?.rect : null;
      return logged && now && (Math.abs(now.x - logged.x) > 1 || Math.abs(now.y - logged.y) > 1);
    });
  }

  /**
   * The logged candidate a later press hit, or null. A page can replace a
   * control with an identical node between the two presses, so a candidate
   * that left the document also matches a control with the same tag, label
   * and box, when exactly one candidate fits.
   */
  function matchCandidate(element: Element, target: Element, first: Pending): number | null {
    const { elements, candidates } = first.found;
    const exact = elements.indexOf(element);
    if (exact >= 0) return exact;
    // A label and its control are one target. So are a control and what it wraps.
    const paired = elements.findIndex((e) => isLabelPair(e, element));
    if (paired >= 0) return paired;
    const related = elements.findIndex((e) => isWithin(element, e) || isWithin(e, element));
    if (related >= 0) return related;
    if (hasShifted(first)) return null;
    const box = boxOf(element, target, first.x, first.y);
    if (!box) return null;
    const label = labelOf(element, typedText(allShadowRoots())).text;
    const near = (a: number, b: number) => Math.abs(a - b) <= SAME_BOX_PX;
    const same = candidates.filter(
      (c, i) =>
        !elements[i]?.isConnected &&
        c.tag === tagOf(element) &&
        c.label === label &&
        near(c.rect.x, box.rect.x) &&
        near(c.rect.y, box.rect.y) &&
        near(c.rect.w, box.rect.w) &&
        near(c.rect.h, box.rect.h),
    );
    return same.length === 1 ? same[0]!.id : null;
  }

  /** Describes a press that came after a logged click, relative to that click. */
  function followUpOf(event: PointerEvent, hit: Hit, target: Element, first: Pending): FollowUp {
    const element = hit.kind === 'control' ? hit.clickable?.element : undefined;
    const candidate = element ? matchCandidate(element, target, first) : null;
    let dist: number | null = null;
    if (candidate !== null) {
      // The distance measured at the first click. The control may have moved since.
      dist = first.found.candidates[candidate]?.dist ?? null;
    } else if (element && !hasShifted(first)) {
      dist = boxOf(element, target, first.x, first.y)?.dist ?? null;
    }
    return {
      dt: Math.round(event.timeStamp - first.t),
      dx: round(event.clientX - first.x),
      dy: round(event.clientY - first.y),
      kind: hit.kind,
      candidate,
      dist,
    };
  }

  function onPointerDown(event: PointerEvent): void {
    // Any press before the click was sent on, with any button, means the user is
    // double-clicking, retrying or doing something else. Nothing is sent after it.
    if (event.isTrusted) userActed();
    if (!event.isTrusted || event.pointerType !== 'mouse' || event.button !== 0) return;
    // A new press ends the previous click's settle time, so the page's reaction
    // to this press is not charged to that click.
    finalize('pressed');
    dropPress();

    const path = event.composedPath();
    const origin = path[0];
    if (!(origin instanceof Element)) return;
    const at = { x: event.clientX, y: event.clientY, t: event.timeStamp };
    const repeat =
      lastPress !== null &&
      at.t - lastPress.t <= DOUBLE_PRESS_MS &&
      Math.hypot(at.x - lastPress.x, at.y - lastPress.y) <= DOUBLE_PRESS_PX;
    lastPress = at;
    // The event path stops at a closed shadow root's host. Look inside it.
    const target = deepestAt(origin, at.x, at.y);
    const lookup = listenerLookup();
    const hit = classifyHit(target, at.x, at.y, lookup);

    if (pending) {
      if (at.t - pending.t <= FOLLOW_UP_WINDOW_MS) {
        const followUp = followUpOf(event, hit, target, pending);
        if (!pending.unsent) {
          send({ type: 'followUp', id: pending.id, followUp });
        } else if (followUp.dist !== null && followUp.dist <= MISS_RADIUS_PX) {
          // The search found nothing near the first click, yet the user then hit a
          // control right there. That is a miss on a control heyo could not see.
          send({ type: 'record', record: { ...pending.unsent, followUp } });
        }
      }
      pending = null;
    }

    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

    let empty: Press['empty'] = null;
    if (hit.kind === 'empty') {
      const roots = allShadowRoots();
      const typed = typedText(roots);
      const found = findCandidates(at.x, at.y, lookup, typed);
      empty = {
        watch: new ReactionWatch(path, found.elements, roots),
        found,
        focused: tabFocused(),
        features: {
          candidates: found.candidates,
          path: pathBefore(at),
          churn: background.changedBefore(at.t, PATH_WINDOW_MS),
          under: describeUnder(target, typed),
          point: { x: round(at.x), y: round(at.y) },
          viewport: { w: window.innerWidth, h: window.innerHeight },
          scale: window.devicePixelRatio,
          topFrame: window === window.top,
          listenersOnPath: path.filter(lookup).length,
        },
      };
    }
    press = { ...at, epoch: Date.now(), up: null, move: 0, repeat, hit, empty };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!event.isTrusted || event.pointerType !== 'mouse') return;
    const now = event.timeStamp;
    background.touch(now);
    moves.push({ t: now, x: event.clientX, y: event.clientY });
    // Keep the path window by time, so a fast display does not cut it short.
    while (moves.length > 0 && moves[0]!.t < now - PATH_WINDOW_MS) moves.shift();
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
    // Chrome sends no click for a press on a disabled control, or on one the
    // page removed during the press, as some menus do. Count the press here.
    const control = press.hit.clickable?.element;
    if (press.hit.kind === 'control' && control && (isDisabled(control) || !control.isConnected)) {
      send({ type: 'count', site, field: 'hits' });
      press = null;
      return;
    }
    // The click follows the release at once. A press that gets none, such as
    // one released outside the window, is dropped so its watch does not run on.
    const released = press;
    window.setTimeout(() => {
      if (press === released) dropPress();
    }, SETTLE_MS);
  }

  function onClick(event: MouseEvent): void {
    // A click from the keyboard has no pointer type and belongs to no press.
    if (!event.isTrusted || event.button !== 0 || !press) return;
    if ((event as PointerEvent).pointerType !== 'mouse') return;
    const p = press;
    press = null;
    // The browser counts clicks by the system's own double-click settings.
    if (event.detail > 1) p.repeat = true;
    if (!p.empty) {
      send({ type: 'count', site, field: 'hits' });
      return;
    }
    settling = { press: p, timer: window.setTimeout(() => finalize(), SETTLE_MS), acted: false };
    if (mayAct(settings, site)) listenForKeys(true);
  }

  /** A press the browser cancelled, such as one that became a native drag, has no click. */
  function onPointerCancel(): void {
    dropPress();
  }

  function onScroll(): void {
    if (pending) pending.scrolled = true;
  }

  /**
   * The window loses focus when the user clicks into an iframe or another
   * window. This script never sees that press, so the next one it does see is
   * not the follow-up to the pending click.
   */
  function onBlur(event: FocusEvent): void {
    if (event.target !== window) return;
    pending = null;
    userActed();
  }

  /**
   * A page that unloads during the settle time reacted by navigating. A click
   * waiting to go out is dropped too, or it would go out when the page comes
   * back from the back/forward cache.
   */
  function onPageHide(): void {
    finalize('unloading');
    cancelWaiting('reacted');
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerCancel, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('blur', onBlur, true);
    window.removeEventListener('pagehide', onPageHide, true);
    background.stop();
    dropPress();
    settling?.press.empty?.watch.stop();
    if (settling) clearTimeout(settling.timer);
    endWaiting();
    listenForKeys(false);
  }

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerCancel, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('blur', onBlur, true);
  window.addEventListener('pagehide', onPageHide, true);
}
