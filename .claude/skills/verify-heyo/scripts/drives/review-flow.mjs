// Proves the hand-review flow end to end: real near misses are logged, the
// toolbar button opens the review page, keyboard marks are stored, and the
// export holds the whole log.
import assert from 'node:assert/strict';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SETTLE_MS = 150;

async function click(page, x, y) {
  await page.mouse.move(x - 140, y + 80);
  await page.mouse.move(x, y, { steps: 9 });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(SETTLE_MS);
}

export async function drive({ page, context, worker, baseUrl, evidence, log }) {
  await page.goto(`${baseUrl}/app.html`);

  // Click 3 px outside each of five controls on the small app fixture.
  const names = ['Search', 'Settings', 'Compose', 'Starred', 'Archive'];
  for (const name of names) {
    const control = page
      .getByRole('button', { name, exact: true })
      .or(page.getByRole('link', { name, exact: true }));
    const box = await control.first().boundingBox();
    await click(page, box.x + box.width / 2, box.y - 3);
    log(`near miss: clicked 3 px above ${name}`);
  }

  const [review] = await Promise.all([
    context.waitForEvent('page'),
    worker.evaluate(() => heyo.openReview()),
  ]);
  await review.setViewportSize({ width: 1280, height: 860 });
  await review.locator('.plate').waitFor();
  log(`the toolbar button opened ${new URL(review.url()).pathname}`);
  log(`progress: ${(await review.locator('.progress-text').innerText()).replace(/\s+/g, ' ')}`);
  await review.screenshot({ path: join(evidence, '1-review.png') });

  const marks = {};
  for (const [key, verdict] of [
    ['y', 'right'],
    ['n', 'wrong'],
    ['u', 'unsure'],
  ]) {
    const target = await review.locator('.target').innerText();
    await review.keyboard.press(key);
    if (verdict === 'right') {
      await review.locator('.stamp').waitFor();
      await review.screenshot({ path: join(evidence, '2-stamp.png') });
    }
    await review.locator('.stamp').waitFor({ state: 'detached' });
    marks[target] = verdict;
    log(`pressed ${key.toUpperCase()}: marked "${target}" ${verdict}`);
  }

  await review.keyboard.press('z');
  const changed = await review.locator('.target').innerText();
  await review.keyboard.press('y');
  await review.locator('.stamp').waitFor({ state: 'detached' });
  marks[changed] = 'right';
  log(`pressed Z then Y: changed "${changed}" to right`);
  log(`progress: ${(await review.locator('.progress-text').innerText()).replace(/\s+/g, ' ')}`);

  await review.getByRole('button', { name: 'Numbers' }).click();
  await review.screenshot({ path: join(evidence, '3-numbers.png'), fullPage: true });

  const [download] = await Promise.all([
    review.waitForEvent('download'),
    review.getByRole('button', { name: 'Export the log' }).click(),
  ]);
  await copyFile(await download.path(), join(evidence, 'export.json'));
  const exported = JSON.parse(await readFile(join(evidence, 'export.json'), 'utf8'));
  log(
    `exported ${download.suggestedFilename()}: ${exported.records.length} records, ${exported.reviews.length} review marks`,
  );

  const stored = await worker.evaluate(() => heyo.exportLog());
  await writeFile(join(evidence, 'result.json'), `${JSON.stringify(stored, null, 2)}\n`);

  assert.equal(exported.format, 'heyo-log');
  assert.equal(exported.records.length, names.length);
  assert.deepEqual(exported.records, stored.records, 'the export holds what the extension stored');

  // The latest mark for each click, by the label of the control it judged.
  const latest = {};
  for (const mark of [...stored.reviews].sort((a, b) => a.t - b.t)) {
    const record = stored.records.find((r) => r.id === mark.recordId);
    latest[record.features.candidates[mark.candidate].label] = mark.verdict;
  }
  assert.deepEqual(latest, marks, 'every keyboard mark was stored against the right click');
  log(`stored marks: ${JSON.stringify(latest)}`);
}
