// Proves shadow mode end to end: a near miss is logged with the target heyo
// would pick, the retry is attached to it, a hit is left alone, and the page
// is never changed.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SETTLE_MS = 150;

async function click(page, x, y) {
  await page.mouse.move(x - 160, y + 90);
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(SETTLE_MS);
}

export async function drive({ page, worker, baseUrl, evidence, log }) {
  await page.goto(`${baseUrl}/capture.html`);
  const before = await page.content();
  await page.evaluate(() => {
    window.mutations = 0;
    new MutationObserver((records) => (window.mutations += records.length)).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });

  log('near miss: clicking 4 px to the right of the Save button');
  await click(page, 184, 116);
  // The default screenshot hides the text caret by editing input styles, which changes the page.
  await page.screenshot({ path: join(evidence, '1-near-miss.png'), caret: 'initial' });

  log('retry: clicking the Save button itself');
  await click(page, 140, 116);

  log('hit: clicking the Share button');
  await click(page, 340, 116);

  log('empty space far from anything');
  await click(page, 900, 150);

  const exported = await worker.evaluate(() => heyo.exportLog());
  await writeFile(join(evidence, 'result.json'), `${JSON.stringify(exported, null, 2)}\n`);

  assert.equal(exported.format, 'heyo-log');
  assert.equal(exported.records.length, 1, 'only the near miss is logged as a record');
  const [record] = exported.records;
  const [candidate] = record.features.candidates;
  log(`logged candidate: ${candidate.label} at ${candidate.dist} px (${candidate.signals})`);
  assert.equal(candidate.label, 'Save');
  assert.equal(candidate.dist, 4);
  log(`would-be decision: ${JSON.stringify(record.decision)}`);
  assert.deepEqual(record.decision, { action: 'retarget', candidate: 0 });
  log(`page reacted: ${record.features.reacted}`);
  assert.equal(record.features.reacted, false);
  log(`follow-up: ${JSON.stringify(record.followUp)}`);
  assert.equal(record.followUp.kind, 'control');
  assert.equal(record.followUp.candidate, 0);
  assert.ok(record.followUp.dt <= 1500);

  const [count] = exported.counts;
  log(`counts: ${JSON.stringify(count)}`);
  assert.deepEqual(
    { clicks: count.clicks, hits: count.hits, emptyIgnored: count.emptyIgnored },
    { clicks: 4, hits: 2, emptyIgnored: 2 },
  );

  const mutations = await page.evaluate(() => window.mutations);
  log(`DOM mutations seen by the page during the drive: ${mutations}`);
  assert.equal(mutations, 0, 'shadow mode must not change the page');
  assert.equal(await page.content(), before, 'shadow mode must not change the page');
  log('the page markup is unchanged after four clicks');
}
