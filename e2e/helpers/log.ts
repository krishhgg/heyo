import type { Page, Worker } from '@playwright/test';
import type { ClickRecord, LogExport } from '../../src/core/types';

/** Longer than the 50 ms the content script waits for a page reaction. */
const SETTLE_MS = 120;

export function readLog(worker: Worker): Promise<LogExport> {
  return worker.evaluate(() => heyo.exportLog());
}

/** Moves the mouse to a point along a straight path, the way a hand would arrive. */
export async function arrive(page: Page, x: number, y: number, from = { x: x - 160, y: y + 90 }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.move(x, y, { steps: 8 });
}

/** A real mouse click at a point, then a wait for the content script to log it. */
export async function clickAt(page: Page, x: number, y: number) {
  await arrive(page, x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(SETTLE_MS);
}

/** Clicks at a point and returns the one record that click produced. */
export async function recordOf(
  page: Page,
  worker: Worker,
  x: number,
  y: number,
): Promise<ClickRecord> {
  const before = (await readLog(worker)).records.length;
  await clickAt(page, x, y);
  const records = (await readLog(worker)).records;
  if (records.length !== before + 1) {
    throw new Error(`expected one new record, got ${records.length - before}`);
  }
  return records[records.length - 1]!;
}
