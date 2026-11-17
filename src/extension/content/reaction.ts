// Watches whether the page reacts to a press. The plan counts any DOM mutation,
// focus change, selection change, scroll or navigation, from the press until
// about 50 ms after the click.
import type { Reaction } from '../../core/types';

interface NavigationLike {
  addEventListener(type: 'navigate', listener: () => void): void;
  removeEventListener(type: 'navigate', listener: () => void): void;
}

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
function isTextField(element: Element): boolean {
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
  private readonly onFocusIn = () => {
    this.seen.focus = true;
  };
  private readonly onFocusOut = (event: FocusEvent) => {
    // Chrome takes focus off the last-clicked button or link on any click
    // outside a control. Only leaving a field the user types in is a reaction.
    if (event.target instanceof Element && isTextField(event.target)) this.seen.focus = true;
    else this.blurred = true;
  };
  private readonly onScroll = () => {
    this.seen.scroll = true;
  };
  private readonly onNavigate = () => {
    this.seen.navigation = true;
  };
  private stopped = false;

  /** Starts watching. Call it at the press, before the page has handled anything. */
  constructor(path: EventTarget[]) {
    const options = { subtree: true, childList: true, attributes: true, characterData: true };
    this.observer.observe(document, options);
    // A document observer does not see inside shadow roots.
    for (const node of path) {
      if (node instanceof ShadowRoot) this.observer.observe(node, options);
    }
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

  /** True when the click took focus off a control that is not a text field. Read it after stop. */
  get tookFocusOffControl(): boolean {
    return this.blurred;
  }
}

export function reacted(reaction: Reaction): boolean {
  return Object.values(reaction).some(Boolean);
}
