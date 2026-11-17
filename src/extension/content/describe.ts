// Short descriptions of elements for the log. A label is the page's own name
// for a control. These functions never read a field's value into the log, they
// skip text in editable regions, and they blank out anything that matches what
// is typed into a field on the page right now.
import type { Under } from '../../core/types';
import { roleOf, tagOf } from './clickable';
import { flatChildren } from './dom';
import {
  deepActiveElement,
  FIELD_ROLE_SELECTOR,
  FIELD_SELECTOR,
  isEditableRegion,
  isTextField,
  isTextInput,
} from './fields';

export const LABEL_MAX = 40;

/** Input types whose value is the developer's button text, not user input. */
const BUTTON_INPUT_TYPES = new Set(['submit', 'button', 'reset']);

/** Typed text shorter than this is not searched for, since it would match everywhere. */
const MIN_TYPED = 3;

/** A run of this many characters shared with typed text is treated as an echo of it. */
const ECHO_WINDOW = 6;

/** A typed value of at most this many words is short enough for its single words to count as echoes. */
const SHORT_VALUE_WORDS = 3;

/** How many fields are checked for typed text, and how much of each. */
const MAX_FIELDS = 300;
const MAX_TYPED = 20_000;

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * True for a text node the user may have typed: text in an editable region, or
 * text shown with a text cursor, which is how code editors render what you type.
 */
function isUserText(node: Node): boolean {
  const parent = node.parentElement;
  if (!parent || parent.isContentEditable || tagOf(parent) === 'textarea') return true;
  if (parent.closest(FIELD_ROLE_SELECTOR)) return true;
  return getComputedStyle(parent).cursor === 'text';
}

/** Elements whose text is code or styling, never a label. */
const SILENT_TAGS = new Set(['style', 'script', 'template', 'noscript']);

/** Appends page-authored text under a node, in the order the user sees it, until there is enough. */
function collectText(node: Node, deep: boolean, out: string[]): void {
  for (const child of flatChildren(node)) {
    if (out.join('').length >= LABEL_MAX * 2) return;
    if (child.nodeType === Node.TEXT_NODE) {
      if (!isUserText(child)) out.push(`${child.nodeValue ?? ''} `);
    } else if (deep && child instanceof Element && !SILENT_TAGS.has(tagOf(child))) {
      collectText(child, deep, out);
    }
  }
}

/**
 * The first page-authored text under a node, read only as far as the label
 * needs. It follows the tree the user sees, so text slotted into a web
 * component or kept in its shadow root is found.
 */
function pageText(root: Node, deep: boolean): string {
  const out: string[] = [];
  collectText(root, deep, out);
  return squash(out.join(''));
}

function attribute(element: Element, name: string): string {
  return squash(element.getAttribute(name) ?? '');
}

/**
 * What is typed into the page's fields right now, in the document and in the
 * given shadow roots. It is used only to blank the same text out of labels and
 * is never stored. Pages often echo a field into a control, such as a button
 * that reads "Search for ...".
 */
export function typedText(roots: ShadowRoot[]): Typed {
  const texts = new Set<string>();
  let complete = true;
  const add = (value: string) => {
    // Past the limit the check cannot cover the field, and no label can be trusted.
    if (value.length > MAX_TYPED) complete = false;
    const text = squash(value.slice(0, MAX_TYPED)).toLowerCase();
    if (text.length >= MIN_TYPED) texts.add(text);
  };
  const read = (element: Element | null): boolean => {
    if (isTextInput(element)) add(element.value);
    else if (isEditableRegion(element)) add(element.textContent ?? '');
    else return false;
    return true;
  };
  // Only fields the user types in count toward the limit. A page can hold
  // hundreds of hidden inputs, checkboxes and radio buttons.
  let fields = 0;
  for (const tree of [document, ...roots]) {
    for (const element of tree.querySelectorAll(FIELD_SELECTOR)) {
      if (fields >= MAX_FIELDS) {
        complete = false;
        break;
      }
      if (read(element)) fields++;
    }
  }
  // The focused field is read even when it lies past the limit.
  read(deepActiveElement());
  return { texts: [...texts], complete };
}

/** What is typed into the page's fields right now. */
export interface Typed {
  texts: string[];
  /**
   * False when a field was too long to check in full, or there were more
   * fields than the limit. Labels are then blanked whole, because an echo
   * could have slipped past the check.
   */
  complete: boolean;
}

export interface Label {
  text: string;
  /** Part of the text matched something typed into a field and was blanked. */
  redacted: boolean;
}

/**
 * Blanks what a label shares with typed text, then cuts the label to length.
 * Any run of 6 characters counts. So does a whole word of 3 or more characters
 * from a short typed value, such as a first name out of "Ana Lopez". Words out
 * of long typed prose are too ordinary to be an echo.
 */
function finish(label: string, typed: Typed): Label {
  if (!typed.complete) return { text: label === '' ? '' : '…', redacted: label !== '' };
  const lower = label.toLowerCase();
  const hide = new Array<boolean>(label.length).fill(false);
  for (const text of typed.texts) {
    const size = Math.min(ECHO_WINDOW, text.length);
    for (let at = 0; at + size <= lower.length; at++) {
      if (text.includes(lower.slice(at, at + size))) hide.fill(true, at, at + size);
    }
    const words = text.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= MIN_TYPED);
    if (words.length === 0 || words.length > SHORT_VALUE_WORDS) continue;
    for (const match of lower.matchAll(/[\p{L}\p{N}]+/gu)) {
      if (words.includes(match[0])) hide.fill(true, match.index, match.index + match[0].length);
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
  const tag = tagOf(element);
  // A button input's value is the developer's label for it.
  if (element instanceof HTMLInputElement && BUTTON_INPUT_TYPES.has(element.type)) {
    return squash(element.value);
  }
  // Any other form control or field is named by its label, never by what it holds.
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || isTextField(element)) {
    const label = (element as Partial<HTMLInputElement>).labels?.[0];
    return (
      (label ? pageText(label, true) : '') ||
      attribute(element, 'placeholder') ||
      attribute(element, 'name')
    );
  }
  const text = pageText(element, true);
  if (text) return text;
  const image = element.querySelector('img[alt], svg[aria-label]');
  return image ? attribute(image, 'alt') || attribute(image, 'aria-label') : '';
}

/**
 * A short name for a control. For a field this is its label or placeholder and
 * never what the user typed. A password field is always just "password field".
 */
export function labelOf(element: Element, typed: Typed): Label {
  if (element instanceof HTMLInputElement && element.type === 'password') {
    return { text: 'password field', redacted: false };
  }
  return finish(rawLabel(element), typed);
}

/** What was under the pointer at an empty-space click. */
export function describeUnder(element: Element, typed: Typed): Under {
  return {
    tag: tagOf(element),
    role: roleOf(element),
    label: finish(pageText(element, false), typed).text,
  };
}
