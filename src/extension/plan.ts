// Decides what retargeting does about one logged click.
import type { ClickRecord } from '../core/types';
import { isAllowed } from './allowlist';
import type { Settings } from './settings';

export type FirePlan = 'log' | 'hold' | 'send';

/**
 * What to do about a logged click: only log it, hold it back as a control, or
 * send it on. Retargeting acts only when it is on, the site is allowed, the
 * click was in the top frame and the decision picked a target. One fire in ten
 * is held back, so the user's own retry keeps measuring recovery. `roll` is a
 * random number in [0, 1).
 */
export function planFire(
  settings: Settings,
  site: string,
  record: ClickRecord,
  roll: number,
): FirePlan {
  const on = settings.mode === 'retarget' && isAllowed(site, settings.allowlist);
  if (!on || !record.features.topFrame || record.decision.action !== 'retarget') return 'log';
  return roll < settings.heldShare ? 'hold' : 'send';
}
