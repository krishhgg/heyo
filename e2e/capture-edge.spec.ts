// Pages that are easy to log wrongly: web components, focus-trapping dialogs,
// pages that change on their own, plain HTTP origins, and pages that echo what
// the user typed.
import { expect, test } from './helpers/fixtures';
import { clickAt, readLog, recordOf } from './helpers/log';

test.describe('web components', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/components.html');
  });

  test('a click on an icon slotted into a shadow button is a hit', async ({ page, worker }) => {
    const icon = await page.locator('#slotted-icon').boundingBox();
    await clickAt(page, icon!.x + icon!.width / 2, icon!.y + icon!.height / 2);
    const log = await readLog(worker);
    expect(log.records).toEqual([]);
    expect(log.counts[0]).toMatchObject({ clicks: 1, hits: 1 });
  });

  test('a click on plain text inside a shadow root is a hit', async ({ page, worker }) => {
    await clickAt(page, 120, 489);
    const log = await readLog(worker);
    expect(log.counts[0]).toMatchObject({ clicks: 1, hits: 1, emptyIgnored: 0 });
  });

  test('a click on a button inside a closed shadow root is a hit', async ({ page, worker }) => {
    await clickAt(page, 140, 596);
    const log = await readLog(worker);
    expect(log.records).toEqual([]);
    expect(log.counts[0]).toMatchObject({ clicks: 1, hits: 1 });
  });

  test('a button inside a closed shadow root is found as a candidate', async ({ page, worker }) => {
    const record = await recordOf(page, worker, 184, 596);
    expect(record.features.candidates[0]).toMatchObject({
      tag: 'button',
      label: 'Closed',
      dist: 4,
    });
  });

  test('leaving a text field inside a shadow root is a reaction', async ({ page, worker }) => {
    await page.mouse.click(180, 216);
    const record = await recordOf(page, worker, 296, 276);
    expect(record.features.candidates[0]).toMatchObject({ label: 'Apply' });
    expect(record.features).toMatchObject({ reacted: true, reaction: { focus: true } });
  });

  test('a change inside another component is a reaction, counted as far from the click', async ({
    page,
    worker,
  }) => {
    const record = await recordOf(page, worker, 296, 416);
    expect(record.features.candidates[0]).toMatchObject({ label: 'Filter' });
    expect(record.features).toMatchObject({
      reacted: true,
      reaction: { mutation: true },
      mutations: { total: 1, near: 0 },
    });
  });
});

test.describe('closed shadow roots and live components', () => {
  test('a control known only by its listener inside a closed root is a hit', async ({
    page,
    worker,
  }) => {
    await page.goto('/closed.html');
    await clickAt(page, 140, 116);
    expect(await page.evaluate('taps')).toEqual(['pad']);
    const log = await readLog(worker);
    expect(log.records).toEqual([]);
    expect(log.counts[0]).toMatchObject({ clicks: 1, hits: 1 });
  });

  test('blank space inside a listening host is empty, next to the button it wraps', async ({
    page,
    worker,
  }) => {
    await page.goto('/closed.html');
    // Inside the host, 6 px left of the button in its closed root.
    const record = await recordOf(page, worker, 294, 220);
    expect(record.features.candidates[0]).toMatchObject({
      tag: 'button',
      label: 'Inner go',
      dist: 6,
    });
    expect(record.features.candidates).toHaveLength(1);
  });

  test('an icon slotted into a closed-root button is a hit', async ({ page, worker }) => {
    await page.goto('/closed.html');
    const icon = await page.locator('#closed-icon').boundingBox();
    await clickAt(page, icon!.x + icon!.width / 2, icon!.y + icon!.height / 2);
    const log = await readLog(worker);
    expect(log.records).toEqual([]);
    expect(log.counts[0]).toMatchObject({ clicks: 1, hits: 1 });
  });

  test('leaving a text field inside a closed root is a reaction', async ({ page, worker }) => {
    await page.goto('/closed.html');
    await page.mouse.click(180, 416);
    const record = await recordOf(page, worker, 296, 476);
    expect(record.features.candidates[0]).toMatchObject({ label: 'Go on' });
    expect(record.features).toMatchObject({
      reacted: true,
      reaction: { focus: true },
      leftField: true,
    });
  });

  test('a scroll inside a shadow root is a reaction', async ({ page, worker }) => {
    await page.goto('/closed.html?scroll');
    const record = await recordOf(page, worker, 296, 616);
    expect(record.features.candidates[0]).toMatchObject({ label: 'Jump' });
    expect(record.features).toMatchObject({ reacted: true, reaction: { scroll: true } });
  });

  test('a counter ticking inside a shadow root is flagged as background change', async ({
    page,
    worker,
  }) => {
    await page.goto('/closed.html?ticker');
    await page.mouse.move(60, 660);
    await page.waitForTimeout(400);
    const record = await recordOf(page, worker, 296, 616);
    expect(record.features).toMatchObject({
      reacted: true,
      reaction: { mutation: true },
      churn: true,
    });
  });
});

test.describe('tricky pages', () => {
  test('a page that marks its root element on every press does not look near the click', async ({
    page,
    worker,
  }) => {
    await page.goto('/tricky.html?whatinput');
    const record = await recordOf(page, worker, 184, 376);
    expect(record.features).toMatchObject({
      reacted: true,
      reaction: { mutation: true },
      mutations: { total: 1, near: 0 },
    });
  });

  test('a small panel that handles its children is not itself a control', async ({
    page,
    worker,
  }) => {
    await page.goto('/tricky.html');
    // Inside the panel, 4 px right of its first child.
    const record = await recordOf(page, worker, 194, 126);
    expect(record.features.under).toMatchObject({ tag: 'div' });
    expect(record.features.candidates[0]).toMatchObject({
      label: 'One',
      signals: ['cursor'],
      dist: 4,
    });
    expect(record.decision).toEqual({ action: 'retarget', candidate: 0 });
  });

  test('a dialog that takes focus on a click inside it has not reacted', async ({
    page,
    worker,
  }) => {
    await page.goto('/tricky.html');
    await clickAt(page, 460, 150); // the OK button
    await expect(page.locator('#ok')).toBeFocused();

    const record = await recordOf(page, worker, 596, 150); // 4 px left of Cancel
    await expect(page.locator('#dialog')).toBeFocused();
    expect(record.features.candidates[0]).toMatchObject({ label: 'Cancel', dist: 4 });
    expect(record.features).toMatchObject({ reacted: false, blurred: true });
    expect(record.decision).toEqual({ action: 'retarget', candidate: 0 });
  });

  test('a link with no box of its own is still a candidate', async ({ page, worker }) => {
    await page.goto('/tricky.html');
    const record = await recordOf(page, worker, 184, 276);
    expect(record.features.candidates[0]).toMatchObject({ tag: 'a', label: 'Abs link', dist: 4 });

    await clickAt(page, 140, 276);
    const [after] = (await readLog(worker)).records;
    expect(after!.followUp).toMatchObject({ kind: 'control', candidate: 0, dist: 4 });
  });

  test('a retry on a button the page replaced still matches its candidate', async ({
    page,
    worker,
  }) => {
    await page.goto('/tricky.html?swap');
    const original = await page.locator('#swap').elementHandle();
    const record = await recordOf(page, worker, 484, 276);
    expect(record.features.reacted).toBe(false);

    await page.waitForTimeout(300);
    expect(await original.evaluate((node) => node.isConnected)).toBe(false);
    await clickAt(page, 440, 276);
    const [after] = (await readLog(worker)).records;
    expect(after!.followUp).toMatchObject({ kind: 'control', candidate: 0, dist: 4 });
  });

  test('a retry after scrolling keeps the distance measured at the first click', async ({
    page,
    worker,
  }) => {
    await page.goto('/tricky.html');
    await recordOf(page, worker, 184, 376); // 4 px right of Plain
    await page.mouse.wheel(0, 100);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(100);

    await clickAt(page, 140, 276); // Plain, now 100 px higher
    const [after] = (await readLog(worker)).records;
    expect(after!.followUp).toMatchObject({ kind: 'control', candidate: 0, dist: 4 });
  });

  test('a press on a disabled button is counted as a hit', async ({ page, worker }) => {
    await page.goto('/tricky.html');
    await clickAt(page, 640, 276);
    const log = await readLog(worker);
    expect(log.records).toEqual([]);
    expect(log.counts[0]).toMatchObject({ clicks: 1, hits: 1 });
  });

  test('a click made with the keyboard is not counted', async ({ page, worker }) => {
    await page.goto('/tricky.html');
    await page.locator('#plain').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
    expect((await readLog(worker)).counts).toEqual([]);
  });

  test('a page that leaves during the settle time has reacted', async ({ page, worker }) => {
    await page.goto('/tricky.html');
    await clickAt(page, 204, 490); // the blank part of the zone that navigates away
    await page.waitForURL('**/basic.html');

    const log = await readLog(worker);
    expect(log.counts[0]).toMatchObject({ clicks: 1, emptyReacted: 1, emptyIgnored: 0 });
    expect(log.records[0]!.features).toMatchObject({
      reacted: true,
      reaction: { navigation: true },
    });
  });

  test('a scrollable code block with a tab stop is not a control', async ({ page, worker }) => {
    await page.goto('/tricky.html');
    await clickAt(page, 250, 600); // blank space inside the code block
    const log = await readLog(worker);
    expect(log.records).toEqual([]);
    expect(log.counts[0]).toMatchObject({ clicks: 1, hits: 0, emptyIgnored: 1 });
  });

  test('a miss on a control the search could not see is logged once the user hits it', async ({
    page,
    worker,
  }) => {
    await page.goto('/tricky.html');
    // The control shows a pointer cursor only while the pointer is on it.
    await clickAt(page, 484, 576);
    expect((await readLog(worker)).records).toEqual([]);

    await clickAt(page, 440, 576);
    const [record] = (await readLog(worker)).records;
    expect(record!.features.candidates).toEqual([]);
    expect(record!.followUp).toMatchObject({ kind: 'control', candidate: null, dist: 4 });
    expect(record!.decision).toEqual({ action: 'refuse', reason: 'no-candidate' });
  });

  test('an icon button with no name is refused', async ({ page, worker }) => {
    await page.goto('/tricky.html');
    const record = await recordOf(page, worker, 636, 576);
    expect(record.features.candidates[0]).toMatchObject({ tag: 'button', label: '', dist: 4 });
    expect(record.decision).toEqual({ action: 'refuse', reason: 'unlabeled' });
  });

  test('a press in an iframe ends the wait for a follow-up in the page around it', async ({
    page,
    worker,
  }) => {
    await page.goto('/framed.html');
    await page.frameLocator('#frame').locator('#save').waitFor();
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.textContent = 'Outside';
      button.style.cssText =
        'position: absolute; left: 700px; top: 100px; width: 80px; height: 32px';
      document.body.append(button);
    });

    const record = await recordOf(page, worker, 784, 116); // 4 px right of Outside, in the page
    await page.mouse.click(150, 126); // Save, inside the iframe
    await clickAt(page, 740, 116); // Outside itself, still within 1.5 seconds

    const after = (await readLog(worker)).records.find((r) => r.id === record.id);
    expect(after!.followUp).toBeNull();
  });

  test('the page still gets every click, untouched', async ({ page }) => {
    await page.goto('/tricky.html');
    await clickAt(page, 184, 376);
    const seen = await page.evaluate('seen');
    expect(seen).toEqual([{ trusted: true, prevented: false }]);
  });
});

test.describe('a page that changes on its own', () => {
  test('is flagged, so its clicks can be told from real reactions', async ({ page, worker }) => {
    await page.goto('/tricky.html?ticker');
    await page.mouse.move(60, 420);
    await page.waitForTimeout(400);

    const record = await recordOf(page, worker, 184, 376);
    expect(record.features).toMatchObject({
      reacted: true,
      reaction: { mutation: true, focus: false },
      churn: true,
    });
  });

  test('a quiet page is not flagged', async ({ page, worker }) => {
    await page.goto('/tricky.html');
    await page.mouse.move(60, 420);
    await page.waitForTimeout(400);

    const record = await recordOf(page, worker, 184, 376);
    expect(record.features).toMatchObject({ reacted: false, churn: false });
  });

  test('is unknown when heyo had not watched for the whole 300 ms', async ({ page, worker }) => {
    await page.goto('/tricky.html');
    const record = await recordOf(page, worker, 184, 376);
    expect(record.features.churn).toBeNull();
  });
});

test('capture works on a plain HTTP page, which is not a secure context', async ({
  page,
  worker,
  baseURL,
}) => {
  const port = new URL(baseURL!).port;
  await page.goto(`http://plain.heyo.test:${port}/capture.html`);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);

  const record = await recordOf(page, worker, 184, 116);
  expect(record.site).toBe('plain.heyo.test');
  expect(record.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(record.features.candidates[0]).toMatchObject({ label: 'Save', signals: ['native'] });

  await clickAt(page, 340, 416); // the div with a click listener, known through the main-world script
  const log = await readLog(worker);
  expect(log.records).toHaveLength(1);
  expect(log.counts[0]).toMatchObject({ site: 'plain.heyo.test', clicks: 2, hits: 1 });
});

test.describe('typed text', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/private.html');
  });

  test('that the page repeats in a button label is blanked out', async ({ page, worker }) => {
    await page.locator('#query').fill('personal-secret-query');
    await expect(page.locator('#echo')).toHaveText('Search for personal-secret-query');

    const nearText = await recordOf(page, worker, 396, 116);
    expect(nearText.features.candidates[0]).toMatchObject({
      label: 'Search for …',
      redacted: true,
    });
    const nearAria = await recordOf(page, worker, 696, 116);
    expect(nearAria.features.candidates[0]).toMatchObject({
      label: 'Clear search for …',
      redacted: true,
    });

    const exported = JSON.stringify(await readLog(worker));
    expect(exported).not.toContain('personal');
    expect(exported).not.toContain('secret');
  });

  test('in a text area or a rich text box never reaches the log', async ({ page, worker }) => {
    await page.locator('#notes').fill('my private notes');
    await page.locator('#rich').click();
    await page.keyboard.type('rich secret text');

    const nearNotes = await recordOf(page, worker, 304, 216);
    expect(nearNotes.features.candidates[0]).toMatchObject({ tag: 'textarea', label: '' });
    const nearRich = await recordOf(page, worker, 604, 216);
    expect(nearRich.features.candidates[0]).toMatchObject({ tag: 'div', label: '' });

    const exported = JSON.stringify(await readLog(worker));
    expect(exported).not.toContain('private notes');
    expect(exported).not.toContain('secret text');
  });

  test('drawn by a code editor as ordinary elements never reaches the log', async ({
    page,
    worker,
  }) => {
    await page.mouse.click(200, 340);
    await page.keyboard.type('my secret typed note 12345');
    await expect(page.locator('#editor .line')).toHaveText('my secret typed note 12345');

    const record = await recordOf(page, worker, 404, 340);
    expect(record.features.candidates[0]).toMatchObject({
      tag: 'div',
      signals: ['listener'],
      label: '',
    });
    expect(JSON.stringify(await readLog(worker))).not.toContain('secret typed note');
  });
});

test.describe('typed text in unusual fields', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/private.html');
  });

  test('in a field that lost focus, on a page with many hidden inputs, is still blanked', async ({
    page,
    worker,
  }) => {
    await page.locator('#query').fill('hunter2secret');
    await page.mouse.click(1100, 700); // somewhere blank, so the field loses focus
    await expect(page.locator('#query')).not.toBeFocused();

    const record = await recordOf(page, worker, 396, 116);
    expect(record.features.candidates[0]).toMatchObject({ label: 'Search for …', redacted: true });
    expect(JSON.stringify(await readLog(worker))).not.toContain('hunter2');
  });

  test('is not confused with the value of a radio button', async ({ page, worker }) => {
    const record = await recordOf(page, worker, 95, 530); // 5 px left of the radio's label
    const labels = record.features.candidates.map((c) => [c.tag, c.label, c.redacted]);
    expect(labels).toContainEqual(['label', 'Monthly', false]);
    expect(labels).toContainEqual(['input', 'Monthly', false]);
  });

  test('in a rich text box is blanked where the page repeats it', async ({ page, worker }) => {
    await page.locator('#title').click();
    await page.keyboard.type('quarterly-board-notes');
    await expect(page.locator('#title-echo')).toHaveText('Rename to quarterly-board-notes');

    const record = await recordOf(page, worker, 696, 536);
    expect(record.features.candidates[0]).toMatchObject({ label: 'Rename to …', redacted: true });
    expect(JSON.stringify(await readLog(worker))).not.toContain('quarterly');
  });

  test('in a field built from a plain element never reaches the log', async ({ page, worker }) => {
    const record = await recordOf(page, worker, 304, 436);
    expect(record.features.candidates[0]).toMatchObject({ role: 'textbox', label: '' });
    expect(JSON.stringify(await readLog(worker))).not.toContain('custom field');
  });

  test('in a field inside a shadow root is blanked where the page repeats it', async ({
    page,
    worker,
  }) => {
    await page.mouse.click(500, 436);
    await page.keyboard.type('hidden-shadow-words');
    await expect(page.locator('#shadow-echo')).toHaveText('Find hidden-shadow-words');

    const record = await recordOf(page, worker, 696, 436);
    expect(record.features.candidates[0]).toMatchObject({ label: 'Find …', redacted: true });

    // The first click took focus out of the field. Its value is still on the page.
    const again = await recordOf(page, worker, 696, 436);
    expect(again.features.candidates[0]).toMatchObject({ label: 'Find …', redacted: true });
    expect(JSON.stringify(await readLog(worker))).not.toContain('hidden-shadow');
  });
});

test.describe('a page that pokes at the extension', () => {
  test('cannot get the private event name', async ({ page }) => {
    await page.goto('/probe.html');
    expect(await page.evaluate('probe.names')).toEqual([]);
  });

  test('cannot break its own listeners by patching built-ins', async ({ page, worker }) => {
    await page.goto('/probe.html');
    expect(await page.evaluate('probe.error')).toBeNull();

    await clickAt(page, 140, 116);
    expect(await page.evaluate('probe.clicks')).toBe(1);
    expect((await readLog(worker)).counts[0]).toMatchObject({ clicks: 1, hits: 1 });
  });
});
