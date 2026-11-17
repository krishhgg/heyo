// Proves the built extension loads and its content script runs on a page.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function drive({ page, worker, baseUrl, evidence, log, pingActiveTab }) {
  await page.goto(`${baseUrl}/basic.html`);
  log(`opened ${baseUrl}/basic.html`);

  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  log(`service worker is up: ${manifest.name} ${manifest.version}`);
  assert.equal(manifest.name, 'heyo');

  const reply = await pingActiveTab(worker);
  log(`content script reply: ${JSON.stringify(reply)}`);
  assert.deepEqual(reply, { ok: true, version: manifest.version, top: true });

  await page.screenshot({ path: join(evidence, 'page.png') });
  await writeFile(
    join(evidence, 'result.json'),
    `${JSON.stringify({ manifest, reply }, null, 2)}\n`,
  );
}
