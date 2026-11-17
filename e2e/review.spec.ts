import { readFile } from 'node:fs/promises';
import type { Page, Worker } from '@playwright/test';
import type { LogExport } from '../src/core/types';
import { expect, test } from './helpers/fixtures';
import { clickAt, readLog } from './helpers/log';

/** Logs three would-be fires with real clicks on the capture fixture, then opens the review page. */
async function openReviewWithFires(page: Page, worker: Worker, extensionId: string) {
  await page.goto('/capture.html');
  await clickAt(page, 184, 116); // beside Save
  await clickAt(page, 184, 416); // beside the pointer-cursor card
  await clickAt(page, 384, 616); // beside the button in the shadow root
  await clickAt(page, 183, 216); // between Bold and Italic, which heyo refuses
  expect((await readLog(worker)).records).toHaveLength(4);
  await page.goto(`chrome-extension://${extensionId}/review.html`);
  await expect(page.locator('.plate')).toBeVisible();
}

test.describe('the review page', () => {
  test('shows each would-be fire and never a refused click', async ({
    page,
    worker,
    extensionId,
  }) => {
    await openReviewWithFires(page, worker, extensionId);

    await expect(page.getByRole('button', { name: /Review/ })).toContainText('3');
    await expect(page.locator('.progress-text')).toContainText('0 of 299 reviewed');
    await expect(page.locator('.progress-text')).toContainText('3 waiting');

    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      seen.push(await page.locator('.target').innerText());
      await page.keyboard.press('y');
      await expect(page.locator('.progress-text')).toContainText(`${i + 1} of 299 reviewed`);
      // Keys are ignored while the stamp shows, so a double tap cannot mark an unseen click.
      await expect(page.locator('.stamp')).toHaveCount(0);
    }
    expect(seen.sort()).toEqual(['Card', 'Inner', 'Save']);
    await expect(page.getByRole('heading', { name: 'All caught up' })).toBeVisible();
  });

  test('stores right, wrong and not sure marks from the keyboard', async ({
    page,
    worker,
    extensionId,
  }) => {
    await openReviewWithFires(page, worker, extensionId);

    const marked: Record<string, string> = {};
    for (const [key, verdict] of [
      ['y', 'right'],
      ['n', 'wrong'],
      ['u', 'unsure'],
    ] as const) {
      marked[await page.locator('.target').innerText()] = verdict;
      await page.keyboard.press(key);
      await expect(page.locator('.stamp')).toHaveCount(0);
    }
    await expect(page.locator('.progress-text')).toContainText('2 of 473 reviewed');
    await expect(page.locator('.progress-text')).toContainText('1 wrong');
    await expect(page.locator('.progress-text')).toContainText('1 not sure');

    const log = await readLog(worker);
    const byLabel = Object.fromEntries(
      log.reviews.map((review) => {
        const record = log.records.find((r) => r.id === review.recordId)!;
        return [record.features.candidates[review.candidate]!.label, review.verdict];
      }),
    );
    expect(byLabel).toEqual(marked);
  });

  test('lets the reviewer go back and change a mark', async ({ page, worker, extensionId }) => {
    await openReviewWithFires(page, worker, extensionId);

    const first = await page.locator('.target').innerText();
    await page.getByRole('button', { name: /No, wrong/ }).click();
    await expect(page.locator('.target')).not.toHaveText(first);

    await page.keyboard.press('z');
    await expect(page.locator('.target')).toHaveText(first);
    await expect(page.getByRole('button', { name: /No, wrong/ })).toHaveClass(/chosen/);

    await page.keyboard.press('y');
    await expect(page.locator('.progress-text')).toContainText('1 of 299 reviewed');
    await expect(page.locator('.progress-text')).toContainText('0 wrong');
  });

  test('keeps its place and its way back while the numbers are showing', async ({
    page,
    worker,
    extensionId,
  }) => {
    await openReviewWithFires(page, worker, extensionId);
    const first = await page.locator('.target').innerText();
    await page.keyboard.press('n');
    await expect(page.locator('.stamp')).toHaveCount(0);
    const second = await page.locator('.target').innerText();

    await page.getByRole('button', { name: 'Numbers' }).click();
    // A key pressed on the numbers page marks nothing.
    await page.keyboard.press('y');
    await page.getByRole('button', { name: /Review/ }).click();
    await expect(page.locator('.target')).toHaveText(second);
    expect((await readLog(worker)).reviews).toHaveLength(1);

    await page.keyboard.press('z');
    await expect(page.locator('.target')).toHaveText(first);
  });

  test('counts a changed mark once, as the store does', async ({ page, worker, extensionId }) => {
    await openReviewWithFires(page, worker, extensionId);
    await page.keyboard.press('n');
    await expect(page.locator('.stamp')).toHaveCount(0);
    await page.keyboard.press('z');
    await page.keyboard.press('y');
    await expect(page.locator('.stamp')).toHaveCount(0);

    await page.getByRole('button', { name: 'Numbers' }).click();
    await expect(page.locator('.log-size')).toContainText('1 review marks');
    expect((await readLog(worker)).reviews).toHaveLength(1);
  });

  test('ignores a double tap, also with reduced motion', async ({ page, worker, extensionId }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openReviewWithFires(page, worker, extensionId);
    await page.keyboard.press('y');
    await page.keyboard.press('y', { delay: 20 });
    await expect(page.locator('.stamp')).toHaveCount(0);
    await expect(page.locator('.progress-text')).toContainText('1 of 299 reviewed');
    expect((await readLog(worker)).reviews).toHaveLength(1);
  });

  test('keeps the click up when a mark cannot be stored', async ({ page, worker, extensionId }) => {
    await openReviewWithFires(page, worker, extensionId);
    const first = await page.locator('.target').innerText();
    // The next write to the store fails once, as it does when the disk is full.
    await page.evaluate(() => {
      // The method is put back on the same prototype, so it keeps its receiver.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });
    await page.keyboard.press('y');
    await expect(page.getByRole('alert')).toHaveText(/not saved/);
    await expect(page.locator('.stamp')).toHaveCount(0);
    await expect(page.locator('.target')).toHaveText(first);
    expect((await readLog(worker)).reviews).toHaveLength(0);

    await page.keyboard.press('y');
    await expect(page.locator('.target')).not.toHaveText(first);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await readLog(worker)).reviews).toHaveLength(1);
  });

  test('keeps the drawing and the buttons on screen in a small window', async ({
    page,
    worker,
    extensionId,
  }) => {
    await page.setViewportSize({ width: 800, height: 800 });
    await openReviewWithFires(page, worker, extensionId);
    await expect(page.locator('.plate')).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: /No, wrong/ })).toBeInViewport({ ratio: 1 });

    await page.getByRole('button', { name: /Yes, right/ }).click();
    await expect(page.locator('.stamp')).toHaveCount(0);
    await expect(page.locator('.plate')).toBeInViewport({ ratio: 1 });
  });

  test('says so when there is nothing to review', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/review.html`);
    await expect(page.getByRole('heading', { name: 'Nothing to review yet' })).toBeVisible();
  });

  test('does not show whether the user retried', async ({ page, worker, extensionId }) => {
    await page.goto('/capture.html');
    await clickAt(page, 184, 116);
    await clickAt(page, 140, 116); // the retry on Save
    expect((await readLog(worker)).records[0]!.followUp).not.toBeNull();

    await page.goto(`chrome-extension://${extensionId}/review.html`);
    await expect(page.locator('.target')).toHaveText('Save');
    await expect(page.locator('body')).not.toContainText(/retr|follow|next click/i);
  });
});

test.describe('the numbers page', () => {
  test('shows the miss rate and the gates from the log', async ({ page, worker, extensionId }) => {
    await page.goto('/capture.html');
    await clickAt(page, 184, 116); // a miss beside Save
    await clickAt(page, 140, 116); // the retry, which makes it a labeled miss
    await clickAt(page, 340, 116); // a plain hit on Share
    expect((await readLog(worker)).records).toHaveLength(1);

    await page.goto(`chrome-extension://${extensionId}/review.html`);
    await page.getByRole('button', { name: 'Numbers' }).click();

    const row = (name: string) => page.getByRole('row', { name: new RegExp(`^${name}`) });
    await expect(row('Clicks seen')).toContainText('3');
    await expect(row('Misses a day')).toContainText('1.0');
    await expect(row('Misses as a share of clicks')).toContainText('33.33%');
    await expect(row('Recovery')).toContainText('100% (1 of 1)');
    await expect(row('Recovery')).toContainText('Not enough data yet');
    await expect(row('Would-be fires')).toContainText('1');
    await expect(row('Fires you reviewed')).toContainText('0 (0 wrong)');
    await expect(row('Retries on a page that was already changing')).toContainText('0');
    await expect(page.locator('.ruler-caption')).toHaveText('Day 1 of 14. Clicks on 1 of them.');
  });

  test('exports the whole log as a file', async ({ page, worker, extensionId }) => {
    await openReviewWithFires(page, worker, extensionId);
    await page.keyboard.press('y');
    await page.getByRole('button', { name: 'Numbers' }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export the log' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^heyo-log-\d{4}-\d{2}-\d{2}\.json$/);
    const exported = JSON.parse(await readFile(await download.path(), 'utf8')) as LogExport;
    expect(exported.format).toBe('heyo-log');
    expect(exported.v).toBe(1);
    expect(exported.records).toHaveLength(4);
    expect(exported.reviews).toHaveLength(1);
    expect(exported.counts[0]).toMatchObject({ clicks: 4 });
    expect(exported.decisionVersion).toMatch(/^[0-9a-f]{12}$/);
  });

  test('deletes the log only after a second, explicit click', async ({
    page,
    worker,
    extensionId,
  }) => {
    await openReviewWithFires(page, worker, extensionId);
    await page.getByRole('button', { name: 'Numbers' }).click();

    await page.getByRole('button', { name: 'Delete the log' }).click();
    expect((await readLog(worker)).records).toHaveLength(4);
    await page.getByRole('button', { name: 'Keep the log' }).click();
    expect((await readLog(worker)).records).toHaveLength(4);

    await page.getByRole('button', { name: 'Delete the log' }).click();
    await page.getByRole('button', { name: /Delete 4 clicks and all marks/ }).click();
    await expect(page.locator('.log-size')).toContainText('0 logged clicks');
    const log = await readLog(worker);
    expect(log.records).toEqual([]);
    expect(log.reviews).toEqual([]);
    expect(log.counts).toEqual([]);
  });
});

test('the toolbar button opens the review page once and returns to it after that', async ({
  context,
  worker,
  extensionId,
}) => {
  const url = `chrome-extension://${extensionId}/review.html`;
  const [opened] = await Promise.all([
    context.waitForEvent('page'),
    worker.evaluate(() => heyo.openReview()),
  ]);
  await opened.waitForURL(url);

  await worker.evaluate(() => heyo.openReview());
  expect(context.pages().filter((p) => p.url() === url)).toHaveLength(1);
});
