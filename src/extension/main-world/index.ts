// Runs in the page's own JavaScript world, before any page script. It records
// which nodes get a click-type listener, and answers the content script's
// question "does this node have one?".
import { CLICK_TYPES, INIT_EVENT, READY_EVENT } from '../bridge';

const clickTypes = new Set<unknown>(CLICK_TYPES);
const handlerProperties = CLICK_TYPES.map((type) => `on${type}`);

/** Nodes that have had a click-type listener added. A removed listener is not forgotten. */
const listened = new WeakSet<object>();

// Called only through Reflect.apply with an explicit target.
// eslint-disable-next-line @typescript-eslint/unbound-method
const nativeAdd = EventTarget.prototype.addEventListener;

/** Adds heyo's own listener without recording it. */
function listen(type: string, listener: (event: Event) => void, options: AddEventListenerOptions) {
  Reflect.apply(nativeAdd, window, [type, listener, options]);
}

// A Proxy keeps the function's name and length, and it still prints as native
// code. A page that compares the printed text with a real native function can
// tell the difference, because a Proxy prints without its name.
EventTarget.prototype.addEventListener = new Proxy(nativeAdd, {
  apply(target, thisArg: object | undefined, args: unknown[]) {
    try {
      if (clickTypes.has(args[0]) && args[1] != null) listened.add(thisArg ?? window);
    } catch {
      // Recording must never break the page's own call.
    }
    return Reflect.apply(target, thisArg, args) as unknown;
  },
});

function hasClickListener(node: EventTarget | undefined): boolean {
  if (!node) return false;
  if (listened.has(node)) return true;
  const handlers = node as unknown as Record<string, unknown>;
  return handlerProperties.some((property) => typeof handlers[property] === 'function');
}

/** Answers a query by cancelling the event. The page never sees it. */
function onQuery(event: Event): void {
  event.stopImmediatePropagation();
  if (hasClickListener(event.composedPath()[0])) event.preventDefault();
}

function onInit(event: Event): void {
  event.stopImmediatePropagation();
  const name: unknown = (event as CustomEvent).detail;
  if (typeof name === 'string') listen(name, onQuery, { capture: true });
}

listen(INIT_EVENT, onInit, { capture: true, once: true });
window.dispatchEvent(new Event(READY_EVENT));
