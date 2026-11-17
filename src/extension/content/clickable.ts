// Decides whether an element looks clickable, and finds the clickable element
// a click on a given node would reach.
import type { ClickSignal } from '../../core/types';
import { parentOf, shadowRootOf } from './dom';

/** Elements whose content heyo cannot see into. A click on one is a real hit. */
const OPAQUE_TAGS = new Set(['canvas', 'video', 'iframe', 'embed', 'object', 'audio']);

const NATIVE_TAGS = new Set(['button', 'select', 'textarea', 'summary', 'option']);

/** ARIA widget roles that a click activates. */
const CLICKABLE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'combobox',
  'textbox',
  'searchbox',
  'slider',
  'spinbutton',
  'treeitem',
]);

/** Matches any descendant that is clickable without a listener or cursor signal. */
const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  ...[...CLICKABLE_ROLES].map((role) => `[role~="${role}"]`),
].join(',');

/** A listener on an element that covers this share of the viewport is treated as delegation. */
const DELEGATE_VIEWPORT_SHARE = 0.5;

export type ElementKind = 'control' | 'opaque';

export interface Clickable {
  element: Element;
  kind: ElementKind;
  signals: ClickSignal[];
}

/** Asks whether the page registered a click-type listener on a node. */
export type HasListener = (node: EventTarget) => boolean;

export function tagOf(element: Element): string {
  return element.localName;
}

export function roleOf(element: Element): string | null {
  const role = element.getAttribute('role')?.trim().split(/\s+/)[0]?.toLowerCase();
  return role ? role : null;
}

function isEditable(element: Element): boolean {
  return element instanceof HTMLElement && element.isContentEditable;
}

function isNative(element: Element): boolean {
  const tag = tagOf(element);
  if (NATIVE_TAGS.has(tag)) return true;
  if (tag === 'a' || tag === 'area') return element.hasAttribute('href');
  if (tag === 'input') return (element as HTMLInputElement).type !== 'hidden';
  if (tag === 'label') return (element as HTMLLabelElement).control !== null;
  return isEditable(element);
}

function hasTabStop(element: Element): boolean {
  const value = element.getAttribute('tabindex');
  return value !== null && Number.parseInt(value, 10) >= 0;
}

function isScrollRegion(element: Element): boolean {
  const { overflowX, overflowY } = getComputedStyle(element);
  return [overflowX, overflowY].some((value) => value === 'auto' || value === 'scroll');
}

function hasPointerCursor(element: Element): boolean {
  return getComputedStyle(element).cursor === 'pointer';
}

/** A listener on an element with more descendants than this is treated as delegation. */
const MAX_OWN_DESCENDANTS = 60;

/** True when an element wraps something that is clickable in its own right. */
function wrapsAControl(element: Element, hasListener: HasListener): boolean {
  // A component's controls live in its shadow root, not among its children.
  const shadow = shadowRootOf(element);
  if (element.querySelector(INTERACTIVE_SELECTOR) || shadow?.querySelector(INTERACTIVE_SELECTOR)) {
    return true;
  }
  const descendants = [
    ...element.getElementsByTagName('*'),
    ...(shadow?.querySelectorAll('*') ?? []),
  ];
  if (descendants.length > MAX_OWN_DESCENDANTS) return true;
  const ownPointer = hasPointerCursor(element);
  for (const descendant of descendants) {
    if (hasTabStop(descendant) || hasListener(descendant)) return true;
    // A pointer cursor that starts below the element marks a separate control.
    if (!ownPointer && hasPointerCursor(descendant)) return true;
  }
  return false;
}

/**
 * True when an element is the thing being clicked and not a region around
 * other things. The page root, a large region and a wrapper around other
 * controls are regions.
 */
function isOneControl(element: Element, hasListener: HasListener): boolean {
  if (element === document.documentElement || element === document.body) return false;
  const rect = element.getBoundingClientRect();
  const viewport = window.innerWidth * window.innerHeight;
  if (rect.width * rect.height >= viewport * DELEGATE_VIEWPORT_SHARE) return false;
  return !wrapsAControl(element, hasListener);
}

/**
 * A click listener marks an element as clickable only when the element is one
 * control. A listener on a region is event delegation, and React puts every
 * handler on its root.
 */
function isOwnListener(element: Element, hasListener: HasListener): boolean {
  return hasListener(element) && isOneControl(element, hasListener);
}

/**
 * A tab stop marks an element as clickable only when the element is one
 * control. Sites also give a tab stop to scrollable regions, such as code
 * blocks, so the keyboard can scroll them.
 */
function isOwnTabStop(element: Element, hasListener: HasListener): boolean {
  return hasTabStop(element) && !isScrollRegion(element) && isOneControl(element, hasListener);
}

/** The signals an element shows on its own, leaving out the inherited pointer cursor. */
function ownSignals(element: Element, hasListener: HasListener): ClickSignal[] {
  const signals: ClickSignal[] = [];
  if (isNative(element)) signals.push('native');
  const role = roleOf(element);
  if (role && CLICKABLE_ROLES.has(role)) signals.push('role');
  if (isOwnTabStop(element, hasListener)) signals.push('tabindex');
  if (isOwnListener(element, hasListener)) signals.push('listener');
  return signals;
}

/**
 * The clickable element a click on `start` would reach, or null if the click
 * would land on nothing clickable. A pointer cursor is inherited, so a run of
 * ancestors that all show it counts as one control, named by the outermost.
 */
export function closestClickable(start: Element, hasListener: HasListener): Clickable | null {
  for (let node: Element | null = start; node; node = parentOf(node)) {
    if (OPAQUE_TAGS.has(tagOf(node))) return { element: node, kind: 'opaque', signals: [] };
    const signals = ownSignals(node, hasListener);
    const pointer = hasPointerCursor(node);
    if (signals.length > 0) {
      if (pointer) signals.push('cursor');
      return { element: node, kind: 'control', signals };
    }
    if (pointer) {
      const parent = parentOf(node);
      if (!parent || !hasPointerCursor(parent)) {
        return { element: node, kind: 'control', signals: ['cursor'] };
      }
    }
  }
  return null;
}

export function isDisabled(element: Element): boolean {
  if (element.matches(':disabled')) return true;
  return element.closest('[aria-disabled="true"]') !== null;
}
