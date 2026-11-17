// Short descriptions of elements for the log. These never read what the user
// typed: not a field's value, and not text inside an editable region.
import type { Under } from '../../core/types';
import { roleOf, tagOf } from './clickable';

export const LABEL_MAX = 40;

/** Input types whose value is the developer's button text, not user input. */
const BUTTON_INPUT_TYPES = new Set(['submit', 'button', 'reset']);

function clip(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
}

/** True for a text node the user may have typed. */
function isUserText(node: Node): boolean {
  const parent = node.parentElement;
  return !parent || parent.isContentEditable || tagOf(parent) === 'textarea';
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
  return clip(text);
}

function attribute(element: Element, name: string): string {
  return clip(element.getAttribute(name) ?? '');
}

/** True for an element that holds user input. */
function isField(element: Element): boolean {
  const tag = tagOf(element);
  if (tag === 'input') return !BUTTON_INPUT_TYPES.has((element as HTMLInputElement).type);
  if (tag === 'textarea' || tag === 'select') return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * A short name for a control. For a field this is its label or placeholder and
 * never what the user typed. A password field is always just "password field".
 */
export function labelOf(element: Element): string {
  if (element instanceof HTMLInputElement && element.type === 'password') return 'password field';
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
  if (element instanceof HTMLInputElement) return clip(element.value);
  const text = pageText(element, true);
  if (text) return text;
  const image = element.querySelector('img[alt], svg[aria-label]');
  return image ? attribute(image, 'alt') || attribute(image, 'aria-label') : '';
}

/** What was under the pointer at an empty-space click. */
export function describeUnder(element: Element): Under {
  return { tag: tagOf(element), role: roleOf(element), label: pageText(element, false) };
}
