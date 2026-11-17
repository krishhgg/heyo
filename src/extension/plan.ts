// Decides what retargeting does about one logged click.
import type { ClickRecord } from '../core/types';
import { heldShareOf, sitesOf, type Settings } from './settings';
import { decisionVersion } from './version';

export type FirePlan = 'log' | 'hold' | 'send';

/**
 * True when retargeting is on, the gates passed with the decision this code
 * carries, and the site is one where it may act.
 */
export function mayAct(settings: Settings, site: string): boolean {
  return (
    settings.mode === 'retarget' &&
    settings.gatedWith === decisionVersion &&
    sitesOf(settings).includes(site)
  );
}

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
  if (!mayAct(settings, site)) return 'log';
  if (!record.features.topFrame || record.decision.action !== 'retarget') return 'log';
  return roll < heldShareOf(settings) ? 'hold' : 'send';
}
