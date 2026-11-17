// Proves the scorer reads what the extension exports: real near misses are
// logged and reviewed in the browser, the log is exported through the review
// page, and the scorer command scores that file.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../../../../scorer/cli.mjs', import.meta.url));

async function click(page, x, y) {
  await page.mouse.move(x - 140, y + 80);
  await page.mouse.move(x, y, { steps: 9 });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
}

export async function drive({ page, context, worker, baseUrl, evidence, log }) {
  await page.goto(`${baseUrl}/app.html`);

  // Three misses that are retried, and one empty-space click that is not.
  for (const name of ['Search', 'Compose', 'Starred']) {
    const control = page
      .getByRole('button', { name, exact: true })
      .or(page.getByRole('link', { name, exact: true }));
    const box = await control.first().boundingBox();
    await click(page, box.x + box.width / 2, box.y - 3);
    await click(page, box.x + box.width / 2, box.y + box.height / 2);
    log(`missed ${name} by 3 px, then clicked it`);
  }
  const lone = await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox();
  await click(page, lone.x + lone.width / 2, lone.y - 3);
  log('clicked 3 px above Settings and did not retry');

  const [review] = await Promise.all([
    context.waitForEvent('page'),
    worker.evaluate(() => heyo.openReview()),
  ]);
  await review.locator('.plate').waitFor();
  let marked = 0;
  while ((await review.locator('.plate').count()) > 0) {
    await review.keyboard.press('y');
    await review.locator('.stamp').waitFor({ state: 'detached' });
    // The page takes the next mark only after the next click has had its moment.
    await review.locator('.verdicts[aria-busy="false"], .empty').first().waitFor();
    marked++;
  }
  log(`marked ${marked} would-be fires right in the review page`);

  await review.getByRole('button', { name: 'Numbers' }).click();
  const [download] = await Promise.all([
    review.waitForEvent('download'),
    review.getByRole('button', { name: 'Export the log' }).click(),
  ]);
  const exported = join(evidence, 'export.json');
  await copyFile(await download.path(), exported);
  log(`exported ${download.suggestedFilename()}`);

  const { stdout } = await run(process.execPath, [cli, 'score', exported]);
  await writeFile(join(evidence, 'score.txt'), stdout);
  for (const line of stdout.trim().split('\n')) log(`scorer: ${line}`);

  const json = await run(process.execPath, [cli, 'score', exported, '--json']);
  const { score } = JSON.parse(json.stdout);
  await writeFile(join(evidence, 'result.json'), `${JSON.stringify(score, null, 2)}\n`);
  assert.equal(score.records, 4, 'four empty-space clicks were logged');
  assert.equal(score.misses, 3, 'the three retried clicks are labeled misses');
  assert.equal(score.recovered, 3, 'the decision picked the control the user then clicked');
  assert.equal(score.fires, marked, 'the scorer and the review page agree on the fires');
  assert.equal(score.reviewed, marked, 'every review mark made in the browser reached the scorer');
  assert.equal(score.wrong, 0);
}
