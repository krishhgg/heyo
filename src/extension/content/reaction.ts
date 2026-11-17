// Watches whether the page reacts to a press. The plan counts any DOM mutation,
// focus change, selection change, scroll or navigation, from the press until
// about 50 ms after the click.
import type { Reaction } from '../../core/types';
import { allShadowRoots } from './dom';

interface NavigationLike {
  addEventListener(type: 'navigate', listener: () => void): void;
  removeEventListener(type: 'navigate', listener: () => void): void;
}

const EVERYTHING = { subtree: true, childList: true, attributes: true, characterData: true };

/** Input types that are buttons or toggles, not text the user types. */
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'submit',
  'reset',
  'image',
  'checkbox',
  'radio',
  'range',
  'color',
  'file',
]);

/** True for an element the user types or picks a value in. */
function isTextField(element: unknown): boolean {
  if (element instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(element.type);
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

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
  private readonly observer = new MutationObserver(() => {
    this.seen.mutation = true;
  });
  private readonly selectionBefore = selectedText();
  private readonly hrefBefore = location.href;
  private blurred = false;
  private stopped = false;

  // Chrome moves focus on its own at a press outside a control. It takes focus
  // off the button or link clicked last, and it gives focus to a focusable
  // container around the press, such as a dialog. Neither is the page reacting.
  // Focus arriving anywhere else, or leaving a field the user types in, is.
  private readonly onFocusIn = (event: FocusEvent) => {
    const target = event.composedPath()[0];
    if (!isTextField(target) && target && this.path.includes(target)) this.blurred = true;
    else this.seen.focus = true;
  };
  private readonly onFocusOut = (event: FocusEvent) => {
    if (isTextField(event.composedPath()[0])) this.seen.focus = true;
    else this.blurred = true;
  };
  private readonly onScroll = () => {
    this.seen.scroll = true;
  };
  private readonly onNavigate = () => {
    this.seen.navigation = true;
  };

  /**
   * Starts watching. Call it at the press, before the page has handled anything.
   * `path` is the press's event path.
   */
  constructor(private readonly path: EventTarget[]) {
    this.observer.observe(document, EVERYTHING);
    // A document observer does not see inside shadow roots, and the page can
    // react inside any of them, such as a menu in another component closing.
    for (const root of allShadowRoots()) this.observer.observe(root, EVERYTHING);
    window.addEventListener('focusin', this.onFocusIn, true);
    window.addEventListener('focusout', this.onFocusOut, true);
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('hashchange', this.onNavigate, true);
    window.addEventListener('popstate', this.onNavigate, true);
    this.navigation?.addEventListener('navigate', this.onNavigate);
  }

  private get navigation(): NavigationLike | undefined {
    return (window as { navigation?: NavigationLike }).navigation;
  }

  /** Stops watching and returns what the page did. Pass true when the page is unloading. */
  stop(unloading = false): Reaction {
    if (!this.stopped) {
      this.stopped = true;
      if (unloading) this.seen.navigation = true;
      if (this.observer.takeRecords().length > 0) this.seen.mutation = true;
      this.observer.disconnect();
      window.removeEventListener('focusin', this.onFocusIn, true);
      window.removeEventListener('focusout', this.onFocusOut, true);
      window.removeEventListener('scroll', this.onScroll, true);
      window.removeEventListener('hashchange', this.onNavigate, true);
      window.removeEventListener('popstate', this.onNavigate, true);
      this.navigation?.removeEventListener('navigate', this.onNavigate);
      // Chrome moves an invisible caret on almost every click outside a field,
      // so only a change to the visible selection counts.
      if (selectedText() !== this.selectionBefore) this.seen.selection = true;
      if (location.href !== this.hrefBefore) this.seen.navigation = true;
    }
    return { ...this.seen };
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
