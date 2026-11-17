// Asks the main-world script whether the page put a click-type listener on a node.
import { INIT_EVENT, READY_EVENT } from '../bridge';

const queryEvent = `heyo:${crypto.randomUUID()}`;

function sendInit(): void {
  window.dispatchEvent(new CustomEvent(INIT_EVENT, { detail: queryEvent }));
}

/** Hands the query event name to the main-world script, whichever of the two ran first. */
export function connectListeners(): void {
  window.addEventListener(READY_EVENT, sendInit, { capture: true, once: true });
  sendInit();
}

/**
 * True when the page registered a click-type listener on the node. The
 * main-world script cancels the query event to say yes. Without that script
 * nothing cancels it, and the answer is no.
 */
export function hasListener(node: EventTarget): boolean {
  return !node.dispatchEvent(new Event(queryEvent, { cancelable: true, composed: true }));
}
