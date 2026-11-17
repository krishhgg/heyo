import { readFileSync } from 'node:fs';
import { expect, test } from './helpers/fixtures';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

test('the extension loads and its content script answers in the top frame', async ({
  page,
  worker,
}) => {
  await page.goto('/basic.html');

  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.name).toBe('heyo');
  expect(manifest.version).toBe(pkg.version);

  const reply = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return heyo.pingTab(tab!.id!);
  });
  expect(reply).toEqual({ ok: true, version: pkg.version, top: true });
});
