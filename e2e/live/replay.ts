// Shared steps for the per-site replay tests. Each test loads a real page with
// retargeting on, misses one control by a few px with real pointer input, and
// checks that the intended action happened exactly once.
import type { Locator, Page, Worker } from '@playwright/test';
import type { ClickRecord } from '../../src/core/types';
import { arrive } from '../helpers/log';
import { turnOnRetargeting } from '../helpers/retarget';

/** Px between the control's edge and the near miss. */
const MISS_PX = 4;

/** Long enough for heyo to send the click on and for the page to act on it. */
const ACT_MS = 1500;

export async function allow(worker: Worker, host: string): Promise<void> {
  await turnOnRetargeting(worker, { hosts: [host] });
}

async function recordsFor(worker: Worker, host: string): Promise<ClickRecord[]> {
  const log = await worker.evaluate(() => heyo.exportLog());
  return log.records.filter((r) => r.site === host);
}

/**
 * Clicks just outside a control, on each side in turn, until heyo sends the
 * click on to that control. Returns the record of that click. Throws if heyo
 * sends a click on to anything else, and if no side gives a clean near miss,
 * which means the control cannot be tested this way.
 */
export async function missAndSend(
  page: Page,
  worker: Worker,
  control: Locator,
  label: RegExp,
): Promise<ClickRecord> {
  const host = new URL(page.url()).hostname;
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  if (!box) throw new Error('The control has no box.');
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const sides = [
    { x: box.x + box.width + MISS_PX, y: middle.y },
    { x: box.x - MISS_PX, y: middle.y },
    { x: middle.x, y: box.y + box.height + MISS_PX },
    { x: middle.x, y: box.y - MISS_PX },
  ];
  const seen: string[] = [];
  for (const point of sides) {
    const before = (await recordsFor(worker, host)).length;
    await arrive(page, point.x, point.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(ACT_MS);
    const record = (await recordsFor(worker, host)).slice(before).at(-1);
    const picked =
      record?.decision.action === 'retarget'
        ? record.features.candidates[record.decision.candidate]
        : undefined;
    if (record?.fire?.outcome === 'sent') {
      if (picked && label.test(picked.label)) return record;
      // A click sent on to something else is a wrong click on a real site, not a side to skip.
      throw new Error(
        `heyo sent the click on to "${picked?.label ?? ''}", not the control under test.`,
      );
    }
    seen.push(
      record
        ? `${JSON.stringify(record.decision)} fire ${JSON.stringify(record.fire ?? null)}`
        : 'not an empty-space click',
    );
  }
  throw new Error(`No side of the control gave a near miss heyo acted on: ${seen.join(' | ')}`);
}
