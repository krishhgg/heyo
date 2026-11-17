// Asks the main-world script whether the page put a click-type listener on a node.
import { INIT_EVENT, READY_EVENT } from '../bridge';
import { uuid } from './uuid';

const queryEvent = `heyo:${uuid()}`;

/** Sends the query event name. True when the main-world script took it. */
function sendInit(): boolean {
  const init = new CustomEvent(INIT_EVENT, { detail: queryEvent, cancelable: true });
  return !window.dispatchEvent(init);
}

function onReady(): void {
  sendInit();
}

/**
 * Hands the query event name to the main-world script, whichever of the two
 * ran first. Once the name is taken nothing listens for the ready event, so a
 * page cannot ask for the name later.
 */
export function connectListeners(): void {
  if (!sendInit()) window.addEventListener(READY_EVENT, onReady, { capture: true, once: true });
}

/**
 * True when the page registered a click-type listener on the node. The
 * main-world script cancels the query event to say yes. Without that script
 * nothing cancels it, and the answer is no.
 */
export function hasListener(node: EventTarget): boolean {
  return !node.dispatchEvent(new Event(queryEvent, { cancelable: true, composed: true }));
}
