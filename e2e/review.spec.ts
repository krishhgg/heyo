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

/** Waits until the page will take the next mark: the stamp is gone and the next click has had its moment. */
async function ready(page: Page) {
  await expect(page.locator('.stamp')).toHaveCount(0);
  await expect(page.locator('.verdicts[aria-busy="false"], .empty').first()).toBeAttached();
}

/** One mark from the keyboard, waited out. */
async function press(page: Page, key: string) {
  await page.keyboard.press(key);
  await ready(page);
}

test.describe('the review page', () => {
  test('shows each would-be fire and never a refused click', async ({
    page,
    worker,
    extensionId,
  }) => {
    await openReviewWithFires(page, worker, extensionId);

    await expect(page.getByRole('button', { name: /Review/ })).toContainText('3');
    await expect(page.locator('.progress-text')).toHaveText('0 marked · 3 waiting');

    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      seen.push(await page.locator('.target').innerText());
      await press(page, 'y');
      await expect(page.locator('.progress-text')).toContainText(`${i + 1} marked`);
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
      await press(page, key);
    }
    // The review screen says only how far along the pile is, never what the marks add up to.
    await expect(page.locator('.progress-text')).toHaveText('3 marked · 0 waiting');
    await expect(page.locator('.review')).not.toContainText(/299|473/);

    await page.getByRole('button', { name: 'Numbers' }).click();
    const row = (name: string) => page.getByRole('row', { name: new RegExp(`^${name}`) });
    await expect(row('Fires you reviewed')).toContainText('2 (1 wrong)');
    await expect(row('Fires you reviewed')).toContainText('473 with 1 wrong');
    await expect(row('Fires you marked not sure')).toContainText('1');

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
    await ready(page);

    await page.keyboard.press('z');
    await expect(page.locator('.target')).toHaveText(first);
    await expect(page.getByRole('button', { name: /No, wrong/ })).toHaveClass(/chosen/);

    await expect(page.locator('.earlier')).toHaveText(/You marked this wrong/);

    await press(page, 'y');
    await expect(page.locator('.progress-text')).toContainText('1 marked');
    expect((await readLog(worker)).reviews.map((r) => r.verdict)).toEqual(['right']);
  });

  test('keeps its place and its way back while the numbers are showing', async ({
    page,
    worker,
    extensionId,
  }) => {
    await openReviewWithFires(page, worker, extensionId);
    const first = await page.locator('.target').innerText();
    await press(page, 'n');
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
    await press(page, 'n');
    await page.keyboard.press('z');
    await press(page, 'y');

    await page.getByRole('button', { name: 'Numbers' }).click();
    await expect(page.locator('.log-size')).toContainText('1 review mark');

    // The exported file holds what the store holds.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export the log' }).click(),
    ]);
    const exported = JSON.parse(await readFile(await download.path(), 'utf8')) as LogExport;
    expect(exported.reviews).toEqual((await readLog(worker)).reviews);
    expect((await readLog(worker)).reviews).toHaveLength(1);
  });

  for (const motion of ['no-preference', 'reduce'] as const) {
    for (const gap of [20, 280, 480]) {
      test(`ignores a second tap ${gap} ms after the first, with motion ${motion === 'reduce' ? 'reduced' : 'on'}`, async ({
        page,
        worker,
        extensionId,
      }) => {
        await page.emulateMedia({ reducedMotion: motion });
        await openReviewWithFires(page, worker, extensionId);
        await page.keyboard.press('y');
        // The second tap lands while the stamp shows, or just after the next click came up.
        await page.waitForTimeout(gap);
        await page.keyboard.press('y');
        await ready(page);
        await expect(page.locator('.progress-text')).toContainText('1 marked');
        expect((await readLog(worker)).reviews).toHaveLength(1);
      });
    }
  }

  test('shows a fresh mark as fresh while it is being stamped', async ({
    page,
    worker,
    extensionId,
  }) => {
    await openReviewWithFires(page, worker, extensionId);
    const before = await page.getByRole('button', { name: /Yes, right/ }).boundingBox();
    await page.keyboard.press('y');
    await expect(page.locator('.stamp')).toBeVisible();
    // No "you marked this" line, no filled button, and nothing moved.
    await expect(page.locator('.earlier')).toHaveCount(0);
    await expect(page.locator('.verdict.chosen')).toHaveCount(0);
    expect(await page.getByRole('button', { name: /Yes, right/ }).boundingBox()).toEqual(before);
    await ready(page);
  });

  for (const wait of [100, 300, 450]) {
    test(`goes back when Z is pressed ${wait} ms after a mark`, async ({
      page,
      worker,
      extensionId,
    }) => {
      await openReviewWithFires(page, worker, extensionId);
      const first = await page.locator('.target').innerText();
      await page.keyboard.press('n');
      // During the stamp, or while the next click is having its moment.
      await page.waitForTimeout(wait);
      await page.keyboard.press('z');
      await expect(page.locator('.target')).toHaveText(first);
      await expect(page.locator('.earlier')).toHaveText(/You marked this wrong/);
      // The next key corrects that click and no other.
      await ready(page);
      await press(page, 'y');
      const { reviews } = await readLog(worker);
      expect(reviews.map((r) => r.verdict)).toEqual(['right']);
    });
  }

  test('does not go back twice when Space follows a mouse click on Back', async ({
    page,
    worker,
    extensionId,
  }) => {
    await openReviewWithFires(page, worker, extensionId);
    const first = await page.locator('.target').innerText();
    await press(page, 'y');
    const second = await page.locator('.target').innerText();
    await press(page, 'y');

    await page.getByRole('button', { name: /Back to the last one/ }).click();
    await expect(page.locator('.target')).toHaveText(second);
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    await expect(page.locator('.target')).toHaveText(second);
    expect(second).not.toBe(first);
  });

  test('does not mark the next click when Space follows a mouse mark', async ({
    page,
    worker,
    extensionId,
  }) => {
    await openReviewWithFires(page, worker, extensionId);
    await page.getByRole('button', { name: /No, wrong/ }).click();
    await ready(page);
    // Space scrolls a page. It must not press the answer the mouse just used.
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    expect((await readLog(worker)).reviews).toHaveLength(1);

    // An answer reached with the keyboard keeps its focus and still works.
    await page.getByRole('button', { name: /Yes, right/ }).focus();
    await page.keyboard.press('Enter');
    await ready(page);
    expect((await readLog(worker)).reviews).toHaveLength(2);
  });

  test('picks up a click that is logged while the last mark is settling', async ({
    page,
    worker,
    extensionId,
  }) => {
    await page.goto('/capture.html');
    await clickAt(page, 184, 116); // beside Save
    await page.goto(`chrome-extension://${extensionId}/review.html`);
    await expect(page.locator('.target')).toHaveText('Save');

    // Another tab logs a click the open page has not read yet.
    const other = await page.context().newPage();
    await other.goto('/capture.html');
    await clickAt(other, 184, 416); // beside the card
    await other.close();

    await page.keyboard.press('y');
    await expect(page.getByRole('heading', { name: 'All caught up' })).toBeVisible();
    // The page reads the log again while the lockout from that mark still runs.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('.target')).toHaveText('Card');
    await press(page, 'y');
    expect((await readLog(worker)).reviews).toHaveLength(2);
  });

  test('marks one click when Enter is held on a focused answer', async ({
    page,
    worker,
    extensionId,
  }) => {
    await openReviewWithFires(page, worker, extensionId);
    await page.getByRole('button', { name: /Yes, right/ }).focus();
    await page.keyboard.down('Enter');
    // Held long enough for the key to repeat through the stamp and the look time.
    for (let i = 0; i < 30; i++) {
      await page.keyboard.down('Enter');
      await page.waitForTimeout(30);
    }
    await page.keyboard.up('Enter');
    await ready(page);
    expect((await readLog(worker)).reviews).toHaveLength(1);
  });

  test('drops marks of a deleted log from the way back', async ({ page, worker, extensionId }) => {
    await openReviewWithFires(page, worker, extensionId);
    await press(page, 'y');
    await page.getByRole('button', { name: 'Numbers' }).click();
    await page.getByRole('button', { name: 'Delete the log' }).click();
    await page.getByRole('button', { name: /Delete 4 clicks/ }).click();
    await expect(page.locator('.log-size')).toContainText('0 logged clicks');

    // A new click is logged in another tab while the page stays open.
    const other = await page.context().newPage();
    await other.goto('/capture.html');
    await clickAt(other, 184, 116);
    await other.close();
    await page.reload();
    await page.getByRole('button', { name: /Review/ }).click();
    await expect(page.locator('.target')).toHaveText('Save');
    await expect(page.getByRole('button', { name: /Back to the last one/ })).toBeDisabled();
    await page.keyboard.press('z');
    await expect(page.locator('.target')).toHaveText('Save');
    await press(page, 'y');
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
    await ready(page);
    await expect(page.locator('.target')).toHaveText(first);
    expect((await readLog(worker)).reviews).toHaveLength(0);

    await page.keyboard.press('y');
    await expect(page.locator('.target')).not.toHaveText(first);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await readLog(worker)).reviews).toHaveLength(1);
  });

  /** Logs the crowded click: a name of two lines and three neighbours, on a long site name. */
  async function crowdedClick(page: Page, worker: Worker, baseURL: string) {
    const { port } = new URL(baseURL);
    await page.goto(`http://mail.planning-notes.heyo.test:${port}/crowd.html`);
    await clickAt(page, 403, 216);
    expect((await readLog(worker)).records.at(-1)!.decision.action).toBe('retarget');
  }

  for (const [width, height] of [
    [1280, 633],
    [1000, 700],
    [881, 700],
    [800, 600],
    [641, 600],
    [640, 600],
    [560, 600],
  ] as const) {
    test(`shows the drawing, the whole name and the answers at ${width} by ${height}`, async ({
      page,
      worker,
      extensionId,
      baseURL,
    }) => {
      await crowdedClick(page, worker, baseURL!);
      await page.setViewportSize({ width, height });
      await page.goto(`chrome-extension://${extensionId}/review.html`);
      await expect(page.locator('.target')).toHaveText(/^Save the quarterly/);
      await expect(page.locator('.plate')).toBeInViewport({ ratio: 1 });
      for (const name of [/Yes, right/, /No, wrong/, /Not sure/]) {
        await expect(page.getByRole('button', { name })).toBeInViewport({ ratio: 1 });
      }
      // The name is not cut: what is painted is all of it. Two px allow for rounding.
      const cut = await page
        .locator('.target')
        .evaluate((name) => name.scrollHeight - name.clientHeight);
      expect(cut).toBeLessThanOrEqual(2);
      // Nothing is wider than the window.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    });
  }

  // Names that take more room than their length suggests: wide characters and capitals.
  for (const [kind, y] of [
    ['wide characters', 516],
    ['capitals', 616],
  ] as const) {
    for (const [width, height] of [
      [1280, 800],
      [1000, 700],
      [881, 700],
      [641, 600],
      [560, 600],
    ] as const) {
      test(`shows a whole name in ${kind} at ${width} by ${height}`, async ({
        page,
        worker,
        extensionId,
        baseURL,
      }) => {
        const { port } = new URL(baseURL!);
        await page.goto(`http://127.0.0.1:${port}/crowd.html`);
        await clickAt(page, 523, y);
        const [record] = (await readLog(worker)).records;
        expect(record!.decision.action).toBe('retarget');
        const label = record!.features.candidates[0]!.label;
        expect(label.length).toBeGreaterThan(30);

        await page.setViewportSize({ width, height });
        await page.goto(`chrome-extension://${extensionId}/review.html`);
        await expect(page.locator('.target')).toHaveText(label);
        // Length alone would set this name too large. It is measured and shrunk until it fits.
        const cut = await page
          .locator('.target')
          .evaluate((name) => name.scrollHeight - name.clientHeight);
        expect(cut).toBeLessThanOrEqual(1);
        await expect(page.getByRole('button', { name: /Not sure/ })).toBeInViewport({ ratio: 1 });
      });
    }
  }

  for (const [width, height] of [
    [1280, 800],
    [1000, 700],
    [900, 700],
    [600, 700],
  ] as const) {
    test(`keeps the answers in one place from click to click at ${width} by ${height}`, async ({
      page,
      worker,
      extensionId,
      baseURL,
    }) => {
      // A short name with no neighbours, and a long one with three.
      await page.goto('/capture.html');
      await clickAt(page, 184, 116);
      await crowdedClick(page, worker, baseURL!);
      await page.setViewportSize({ width, height });
      await page.goto(`chrome-extension://${extensionId}/review.html`);

      const yes = page.getByRole('button', { name: /Yes, right/ });
      const first = {
        name: await page.locator('.target').innerText(),
        at: await yes.boundingBox(),
      };
      await press(page, 'u');
      const second = {
        name: await page.locator('.target').innerText(),
        at: await yes.boundingBox(),
      };
      expect([first.name, second.name].sort()).toEqual([
        'Save',
        'Save the quarterly planning notes as a d…',
      ]);
      expect(second.at).toEqual(first.at);
    });
  }

  test('brings the next drawing into view after a mark made lower down', async ({
    page,
    worker,
    extensionId,
  }) => {
    await openReviewWithFires(page, worker, extensionId);
    // Too small for the drawing and the answers at once, so the click on an answer scrolls down.
    await page.setViewportSize({ width: 500, height: 500 });
    await page.getByRole('button', { name: /Yes, right/ }).click();
    await ready(page);
    await expect(page.locator('.plate')).toBeInViewport({ ratio: 1 });
  });

  test('says so when the log cannot be read, and reads it on a second try', async ({
    page,
    worker,
    extensionId,
  }) => {
    await page.goto('/capture.html');
    await clickAt(page, 184, 116);
    expect((await readLog(worker)).records).toHaveLength(1);
    // The store fails to open once, as it does when the profile is busy or damaged.
    await page.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB);
      let failed = false;
      indexedDB.open = (...args) => {
        if (failed) return open(...args);
        failed = true;
        throw new DOMException('The store is not available.', 'UnknownError');
      };
    });
    await page.goto(`chrome-extension://${extensionId}/review.html`);
    await expect(page.getByRole('alert')).toContainText('The log could not be read');

    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.target')).toHaveText('Save');
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
    await expect(page.getByRole('button', { name: 'Keep the log' })).toBeFocused();
    await page.getByRole('button', { name: /Delete 4 clicks and all marks/ }).click();
    await expect(page.locator('.log-size')).toContainText('0 logged clicks');
    await expect(page.getByRole('button', { name: 'Delete the log' })).toBeFocused();
    const log = await readLog(worker);
    expect(log.records).toEqual([]);
    expect(log.reviews).toEqual([]);
    expect(log.counts).toEqual([]);
  });
});

test('says so when the log cannot be exported or deleted', async ({
  page,
  worker,
  extensionId,
}) => {
  await openReviewWithFires(page, worker, extensionId);
  await page.getByRole('button', { name: 'Numbers' }).click();
  // Every transaction on the store fails from here on.
  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = () => {
      throw new DOMException('The store is not available.', 'UnknownError');
    };
  });

  await page.getByRole('button', { name: 'Export the log' }).click();
  await expect(page.getByRole('alert')).toHaveText(/could not be exported/);

  await page.getByRole('button', { name: 'Delete the log' }).click();
  await page.getByRole('button', { name: /Delete 4 clicks/ }).click();
  await expect(page.getByRole('alert')).toHaveText(/could not be deleted/);
  expect((await readLog(worker)).records).toHaveLength(4);
});

test('a double-click on Delete the log keeps the log', async ({ page, worker, extensionId }) => {
  await openReviewWithFires(page, worker, extensionId);
  await page.getByRole('button', { name: 'Numbers' }).click();

  await page.getByRole('button', { name: 'Delete the log' }).dblclick();
  await expect(page.getByRole('button', { name: 'Delete the log' })).toBeVisible();
  expect((await readLog(worker)).records).toHaveLength(4);

  // A click on the delete button right as it appears does nothing either.
  await page.getByRole('button', { name: 'Delete the log' }).click();
  // Forced, because Playwright would otherwise wait for the button to take clicks.
  await page.getByRole('button', { name: /Delete 4 clicks/ }).click({ force: true });
  expect((await readLog(worker)).records).toHaveLength(4);
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
