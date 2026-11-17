// Tells the fields a user types into from the other controls.
import { shadowRootOf } from './dom';

/** Input types that are buttons, toggles or pickers, not text the user types. */
const NON_TEXT_INPUT_TYPES = new Set([
  'hidden',
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

/** ARIA roles for an element the user types into, whatever it is built from. */
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox']);
export const FIELD_ROLE_SELECTOR = [...FIELD_ROLES].map((role) => `[role~="${role}"]`).join(',');

/** Matches every element that may hold typed text. Check each match with the functions below. */
export const FIELD_SELECTOR = `input, textarea, [contenteditable], ${FIELD_ROLE_SELECTOR}`;

/** True for an input or text area whose value is text the user typed. */
export function isTextInput(element: unknown): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return true;
  return element instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(element.type);
}

/** True for an element whose text content, not a value, is what the user typed. */
export function isEditableRegion(element: unknown): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const role = element.getAttribute('role')?.trim().split(/\s+/)[0]?.toLowerCase();
  return element.isContentEditable || FIELD_ROLES.has(role ?? '');
}

/** True for an element the user types or picks a value in. */
export function isTextField(element: unknown): boolean {
  return isTextInput(element) || element instanceof HTMLSelectElement || isEditableRegion(element);
}

/** The focused element, looking inside shadow roots, open or closed. */
export function deepActiveElement(): Element | null {
  let active = document.activeElement;
  for (;;) {
    const inner: Element | null | undefined = active && shadowRootOf(active)?.activeElement;
    if (!inner) return active;
    active = inner;
  }
}
