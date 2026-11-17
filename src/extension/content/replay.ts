// Sends a click on to a control. The user's real click has already landed on
// empty space and the page has ignored it. This dispatches the pointer and
// mouse events of one click on the control the decision picked.
import type { Point } from '../../core/geometry';
import { nearestPointInRect } from '../../core/geometry';
import type { Candidate, Fire } from '../../core/types';
import { boxOf } from './candidates';
import { isDisabled, tagOf } from './clickable';
import { allShadowRoots, elementAt, isWithin, parentOf } from './dom';
import { reacted, ReactionWatch } from './reaction';

/**
 * The page gets this long to show a reaction to the click heyo sent. It is
 * longer than the 50 ms given to the user's own click, because this number only
 * feeds the share of sent clicks that pages ignore, and many handlers answer
 * after a short wait of their own.
 */
const SETTLE_MS = 400;

/** The control must still be within this many px of where it was logged. */
const MOVED_PX = 2;

/** The click lands this far inside the control's edge, or at its middle if it is smaller. */
const INSET_PX = 3;

function failed(failure: NonNullable<Fire['failure']>): Fire {
  return { outcome: 'failed', failure };
}

/** A point just inside a box, as near the original click as it can be. */
function pointInside(box: { x: number; y: number; w: number; h: number }, click: Point): Point {
  const insetX = Math.min(INSET_PX, box.w / 2);
  const insetY = Math.min(INSET_PX, box.h / 2);
  const inner = {
    x: box.x + insetX,
    y: box.y + insetY,
    w: box.w - 2 * insetX,
    h: box.h - 2 * insetY,
  };
  return nearestPointInRect(click, inner);
}

function fire(target: Element, type: string, at: Point, buttons: number): boolean {
  const init: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    detail: type === 'pointerdown' || type === 'pointerup' ? 0 : 1,
    clientX: at.x,
    clientY: at.y,
    screenX: window.screenX + at.x,
    screenY: window.screenY + at.y,
    button: 0,
    buttons,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };
  const event = type.startsWith('mouse')
    ? new MouseEvent(type, init)
    : new PointerEvent(type, init);
  return target.dispatchEvent(event);
}

/** The nearest element from `from` up to `control` that takes keyboard focus. */
function focusable(from: Element, control: Element): HTMLElement | null {
  for (let node: Element | null = from; node; node = parentOf(node)) {
    if (node instanceof HTMLElement && node.tabIndex >= 0) return node;
    if (node === control) break;
  }
  return null;
}

/** True for a checkbox or radio button, whose click changes a property and not the DOM. */
function checkedOf(control: Element): boolean | null {
  return control instanceof HTMLInputElement ? control.checked : null;
}

/**
 * Sends one click on to `control`, the element behind `candidate`, for a user
 * click that landed at `click`. Calls `report` once with what happened: at
 * once if nothing could be sent, otherwise after the page has had time to
 * react or when it unloads. It sends nothing if the control is gone, has
 * moved, is covered by something else, or is disabled.
 */
export function sendClick(
  control: Element,
  candidate: Candidate,
  click: Point,
  report: (fire: Fire) => void,
): void {
  if (!control.isConnected || isDisabled(control)) return report(failed('gone'));
  const box = boxOf(control, control, click.x, click.y);
  if (!box) return report(failed('gone'));
  const moved =
    Math.abs(box.rect.x - candidate.rect.x) > MOVED_PX ||
    Math.abs(box.rect.y - candidate.rect.y) > MOVED_PX;
  if (moved) return report(failed('moved'));

  // The box is relative to the click point. The events need viewport coordinates.
  const at = pointInside(
    { x: click.x + box.rect.x, y: click.y + box.rect.y, w: box.rect.w, h: box.rect.h },
    click,
  );
  const top = elementAt(at.x, at.y);
  if (!top || !isWithin(top, control)) return report(failed('covered'));

  const watch = new ReactionWatch([top], [control], allShadowRoots());
  const checkedBefore = checkedOf(control);
  // A link that opens a new tab or a popup takes focus away from this window.
  let leftWindow = false;
  const onBlur = (event: FocusEvent) => {
    if (event.target === window) leftWindow = true;
  };
  let done = false;
  const finish = (unloading: boolean, opened = false) => {
    if (done) return;
    done = true;
    window.removeEventListener('blur', onBlur, true);
    window.removeEventListener('pagehide', onPageHide, true);
    const reaction = watch.stop(unloading);
    const changed = checkedOf(control) !== checkedBefore;
    report({ outcome: 'sent', reacted: reacted(reaction) || changed || leftWindow || opened });
  };
  // A page that unloads has reacted by navigating, and its timers never fire.
  const onPageHide = () => finish(true);
  window.addEventListener('blur', onBlur, true);
  window.addEventListener('pagehide', onPageHide, true);

  // A native dropdown opens only for real input. Chrome offers showPicker for the same effect.
  if (tagOf(control) === 'select') {
    const select = control as HTMLSelectElement;
    select.focus({ preventScroll: true });
    try {
      select.showPicker();
    } catch {
      done = true;
      watch.stop();
      window.removeEventListener('blur', onBlur, true);
      window.removeEventListener('pagehide', onPageHide, true);
      return report(failed('unsupported'));
    }
    window.setTimeout(() => finish(false, true), SETTLE_MS);
    return;
  }

  const pressed = fire(top, 'pointerdown', at, 1);
  // As for a real press, a page that cancels pointerdown gets no mouse events and no focus.
  const mouseDown = pressed && fire(top, 'mousedown', at, 1);
  if (mouseDown) focusable(top, control)?.focus({ preventScroll: true });
  fire(top, 'pointerup', at, 0);
  if (pressed) fire(top, 'mouseup', at, 0);
  fire(top, 'click', at, 0);
  window.setTimeout(() => finish(false), SETTLE_MS);
}
