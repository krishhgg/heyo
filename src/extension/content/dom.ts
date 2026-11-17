// DOM helpers that see through shadow roots and slots.

/**
 * The shadow root of an element, open or closed. Chrome lets a content script
 * read a closed root through an extension API, but the call is slow, so only
 * custom elements are asked. Their names have a hyphen. A closed root on a
 * plain element such as a div is not seen.
 */
export function shadowRootOf(element: Element): ShadowRoot | null {
  if (element.shadowRoot) return element.shadowRoot;
  if (!(element instanceof HTMLElement) || !element.localName.includes('-')) return null;
  try {
    return chrome.dom.openOrClosedShadowRoot(element);
  } catch {
    return null;
  }
}

/**
 * The slot an element is assigned to. `assignedSlot` is null for a slot inside
 * a closed shadow root, so that case is looked up through the host's root.
 */
function slotOf(element: Element): HTMLSlotElement | null {
  if (element.assignedSlot) return element.assignedSlot;
  const host = element.parentElement;
  if (!host || host.shadowRoot) return null;
  const root = shadowRootOf(host);
  if (!root) return null;
  for (const slot of root.querySelectorAll('slot')) {
    if (slot.assignedElements().includes(element)) return slot;
  }
  return null;
}

/**
 * The parent in the flat tree, which is the tree the user sees. A slotted
 * element's parent is its slot, and a shadow root's child's parent is the host.
 */
export function parentOf(element: Element): Element | null {
  const slot = slotOf(element);
  if (slot) return slot;
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/**
 * The children of a node in the flat tree, the one the user sees. A slot's
 * children are the nodes assigned to it, and a host's children are its shadow
 * root's.
 */
export function flatChildren(node: Node): Node[] {
  if (node instanceof HTMLSlotElement) {
    const assigned = node.assignedNodes({ flatten: true });
    if (assigned.length > 0) return assigned;
  }
  const root = node instanceof Element ? shadowRootOf(node) : null;
  return [...(root ?? node).childNodes];
}

/** Follows shadow roots down from an element to the deepest element at a point. */
export function deepestAt(start: Element, x: number, y: number): Element {
  let element = start;
  for (;;) {
    const inner = shadowRootOf(element)?.elementFromPoint(x, y);
    if (!inner || inner === element) return element;
    element = inner;
  }
}

/** The topmost element at a point, looking inside shadow roots. */
export function elementAt(x: number, y: number): Element | null {
  const top = document.elementFromPoint(x, y);
  return top ? deepestAt(top, x, y) : null;
}

/** The search for shadow roots stops after this long, to bound its cost on a huge page. */
const ROOT_SEARCH_MS = 8;

/** How many elements the search visits between looks at the clock. */
const CLOCK_EVERY = 512;

/**
 * The shadow roots in the document, nested ones included. On a page too large
 * to search within the time limit it returns the ones found so far.
 */
export function allShadowRoots(): ShadowRoot[] {
  const found: ShadowRoot[] = [];
  const trees: (Document | ShadowRoot)[] = [document];
  const deadline = performance.now() + ROOT_SEARCH_MS;
  let visited = 0;
  for (let tree = trees.pop(); tree; tree = trees.pop()) {
    const walker = document.createTreeWalker(tree, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      if (++visited % CLOCK_EVERY === 0 && performance.now() > deadline) return found;
      const root = shadowRootOf(walker.currentNode as Element);
      if (root) {
        found.push(root);
        trees.push(root);
      }
    }
  }
  return found;
}
