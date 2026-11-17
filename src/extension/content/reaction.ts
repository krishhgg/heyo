// Watches whether the page reacts to a press. The plan counts any DOM mutation,
// focus change, selection change, scroll or navigation, from the press until
// about 50 ms after the click.
import type { Reaction } from '../../core/types';
import { allShadowRoots } from './dom';
import { deepActiveElement, isTextField } from './fields';

interface NavigationLike {
  addEventListener(type: 'navigate', listener: () => void): void;
  removeEventListener(type: 'navigate', listener: () => void): void;
}

const EVERYTHING = {
  subtree: true,
  childList: true,
  attributes: true,
  attributeOldValue: true,
  characterData: true,
};

/** True for an attribute record whose attribute holds the same value as before. */
function isUnchanged(record: MutationRecord): boolean {
  const name = record.attributeName;
  if (record.type !== 'attributes' || !name || !(record.target instanceof Element)) return false;
  return record.target.getAttribute(name) === record.oldValue;
}

/** A class or attribute name that only says where focus is. */
const FOCUS_WORD = /focus/i;

/**
 * True for an attribute change that only mirrors focus: an attribute named for
 * focus, such as data-focused or data-focus-within, or a class change whose
 * added and removed names are all about focus, such as cdk-focused. A change
 * to aria-expanded or to any other class is not one.
 */
function isFocusMarker(record: MutationRecord): boolean {
  const name = record.attributeName;
  if (record.type !== 'attributes' || !name || !(record.target instanceof Element)) return false;
  if (name !== 'class') return FOCUS_WORD.test(name);
  const before = new Set((record.oldValue ?? '').split(/\s+/).filter(Boolean));
  const after = new Set(record.target.classList);
  const changed = [...before, ...after].filter((token) => before.has(token) !== after.has(token));
  return changed.length > 0 && changed.every((token) => FOCUS_WORD.test(token));
}

/** How many DOM changes are checked for being near the click. */
const NEAR_CHECK_LIMIT = 500;

/** The visible selection. A bare caret counts as no selection. */
function selectedText(): string {
  const selection = document.getSelection();
  return selection && !selection.isCollapsed ? selection.toString() : '';
}

export class ReactionWatch {
  private readonly seen: Reaction = {
    mutation: false,
    focus: false,
    selection: false,
    scroll: false,
    navigation: false,
  };
  private readonly observer = new MutationObserver((records) => this.count(records));
  private total = 0;
  private nearCount = 0;
  private readonly selectionBefore = selectedText();
  private readonly hrefBefore = location.href;
  private blurred = false;
  private left = false;
  private stopped = false;
  /** The text field that had focus at the press, if any. */
  private readonly fieldBefore: Element | null;

  // Chrome moves focus on its own at a press outside a control. It takes focus
  // off the button or link clicked last, and it gives focus to a focusable
  // container around the press, such as a dialog. Neither is the page reacting.
  // Focus arriving anywhere else, or leaving a field the user types in, is.
  // Leaving a field is checked at the end by comparing the focused element,
  // because a focus event from inside a closed shadow root names only the host.
  private readonly onFocus = (event: FocusEvent) => {
    const target = event.composedPath()[0];
    if (target === window) return;
    if (!isTextField(target) && target && this.path.includes(target)) this.blurred = true;
    else this.seen.focus = true;
  };
  private readonly onBlur = (event: FocusEvent) => {
    if (event.composedPath()[0] !== window) this.blurred = true;
  };
  /**
   * Attribute changes seen so far that only mirror focus. Focus-tracking code
   * marks the focused element, or a wrapper around it, with a class or an
   * attribute. When Chrome moved focus on its own, those changes are no more a
   * reaction than the focus move was. They are judged when the watch stops,
   * because a page handler can run before this watch hears of the focus move.
   */
  private focusMarks = 0;
  private readonly onScroll = () => {
    this.seen.scroll = true;
  };
  private readonly onNavigate = () => {
    this.seen.navigation = true;
  };

  /**
   * Starts watching. Call it at the press, before the page has handled anything.
   * `path` is the press's event path and `candidates` the elements found near it.
   */
  constructor(
    private readonly path: EventTarget[],
    private readonly candidates: Element[],
    private readonly roots: ShadowRoot[],
  ) {
    const active = deepActiveElement();
    this.fieldBefore = isTextField(active) ? active : null;
    this.observer.observe(document, EVERYTHING);
    // A document observer does not see inside shadow roots, and the page can
    // react inside any of them, such as a menu in another component closing.
    // A scroll event inside a shadow root does not leave it either.
    for (const root of roots) {
      this.observer.observe(root, EVERYTHING);
      root.addEventListener('scroll', this.onScroll, true);
    }
    window.addEventListener('focus', this.onFocus, true);
    window.addEventListener('blur', this.onBlur, true);
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('hashchange', this.onNavigate, true);
    window.addEventListener('popstate', this.onNavigate, true);
    this.navigation?.addEventListener('navigate', this.onNavigate);
  }

  private count(records: MutationRecord[]): void {
    for (const record of records) {
      // Code often writes an attribute back with the value it already had, such
      // as removing a class that was not there. Nothing changed, so it is skipped.
      if (isUnchanged(record)) continue;
      if (isFocusMarker(record)) {
        this.focusMarks++;
        continue;
      }
      const { target } = record;
      this.seen.mutation = true;
      this.total++;
      // Past the limit only the total is kept, to bound the work on a page that changes a lot.
      if (this.total > NEAR_CHECK_LIMIT) continue;
      // The page root is on every press path. A change there says nothing about this click.
      const isRoot =
        target === document || target === document.documentElement || target === document.body;
      const near =
        (!isRoot && this.path.includes(target)) ||
        this.candidates.some((element) => element === target || element.contains(target));
      if (near) this.nearCount++;
    }
  }

  private get navigation(): NavigationLike | undefined {
    return (window as { navigation?: NavigationLike }).navigation;
  }

  /** Stops watching and returns what the page did. Pass true when the page is unloading. */
  stop(unloading = false): Reaction {
    if (!this.stopped) {
      this.stopped = true;
      if (unloading) this.seen.navigation = true;
      const rest = this.observer.takeRecords();
      if (rest.length > 0) this.count(rest);
      this.observer.disconnect();
      // Focus marks count as a reaction only when focus did not move by Chrome's own doing.
      if (this.focusMarks > 0 && !this.blurred) {
        this.seen.mutation = true;
        this.total += this.focusMarks;
      }
      window.removeEventListener('focus', this.onFocus, true);
      window.removeEventListener('blur', this.onBlur, true);
      window.removeEventListener('scroll', this.onScroll, true);
      window.removeEventListener('hashchange', this.onNavigate, true);
      window.removeEventListener('popstate', this.onNavigate, true);
      this.navigation?.removeEventListener('navigate', this.onNavigate);
      for (const root of this.roots) root.removeEventListener('scroll', this.onScroll, true);
      if (this.fieldBefore && deepActiveElement() !== this.fieldBefore) {
        this.left = true;
        this.seen.focus = true;
      }
      // Chrome moves an invisible caret on almost every click outside a field,
      // so only a change to the visible selection counts.
      if (selectedText() !== this.selectionBefore) this.seen.selection = true;
      if (location.href !== this.hrefBefore) this.seen.navigation = true;
    }
    return { ...this.seen };
  }

  /** How many DOM changes were seen, and how many were on the press path or a candidate. Read it after stop. */
  get mutations(): { total: number; near: number } {
    return { total: this.total, near: this.nearCount };
  }

  /** True when focus left a field the user types in. Read it after stop. */
  get leftField(): boolean {
    return this.left;
  }

  /** True when the press moved focus the way Chrome does on its own. Read it after stop. */
  get movedFocusByDefault(): boolean {
    return this.blurred;
  }
}

export function reacted(reaction: Reaction): boolean {
  return Object.values(reaction).some(Boolean);
}

/** The pointer has to rest this long before the background watch stops. */
const IDLE_MS = 1000;

/**
 * Watches for DOM changes while the pointer is moving and nothing is pressed.
 * A page that changes on its own, such as a ticker, a playing video's controls
 * or streaming text, would otherwise make every click look reacted to.
 */
export class BackgroundWatch {
  private readonly observer = new MutationObserver(() => {
    this.lastChange = performance.now();
  });
  private watchingSince: number | null = null;
  private lastChange = -Infinity;
  private lastMove = -Infinity;

  /** Call on every pointer move. Starts the watch if it is not running. */
  touch(now: number): void {
    this.lastMove = now;
    if (this.watchingSince !== null) return;
    this.watchingSince = now;
    this.observer.observe(document, EVERYTHING);
    // A ticker inside a web component changes only its shadow root. Finding the
    // roots takes a moment, so it waits until this pointer move has been handled.
    window.setTimeout(() => {
      if (this.watchingSince === null) return;
      for (const root of allShadowRoots()) this.observer.observe(root, EVERYTHING);
    }, 0);
    window.setTimeout(this.rest, IDLE_MS);
  }

  private readonly rest = () => {
    const idle = performance.now() - this.lastMove;
    if (idle < IDLE_MS) {
      window.setTimeout(this.rest, IDLE_MS - idle);
    } else {
      this.observer.disconnect();
      this.watchingSince = null;
    }
  };

  /**
   * Whether the DOM changed in the `windowMs` before `now`. Null when no change
   * was seen but the watch had not been running for that whole time.
   */
  changedBefore(now: number, windowMs: number): boolean | null {
    if (this.observer.takeRecords().length > 0) this.lastChange = now;
    if (this.lastChange >= now - windowMs) return true;
    const watchedAll = this.watchingSince !== null && this.watchingSince <= now - windowMs;
    return watchedAll ? false : null;
  }

  stop(): void {
    this.observer.disconnect();
    this.watchingSince = null;
  }
}
