// Short descriptions of elements for the log. A label is the page's own name
// for a control. These functions never read a field's value into the log, they
// skip text in editable regions, and they blank out anything that matches what
// is typed into a field on the page right now.
import type { Under } from '../../core/types';
import { roleOf, tagOf } from './clickable';

export const LABEL_MAX = 40;

/** Input types whose value is the developer's button text, not user input. */
const BUTTON_INPUT_TYPES = new Set(['submit', 'button', 'reset']);

/** Typed text shorter than this is not searched for, since it would match everywhere. */
const MIN_TYPED = 3;

/** A run of this many characters shared with typed text is treated as an echo of it. */
const ECHO_WINDOW = 6;

/** How many fields are checked for typed text, and how much of each. */
const MAX_FIELDS = 60;
const MAX_TYPED = 500;

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** True for an element that holds user input. */
function isField(element: Element): boolean {
  const tag = tagOf(element);
  if (tag === 'input') return !BUTTON_INPUT_TYPES.has((element as HTMLInputElement).type);
  if (tag === 'textarea' || tag === 'select') return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * True for a text node the user may have typed: text in an editable region, or
 * text shown with a text cursor, which is how code editors render what you type.
 */
function isUserText(node: Node): boolean {
  const parent = node.parentElement;
  if (!parent || parent.isContentEditable || tagOf(parent) === 'textarea') return true;
  return getComputedStyle(parent).cursor === 'text';
}

/** The first page-authored text under a node, read only as far as the label needs. */
function pageText(root: Node, deep: boolean): string {
  let text = '';
  if (deep) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (text.length < LABEL_MAX * 2 && walker.nextNode()) {
      if (!isUserText(walker.currentNode)) text += `${walker.currentNode.nodeValue ?? ''} `;
    }
  } else {
    for (const child of root.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && !isUserText(child)) {
        text += `${child.nodeValue ?? ''} `;
      }
    }
  }
  return squash(text);
}

function attribute(element: Element, name: string): string {
  return squash(element.getAttribute(name) ?? '');
}

/**
 * What is typed into the page's inputs and text areas right now. It is used
 * only to blank the same text out of labels and is never stored. Pages often
 * echo a field into a control, such as a button that reads "Search for ...".
 */
export function typedText(): string[] {
  const typed = new Set<string>();
  const fields = document.querySelectorAll('input, textarea');
  for (const field of [...fields].slice(0, MAX_FIELDS)) {
    if (!isField(field)) continue;
    const value = (field as HTMLInputElement | HTMLTextAreaElement).value;
    const text = squash(value).toLowerCase().slice(0, MAX_TYPED);
    if (text.length >= MIN_TYPED) typed.add(text);
  }
  return [...typed];
}

export interface Label {
  text: string;
  /** Part of the text matched something typed into a field and was blanked. */
  redacted: boolean;
}

/** Blanks any run a label shares with typed text, then cuts the label to length. */
function finish(label: string, typed: string[]): Label {
  const lower = label.toLowerCase();
  const hide = new Array<boolean>(label.length).fill(false);
  for (const text of typed) {
    const size = Math.min(ECHO_WINDOW, text.length);
    for (let at = 0; at + size <= lower.length; at++) {
      if (text.includes(lower.slice(at, at + size))) hide.fill(true, at, at + size);
    }
  }
  if (!hide.includes(true)) return { text: label.slice(0, LABEL_MAX), redacted: false };
  let out = '';
  for (let i = 0; i < label.length; i++) {
    if (!hide[i]) out += label[i];
    else if (!hide[i - 1]) out += '…';
  }
  return { text: out.slice(0, LABEL_MAX), redacted: true };
}

function rawLabel(element: Element): string {
  const named = attribute(element, 'aria-label') || attribute(element, 'title');
  if (named) return named;
  if (isField(element)) {
    const label = (element as Partial<HTMLInputElement>).labels?.[0];
    return (
      (label ? pageText(label, true) : '') ||
      attribute(element, 'placeholder') ||
      attribute(element, 'name')
    );
  }
  if (element instanceof HTMLInputElement) return squash(element.value);
  const text = pageText(element, true);
  if (text) return text;
  const image = element.querySelector('img[alt], svg[aria-label]');
  return image ? attribute(image, 'alt') || attribute(image, 'aria-label') : '';
}

/**
 * A short name for a control. For a field this is its label or placeholder and
 * never what the user typed. A password field is always just "password field".
 */
export function labelOf(element: Element, typed: string[]): Label {
  if (element instanceof HTMLInputElement && element.type === 'password') {
    return { text: 'password field', redacted: false };
  }
  return finish(rawLabel(element), typed);
}

/** What was under the pointer at an empty-space click. */
export function describeUnder(element: Element, typed: string[]): Under {
  return {
    tag: tagOf(element),
    role: roleOf(element),
    label: finish(pageText(element, false), typed).text,
  };
}
