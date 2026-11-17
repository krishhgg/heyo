// Runs in the page's own JavaScript world, before any page script. It records
// which nodes get a click-type listener, and answers the content script's
// question "does this node have one?".
import { CLICK_TYPES, INIT_EVENT, READY_EVENT } from '../bridge';

// The page can replace or patch any built-in later. Everything the wrapper
// needs is taken now, before page code runs, so the page cannot break it.
const apply = Reflect.apply;
// eslint-disable-next-line @typescript-eslint/unbound-method
const { add: weakAdd, has: weakHas } = WeakSet.prototype;
// eslint-disable-next-line @typescript-eslint/unbound-method
const { has: setHas } = Set.prototype;
// eslint-disable-next-line @typescript-eslint/unbound-method
const nativeAdd = EventTarget.prototype.addEventListener;

const clickTypes = new Set<unknown>(CLICK_TYPES);
const handlerProperties = CLICK_TYPES.map((type) => `on${type}`);

/** Nodes that have had a click-type listener added. A removed listener is not forgotten. */
const listened = new WeakSet<object>();

/** Adds heyo's own listener without recording it. */
function listen(type: string, listener: (event: Event) => void, options: AddEventListenerOptions) {
  apply(nativeAdd, window, [type, listener, options]);
}

// A Proxy keeps the function's name and length, and it still prints as native
// code. A page that compares the printed text with a real native function can
// tell the difference, because a Proxy prints without its name.
EventTarget.prototype.addEventListener = new Proxy(nativeAdd, {
  apply(target, thisArg: object | undefined, args: unknown[]) {
    try {
      if (apply(setHas, clickTypes, [args[0]]) && args[1] != null) {
        apply(weakAdd, listened, [thisArg ?? window]);
      }
    } catch {
      // Recording must never break the page's own call.
    }
    return apply(target, thisArg, args) as unknown;
  },
});

function hasClickListener(node: EventTarget | undefined): boolean {
  if (!node) return false;
  if (apply(weakHas, listened, [node])) return true;
  const handlers = node as unknown as Record<string, unknown>;
  for (const property of handlerProperties) {
    if (typeof handlers[property] === 'function') return true;
  }
  return false;
}

/** Answers a query by cancelling the event. The page never sees it. */
function onQuery(event: Event): void {
  event.stopImmediatePropagation();
  if (hasClickListener(event.composedPath()[0])) event.preventDefault();
}

/** Takes the query event name, and cancels the event to tell the content script it arrived. */
function onInit(event: Event): void {
  event.stopImmediatePropagation();
  event.preventDefault();
  const name: unknown = (event as CustomEvent).detail;
  if (typeof name === 'string') listen(name, onQuery, { capture: true });
}

listen(INIT_EVENT, onInit, { capture: true, once: true });
window.dispatchEvent(new Event(READY_EVENT));
