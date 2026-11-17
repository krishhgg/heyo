// DOM helpers that see through shadow roots and slots.

/** The shadow root of an element, open or closed. */
export function shadowRootOf(element: Element): ShadowRoot | null {
  if (element.shadowRoot) return element.shadowRoot;
  if (!(element instanceof HTMLElement)) return null;
  try {
    // Content scripts may read closed roots through this extension API.
    return chrome.dom.openOrClosedShadowRoot(element);
  } catch {
    return null;
  }
}

/**
 * The parent in the flat tree, which is the tree the user sees. A slotted
 * element's parent is its slot, and a shadow root's child's parent is the host.
 */
export function parentOf(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
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
      const element = walker.currentNode as Element;
      // Asking the extension API about every element is slow. Only custom
      // elements, whose names have a hyphen, are asked about a closed root.
      const root =
        element.shadowRoot ?? (element.localName.includes('-') ? shadowRootOf(element) : null);
      if (root) {
        found.push(root);
        trees.push(root);
      }
    }
  }
  return found;
}
